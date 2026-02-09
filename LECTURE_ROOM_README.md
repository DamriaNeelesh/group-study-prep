# Group Study Lecture Room

Lecture rooms backed by a Node.js server (REST + Socket.IO) with LiveKit for camera/mic.

Default local ports:
- Frontend (Next.js): `http://localhost:3000`
- Lecture server (REST + Socket.IO): `http://localhost:4001`
- Optional v2 realtime service (Socket.IO + Redis Streams): `http://localhost:4000`
- Redis: `6379`

## Quick Start (Local Dev)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure env

Frontend:
- Copy `.env.example` to `.env.local` (or `.env`) and set:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_LECTURE_API_URL` (default `http://localhost:4001`)

Lecture server:
- Copy `services/lecture-server/.env.example` to `services/lecture-server/.env`
- Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`
- Set `CLIENT_ORIGIN` (CORS allowlist). It can be a comma-separated list and supports wildcards like `https://*.vercel.app`.

### 3. Start Redis (optional but recommended)

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

Or use Docker Compose (starts `redis` + `lecture-server`):

```bash
cd infra
docker compose up -d --build
```

To also start the v2 realtime service:

```bash
cd infra
docker compose --profile realtime up -d --build
```

### 4. Run the app

Terminal 1 (frontend):
```bash
npm run dev
```

Terminal 2 (lecture server):
```bash
npm run dev:lecture
```

Optional Terminal 3 (v2 realtime service):
```bash
npm run dev:realtime
```

Health checks:
- Lecture server: `http://localhost:4001/api/health`
- Realtime service (v2): `http://localhost:4000/healthz`

## Product Flow

1. Open `http://localhost:3000`
2. Click "Create Room"
3. In the room header, use "Invite" or "Copy Link" to share the room
4. Others open the link and join
5. Audience can "Raise Hand"
6. Host approves raised hands; approved users become "Speaker" and can enable camera/mic

## Troubleshooting

### WebSocket error: `ws://localhost:4001/socket.io ... failed`

This almost always means the lecture server is not running on `4001`.

1. Start it with `npm run dev:lecture`
2. Confirm the health endpoint works: `http://localhost:4001/api/health`

### Console errors like `chrome-extension://invalid/ net::ERR_FAILED`

Those are usually caused by a browser extension injecting a content script. Try Incognito (extensions disabled) or disable extensions temporarily.

### Anonymous auth errors

This app relies on Supabase Anonymous Auth for "guest" users. Enable it in Supabase Dashboard:
Authentication -> Providers -> Anonymous -> Enable.

## Production Notes

- Your Vercel frontend must talk to a **public** lecture server URL (not `localhost`).
- Set on Vercel (Project -> Settings -> Environment Variables):
  - `NEXT_PUBLIC_LECTURE_API_URL=https://<your-lecture-server-domain>` (set for both Preview and Production)

Lecture server deployment requirements:
- Must support **WebSockets** (Socket.IO). Vercel Serverless Functions are not a good fit for long-lived Socket.IO connections.
- Use a platform like Render / Railway / Fly.io / a VPS (Docker works well).

Lecture server env in production:
- `CLIENT_ORIGIN` must include your Vercel origin(s), for example:
  - `CLIENT_ORIGIN=https://*.vercel.app,https://your-custom-domain.com`
- Also set:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `LIVEKIT_URL`
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET`
  - Optional: `REDIS_URL` (recommended if you plan to scale beyond 1 instance)

- If you run multiple lecture-server instances behind a load balancer, you must use sticky sessions for Socket.IO long-polling fallback.
  See `infra/nginx.conf` for an example `ip_hash` configuration.
