# StudyRoom Realtime Service

Socket.IO v4 realtime backend for StudyRoom v2:

- Redis Streams adapter (cross-node fanout + replay)
- MessagePack payloads
- Server-authoritative room state (reference-time model)
- NTP-style clock sync helpers
- Basic rate limiting + Prometheus metrics

## Local dev

1. Ensure Redis is running.
2. Copy env:

```bash
cp .env.example .env
```

3. Install + run:

```bash
npm install
npm run dev
```

Health: `GET http://localhost:4000/healthz`  
Metrics: `GET http://localhost:4000/metrics`

