-- NFL Pick'em Draft schema / RPCs for Supabase Free.
create extension if not exists pgcrypto;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  status text not null default 'setup' check (status in ('setup','drafting','complete')),
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  draft_position int not null check (draft_position between 1 and 8),
  is_commissioner boolean not null default false,
  created_at timestamptz not null default now(),
  unique(league_id, draft_position)
);

create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_code text not null,
  overall_pick int not null,
  round_no int not null,
  created_at timestamptz not null default now(),
  unique(league_id, team_code),
  unique(league_id, overall_pick)
);

alter table public.leagues enable row level security;
alter table public.players enable row level security;
alter table public.picks enable row level security;

-- Guests use SECURITY DEFINER RPCs only; base tables are not directly exposed.
drop policy if exists "no direct access leagues" on public.leagues;
drop policy if exists "no direct access players" on public.players;
drop policy if exists "no direct access picks" on public.picks;

create or replace function public.get_draft_state(p_room_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l leagues%rowtype;
begin
  select * into l from leagues where room_code=upper(p_room_code);
  if not found then return jsonb_build_object('league',null,'players','[]'::jsonb,'picks','[]'::jsonb); end if;
  return jsonb_build_object(
    'league', jsonb_build_object('id',l.id,'room_code',l.room_code,'status',l.status),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'draft_position',p.draft_position,'is_commissioner',p.is_commissioner) order by p.draft_position) from players p where p.league_id=l.id),'[]'::jsonb),
    'picks', coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'player_id',x.player_id,'team_code',x.team_code,'overall_pick',x.overall_pick,'round_no',x.round_no) order by x.overall_pick) from picks x where x.league_id=l.id),'[]'::jsonb)
  );
end $$;

create or replace function public.create_league(p_room_code text, p_players jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l_id uuid; item jsonb; i int := 0; result jsonb;
begin
  if jsonb_array_length(p_players) <> 8 then raise exception 'Exactly 8 players are required'; end if;
  if exists(select 1 from leagues where room_code=upper(p_room_code)) then raise exception 'Room already exists'; end if;
  insert into leagues(room_code) values(upper(p_room_code)) returning id into l_id;
  for item in select * from jsonb_array_elements(p_players) loop
    i := i + 1;
    insert into players(league_id,name,draft_position,is_commissioner) values(l_id, trim(item->>'name'), i, i=1);
  end loop;
  select get_draft_state(upper(p_room_code)) into result;
  return result;
end $$;

create or replace function public.start_draft(p_room_code text, p_player_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare l leagues%rowtype;
begin
  select * into l from leagues where room_code=upper(p_room_code);
  if not found then raise exception 'League not found'; end if;
  if not exists(select 1 from players where id=p_player_id and league_id=l.id and is_commissioner) then raise exception 'Only the commissioner can start the draft'; end if;
  if l.status <> 'setup' then raise exception 'Draft has already started'; end if;
  update leagues set status='drafting' where id=l.id; return true;
end $$;

create or replace function public.make_pick(p_room_code text, p_player_id uuid, p_team_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l leagues%rowtype; expected uuid; n int; r int; result jsonb;
begin
  select * into l from leagues where room_code=upper(p_room_code) for update;
  if not found then raise exception 'League not found'; end if;
  if l.status <> 'drafting' then raise exception 'Draft is not active'; end if;
  select count(*) into n from picks where league_id=l.id;
  if n >= 32 then raise exception 'Draft is complete'; end if;
  select id into expected from players where league_id=l.id order by case when mod(floor(n/8)::int,2)=0 then draft_position else 9-draft_position end limit 1;
  if expected <> p_player_id then raise exception 'It is not your turn'; end if;
  if exists(select 1 from picks where league_id=l.id and team_code=upper(p_team_code)) then raise exception 'That team has already been drafted'; end if;
  r := floor(n/8)::int + 1;
  insert into picks(league_id,player_id,team_code,overall_pick,round_no) values(l.id,p_player_id,upper(p_team_code),n+1,r);
  if n+1=32 then update leagues set status='complete' where id=l.id; end if;
  select jsonb_build_object('pick',jsonb_build_object('team_code',upper(p_team_code),'overall_pick',n+1),'state',get_draft_state(l.room_code)) into result;
  return result;
end $$;

create or replace function public.reset_draft(p_room_code text, p_player_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare l leagues%rowtype;
begin
  select * into l from leagues where room_code=upper(p_room_code);
  if not found then raise exception 'League not found'; end if;
  if not exists(select 1 from players where id=p_player_id and league_id=l.id and is_commissioner) then raise exception 'Only the commissioner can reset the draft'; end if;
  delete from picks where league_id=l.id;
  update leagues set status='setup' where id=l.id;
  return true;
end $$;

revoke all on table public.leagues, public.players, public.picks from anon, authenticated;
grant execute on function public.get_draft_state(text) to anon, authenticated;
grant execute on function public.create_league(text,jsonb) to anon, authenticated;
grant execute on function public.start_draft(text,uuid) to anon, authenticated;
grant execute on function public.make_pick(text,uuid,text) to anon, authenticated;
grant execute on function public.reset_draft(text,uuid) to anon, authenticated;
