# Next Toppers AI Counselor (Widget + Supabase + Admin)

This repo contains:

- `apps/widget`: embeddable chatbot widget (builds IIFE + ESM via Vite)
- `apps/admin`: admin panel (courses/offers/timetable/leads/tickets)
- `apps/demo`: demo harness to test the widget end-to-end
- `supabase/`: SQL migration + Edge Functions source
- `scripts/`: Supabase bootstrap automation

## 1) Bootstrap Supabase (one command)

From the repo root:

```powershell
pnpm supabase:bootstrap
```

This will:

- Apply the DB migration
- Create/update project secrets used by Edge Functions
- Deploy Edge Functions: `bot_start`, `bot_event`, `lead_create`, `ticket_create`
- Create test auth users and their `profiles` roles
- Write `apps/admin/.env` and `apps/demo/.env` for local dev

Optional env vars you can set before running bootstrap:

- `SALES_ALERT_EMAIL` (defaults to `SUPPORT_INBOX_EMAIL`)
- `SUPPORT_INBOX_EMAIL` (defaults to `support@nexttoppers.com`)
- `RESEND_API_KEY`, `RESEND_FROM` (for emails)
- `OPENAI_API_KEY`, `OPENAI_MODEL` (for LLM fallback)
- `NT_TEST_PASSWORD` (defaults to `NextToppers#1234`)

## 2) Run locally

```powershell
pnpm dev
```

- Admin: Vite prints the URL in terminal (default 5173-ish)
- Demo: Vite prints the URL (open it, then open the widget button bottom-right)

## 3) Build

```powershell
pnpm build
```

Widget build output:

- `apps/widget/dist/nexttoppers-widget.iife.js`
- `apps/widget/dist/nexttoppers-widget.es.js`
- `apps/widget/dist/nexttoppers-widget.css`
