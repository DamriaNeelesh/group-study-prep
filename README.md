# StudyRoom (Serverless Edition)

Realtime collaborative study rooms with synchronized YouTube playback.

Stack:
- Next.js (App Router)
- Tailwind CSS
- Supabase (Auth, Postgres, Realtime Presence/Broadcast)

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

## Dev

```bash
npm run dev
```

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

## Notes

- Video sync uses:
  - Broadcast events for low-latency play/pause/seek
  - Database updates for a reliable "latest known state" for late joiners
- RLS is enabled; policies are currently permissive for authenticated users (including anonymous auth) to keep the prototype unblocked.
