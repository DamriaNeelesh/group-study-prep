# StudyRoom (Serverless Edition)

Realtime collaborative study rooms with synchronized YouTube playback and WebRTC audio chat.

Stack:
- Next.js (App Router)
- Tailwind CSS
- Supabase (Auth, Postgres, Realtime Presence/Broadcast)
- simple-peer (WebRTC)

## Setup

1. Create a Supabase project.
2. Create the database tables:
   - `public.rooms` (authoritative video state)
   - `public.profiles` (display names)

   This repo already contains the client-side code; the SQL can be created via your Supabase dashboard SQL editor or via Supabase MCP.
3. Enable auth:
   - Recommended for this prototype: enable anonymous sign-ins so every browser gets a stable `auth.uid()` for Presence + signaling.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or a publishable key)

## Dev

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`:
- Create a room (generates a UUID and inserts into `public.rooms`)
- Paste a YouTube URL / video ID to sync
- Join audio chat to connect to other audio-enabled participants (signaling goes over Supabase Realtime broadcast)

## Notes

- Video sync uses:
  - Broadcast events for low-latency play/pause/seek
  - Database updates for a reliable “latest known state” for late joiners
- RLS is enabled on the tables created; policies are currently permissive for authenticated users (including anonymous auth) to keep the prototype unblocked.
