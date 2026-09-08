'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TEAMS } from '../lib/teams';

const TEAM_MAP = Object.fromEntries(TEAMS.map(t => [t.code, t]));
const makeRoom = () => Math.random().toString(36).slice(2,8).toUpperCase();
const storageKey = room => `nfl-pickem:${room}`;

function snakeSeat(pickIndex, playerCount = 8) {
  const round = Math.floor(pickIndex / playerCount);
  const offset = pickIndex % playerCount;
  return round % 2 === 0 ? offset : playerCount - 1 - offset;
}

export default function Home() {
  const [room, setRoom] = useState('DEMO');
  const [league, setLeague] = useState(null);
  const [players, setPlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('join');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = window.location.pathname.split('/').filter(Boolean)[0];
    const roomCode = code?.toUpperCase() || makeRoom();
    if (!code) history.replaceState({}, '', `/${roomCode}`);
    setRoom(roomCode);
    const saved = localStorage.getItem(storageKey(roomCode));
    if (saved) setProfile(JSON.parse(saved));
  }, []);

  const loadDraft = async () => {
    if (!supabase || !room) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_draft_state', { p_room_code: room });
    setLoading(false);
    if (error) { setNotice(error.message); return; }
    if (!data?.league) { setLeague(null); setPlayers([]); setPicks([]); return; }
    setLeague(data.league); setPlayers(data.players || []); setPicks(data.picks || []);
    const hasProfile = !!localStorage.getItem(storageKey(room));
    if (hasProfile && (data.league.status === 'drafting' || data.league.status === 'complete')) setView('draft');
  };

  useEffect(() => { loadDraft(); }, [room]);

  useEffect(() => {
    if (!supabase || !room) return;
    const channel = supabase.channel(`draft:${room}`)
      .on('broadcast', { event: 'refresh' }, () => loadDraft())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room]);

  const currentPick = picks.length;
  const currentPlayer = league && players.length ? players[snakeSeat(currentPick, players.length)] : null;
  const taken = useMemo(() => new Set(picks.map(p => p.team_code)), [picks]);
  const available = TEAMS.filter(t => !taken.has(t.code));
  const myTurn = !!profile && currentPlayer?.id === profile.playerId && league?.status === 'drafting';

  useEffect(() => {
    if (!('Notification' in window) || !myTurn) return;
    if (Notification.permission === 'granted') new Notification("You're on the clock", { body: `Room ${room}: make your NFL Pick'em selection.` });
  }, [myTurn, room]);

  const flash = msg => { setNotice(msg); setTimeout(() => setNotice(''), 3500); };

  async function createLeague(names) {
    const playersInput = names.map((name, i) => ({ name, draft_position: i + 1 }));
    const { data, error } = await supabase.rpc('create_league', { p_room_code: room, p_players: playersInput });
    if (error) return flash(error.message);
    const first = data?.players?.[0];
    if (first) {
      const p = { playerId: first.id, playerName: first.name, commissioner: true };
      localStorage.setItem(storageKey(room), JSON.stringify(p)); setProfile(p);
    }
    flash('League created.'); await loadDraft(); setView('draft');
  }

  async function joinPlayer(player) {
    const p = { playerId: player.id, playerName: player.name, commissioner: false };
    localStorage.setItem(storageKey(room), JSON.stringify(p)); setProfile(p); setView('draft');
    flash(`Joined as ${player.name}.`);
  }

  async function startDraft() {
    const { error } = await supabase.rpc('start_draft', { p_room_code: room, p_player_id: profile?.playerId });
    if (error) return flash(error.message); await loadDraft(); await announceRefresh();
  }

  async function makePick(code) {
    if (!myTurn) return;
    const { error } = await supabase.rpc('make_pick', { p_room_code: room, p_player_id: profile.playerId, p_team_code: code });
    if (error) return flash(error.message);
    await loadDraft(); await announceRefresh();
  }

  async function resetDraft() {
    if (!confirm('Reset the entire draft?')) return;
    const { error } = await supabase.rpc('reset_draft', { p_room_code: room, p_player_id: profile?.playerId });
    if (error) return flash(error.message); await loadDraft(); await announceRefresh();
  }

  async function announceRefresh() {
    if (!supabase) return;
    await supabase.channel(`draft:${room}`).send({ type: 'broadcast', event: 'refresh', payload: {} });
  }

  async function enableNotifications() {
    if ('Notification' in window) await Notification.requestPermission();
    flash('Browser notifications enabled.');
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href);
    flash('Draft room link copied.');
  }

  function newRoom() { const id = makeRoom(); history.pushState({}, '', `/${id}`); setRoom(id); setLeague(null); setPlayers([]); setPicks([]); setProfile(null); setView('join'); }

  if (!supabase) return <main><section className="empty-state"><span className="eyebrow">NFL PICK’EM</span><h1>Add Supabase credentials</h1><p>Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment before running this app.</p></section></main>;

  if (view === 'join' || !league) return <JoinScreen room={room} league={league} players={players} loading={loading} onCreate={createLeague} onJoin={joinPlayer} onNewRoom={newRoom} />;

  return <main>
    <header>
      <div><span className="eyebrow">NFL PICK’EM</span><h1>Snake Draft</h1><p className="muted">Room {room} · {players.length} players · 4 teams each</p></div>
      <div className="header-actions"><button className="secondary" onClick={enableNotifications}>Enable notifications</button><button className="secondary" onClick={copyInvite}>Copy invite</button><button className="secondary" onClick={newRoom}>New room</button></div>
    </header>

    <section className={`hero ${myTurn ? 'hero-hot' : ''}`}>
      <div><p className="eyebrow">{league.status === 'complete' ? 'DRAFT COMPLETE' : `PICK ${currentPick + 1} OF 32`}</p><h2>{league.status === 'complete' ? 'All 32 teams are drafted.' : myTurn ? '🔥 You’re on the clock' : `Waiting for ${currentPlayer?.name || 'the next player'}`}</h2><p className="muted">{league.status === 'drafting' ? `${32 - currentPick} selections remaining.` : league.status === 'complete' ? 'Save the final board for your season.' : 'The commissioner can start the draft when everyone has joined.'}</p></div>
      <div className="controls">{profile?.commissioner && league.status === 'setup' && <button onClick={startDraft}>Start draft</button>}{profile?.commissioner && <button className="danger" onClick={resetDraft}>Reset</button>}</div>
    </section>

    <div className="grid">
      <section className="panel"><div className="panel-head"><h3>Available teams</h3><span>{available.length} left</span></div><div className="teams">{available.map(team => <button key={team.code} className="team-btn" disabled={!myTurn} onClick={() => makePick(team.code)}><span className="team-code">{team.code}</span><span>{team.name}</span><b>+</b></button>)}</div></section>
      <aside className="panel"><div className="panel-head"><h3>Draft board</h3><span>{Math.min(currentPick + 1, 32)} / 32</span></div><div className="board">{players.map((player, i) => { const playerPicks = picks.filter(p => p.player_id === player.id); const active = league.status === 'drafting' && i === snakeSeat(currentPick, players.length); return <div className="row" key={player.id}><div className={`player ${active ? 'active' : ''}`}><strong>{i + 1}. {player.name}</strong>{active && <em>ON CLOCK</em>}{profile?.playerId === player.id && <small>YOU</small>}</div><div className="picks">{[0,1,2,3].map(n => { const p = playerPicks[n]; return <div className={`pick ${p ? 'filled' : ''}`} key={n}><small>{n + 1}</small>{p ? <><span className="team-code">{p.team_code}</span><span>{TEAM_MAP[p.team_code]?.name}</span></> : '—'}</div>; })}</div></div>})}</div></aside>
    </div>
    {notice && <div className="toast">{notice}</div>}
  </main>;
}

