-- StudyRoom - API keys + telemetry tracking
--
-- Run AFTER `supabase/studyroom_init.sql` (and optionally `supabase/studyroom_v2.sql`).
--
-- This file adds:
-- - public.api_keys: API keys for admin/telemetry access (hashed, revocable)
-- - public.telemetry_events: server-side event log for room activity
--
-- Security:
-- - RLS is enabled with no policies, so authenticated clients cannot read/write.
-- - Supabase SERVICE ROLE bypasses RLS (used by backend services / server routes).

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_created_by_idx
on public.api_keys(created_by);

create index if not exists api_keys_revoked_at_idx
on public.api_keys(revoked_at);

alter table public.api_keys enable row level security;

create table if not exists public.telemetry_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null default 'realtime',
  room_id uuid references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists telemetry_events_room_at_idx
on public.telemetry_events(room_id, at desc);

create index if not exists telemetry_events_type_at_idx
on public.telemetry_events(type, at desc);

create index if not exists telemetry_events_user_at_idx
on public.telemetry_events(user_id, at desc);

alter table public.telemetry_events enable row level security;

