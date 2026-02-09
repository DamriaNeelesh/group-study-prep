# StudyRoom (Serverless Edition)

Realtime collaborative study rooms with synchronized YouTube playback.

Stack:
- Next.js (App Router)
- Tailwind CSS
- Supabase (Auth, Postgres, Realtime Presence/Broadcast)
- Optional v2 sync backend: Socket.IO + Redis Streams

## Setup

1. Create a Supabase project.
2. Create the database tables via Supabase SQL editor (or Supabase MCP):
   - `public.rooms` (authoritative video state)
   - `public.profiles` (display names)

   SQL file: `supabase/studyroom_init.sql`
3. Enable auth:
   - Guest mode uses Supabase Anonymous Auth, so you must enable it:
     Supabase Dashboard -> Authentication -> Providers -> Anonymous -> Enable
   - Google sign-in is optional (still via Supabase Auth).

## Environment Variables

Copy `.env.example` to `.env.local` (or `.env`) and fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- (v2) `NEXT_PUBLIC_SYNC_BACKEND`
- (v2) `NEXT_PUBLIC_REALTIME_URL`
- (lecture) `NEXT_PUBLIC_LECTURE_API_URL` (defaults to `http://localhost:4001`)

## Dev

```bash
npm run dev
```

If using socket sync (v2), run the realtime service too:

```bash
npm run dev:realtime
```

If using Lecture rooms (LiveKit + Socket.IO backend), run the lecture server too:

```bash
npm run dev:lecture
```

More details: `LECTURE_ROOM_README.md`

Open `http://localhost:3000`:
- Create a room (generates a UUID and inserts into `public.rooms`)
- Paste a YouTube URL / video ID to sync

## Manual Test Checklist

1. Enable Anonymous provider in Supabase (see Setup step 3).
2. Open the app in 2 browser windows (or 1 normal + 1 incognito).
3. Window A: click "Create Room".
4. Window B: open the copied room link.
5. Set a YouTube video, then Play/Pause/Seek in one window and verify the other window follows.
6. Click "Raise Hand" and verify the toast + presence badge.
7. In the Room page, test "Meet":
   - Click "Join Meet"
   - Click "Camera On" / "Mic On" in both windows.
   - Verify you can see/hear the other participant.

If using socket sync (v2), Meet (mesh) is replaced by Stage (LiveKit).

## Notes

- Video sync uses:
  - Broadcast events for low-latency play/pause/seek
  - Database updates for a reliable "latest known state" for late joiners
- RLS is enabled; policies are currently permissive for authenticated users (including anonymous auth) to keep the prototype unblocked.

## StudyRoom v2 (10k-scale sync backend)

This repo includes an optional v2 realtime service under `services/realtime/`:

- Socket.IO + Redis Streams adapter (horizontal scaling)
- MessagePack payloads
- Server-authoritative room state with scheduled execution

### Supabase SQL (v2)

Run `supabase/studyroom_init.sql` first, then (when you are ready to switch to socket sync) run:
- `supabase/studyroom_v2.sql`

`supabase/studyroom_v2.sql` hardens RLS by denying client updates to `public.rooms`, so v1 sync will stop working if you apply it while still using Supabase Realtime for sync.

### Realtime service (v2)

1. `cd services/realtime`
2. Copy env: `cp .env.example .env`
3. Fill:
   - `REDIS_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET` (recommended; fallback auth is supported but slower)
4. Run:

```bash
npm run dev
```

Health: `http://localhost:4000/healthz`  
Metrics: `http://localhost:4000/metrics`

- Meet uses:
  - WebRTC (peer-to-peer mesh) for camera/mic
  - Supabase Realtime broadcast for signaling (offer/answer/ICE)
  - STUN only by default; for real-world reliability you will likely need a TURN server.
  - `getUserMedia()` requires HTTPS (or localhost) to access camera/microphone.