function JoinScreen({ room, league, players, loading, onCreate, onJoin, onNewRoom }) {
  const [names, setNames] = useState(Array.from({ length: 8 }, (_, i) => `Player ${i + 1}`));
  const readyToCreate = names.every(n => n.trim());
  return <main><div className="join-wrap"><header><div><span className="eyebrow">NFL PICK’EM</span><h1>Draft Room</h1></div><button className="secondary" onClick={onNewRoom}>New room</button></header>
    <section className="join-card"><div><span className="eyebrow">ROOM {room}</span><h2>{league ? 'Join the draft' : 'Set up your league'}</h2><p className="muted">Share this room URL with your league mates. Everyone can join from their phone or computer.</p></div>
    {!league ? <><div className="name-grid">{names.map((n,i)=><label key={i}><span>Player {i+1}</span><input value={n} onChange={e => setNames(v => v.map((x,j) => j===i?e.target.value:x))} /></label>)}</div><button className="primary wide" disabled={!readyToCreate || loading} onClick={() => onCreate(names)}>Create league</button></> : <div className="join-list">{players.map(p => <button key={p.id} className="join-player" onClick={() => onJoin(p)}><span>{p.draft_position}. {p.name}</span><span>Join →</span></button>)}</div>}
    </section></div></main>;
}
