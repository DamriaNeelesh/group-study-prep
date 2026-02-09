# Group Study Lecture Room

A scalable lecture room platform supporting 10,000+ concurrent users with real-time video sync, LiveKit A/V conferencing, and role-based permissions.

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Next.js   │────>│  Lecture Server │────>│   Supabase   │
│   Frontend  │     │ (Socket.IO+REST)│     │  (Auth + DB) │
└─────────────┘     └────────┬────────┘     └──────────────┘
       │                     │
       │              ┌──────┴──────┐
       └─────────────>│ LiveKit SFU │
                      │   (A/V)     │
                      └─────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Redis (for Socket.IO scaling)
- LiveKit Cloud account
- Supabase project

### 1. Install Dependencies

```bash
# Frontend
npm install

# Backend
cd services/lecture-server
npm install
```

### 2. Set Up LiveKit Cloud

1. Go to [LiveKit Cloud](https://cloud.livekit.io/)
2. Create a new project
3. Copy your credentials:
   - **LIVEKIT_URL**: `wss://your-app.livekit.cloud`
   - **LIVEKIT_API_KEY**: Your API key
   - **LIVEKIT_API_SECRET**: Your API secret

### 3. Configure Environment Variables

**Frontend (.env)**:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_LECTURE_API_URL=http://localhost:4000
```

**Backend (services/lecture-server/.env)**:
```env
PORT=4000
CLIENT_ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

### 4. Start Redis (Docker)

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 5. Run Development Servers

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
cd services/lecture-server
npm run dev
```

## 📦 Project Structure

```
├── src/
│   ├── components/
│   │   └── LectureRoom.tsx    # Main lecture UI
│   ├── hooks/
│   │   └── useLectureSocket.ts # Socket.IO client
│   └── lib/
│       └── lectureApi.ts       # REST API client
├── services/
│   └── lecture-server/         # Node.js backend
│       └── src/index.ts
└── infra/
    ├── docker-compose.yml
    └── nginx.conf
```

## 🎬 Features

### Roles
- **Host**: Full control (video sync, promote/demote speakers)
- **Speaker**: Can publish camera/mic (max 6)
- **Audience**: Watch-only, can raise hand

### YouTube Sync
- Host controls playback (play, pause, seek, load)
- Audience automatically syncs with drift correction
- Late joiners catch up immediately

### Raise Hand
1. Audience clicks "Raise Hand"
2. Host sees queue and approves
3. User is promoted to speaker
4. Camera/mic toggles appear

## 🚢 Production Deployment

### Docker Compose

```bash
cd infra
docker-compose up -d
```

### Sticky Sessions (Required for Socket.IO)

When running multiple server instances, you **must** configure sticky sessions at the load balancer. See `infra/nginx.conf` for `ip_hash` configuration.

## 📋 API Reference

### REST Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/rooms/create` | JWT | Create a new room |
| POST | `/api/rooms/:id/join` | JWT | Join an existing room |
| POST | `/api/livekit/token` | JWT | Get LiveKit token |
| POST | `/api/livekit/promote` | Host | Promote to speaker |
| POST | `/api/livekit/demote` | Host | Demote to audience |

### Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `room:join` | C→S | Join socket room |
| `room:state` | S→C | Initial state |
| `chat:send/message` | C↔S | Chat messaging |
| `hand:raise/queue` | C↔S | Raise hand system |
| `youtube:*` | C↔S | Playback sync |
| `role:updated` | S→C | Role changes |

## 🔒 Security Notes

- LiveKit tokens are minted server-side only
- Supabase RLS enforces room membership
- Host-only actions verified on both client and server
- Service role key never exposed to client
