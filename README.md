# NFL Pick'em Draft — Free MVP

A polished 8-player, 32-team, 4-round snake-draft room built with Next.js + Supabase.

## Included
- Commissioner creates an 8-player league in a unique room.
- Every player joins by clicking their name in the room.
- Server-side `make_pick` RPC validates turn order and team availability.
- Automatic snake order: 1→8, 8→1, 1→8, 8→1.
- Realtime room refreshes through Supabase Broadcast.
- Browser notification when you become the active picker.
- Draft board, remaining teams, invite link, reset, and completion state.

## Free deployment
1. Create a free Supabase project.
2. Open Supabase SQL Editor and run `supabase.sql`.
3. In the project settings, copy the project URL and anon/publishable key.
4. Add these environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Deploy this folder to a Vercel Hobby project.

No SMS/email provider is required. Browser notifications are free and local to each participant's device.

## Local development
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Security note
The client cannot directly insert picks. All drafting actions go through SECURITY DEFINER PostgreSQL functions that enforce commissioner permissions, turn order, uniqueness, and the 32-pick limit. This is appropriate for a small private league, while a future public product should add real authentication and stronger identity verification.
