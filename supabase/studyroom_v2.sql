-- StudyRoom v2 - scaled sync + stage roles
--
-- Run this in Supabase SQL editor AFTER `supabase/studyroom_init.sql`.
--
-- Notes:
-- - This hardens RLS by preventing clients from updating `public.rooms` directly.
--   The Socket.IO realtime service should use the Supabase SERVICE ROLE key to write.
-- - Existing columns remain for backwards compatibility.

-- 1) Rooms: add server-authoritative reference-time fields
alter table public.rooms
  add column if not exists state_seq bigint not null default 0,
  add column if not exists reference_time timestamptz not null default now(),
  add column if not exists video_time_at_reference double precision not null default 0,
  add column if not exists playback_state text not null default 'paused',
  add column if not exists controller_user_id uuid,
  add column if not exists audience_delay_seconds integer not null default 0;

-- Basic constraint for playback_state
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rooms_playback_state_check'
  ) then
    alter table public.rooms
      add constraint rooms_playback_state_check
      check (playback_state in ('playing', 'paused'));
  end if;
end $$;

-- Backfill new fields for existing rows
-- NOTE: `reference_time` is created with a default, so existing rows will not be NULL.
-- We only backfill rows that haven't been "touched" by v2 yet (state_seq = 0).
update public.rooms
set
  reference_time = updated_at,
  video_time_at_reference = playback_position_seconds,
  playback_state = case when is_paused then 'paused' else 'playing' end,
  controller_user_id = coalesce(controller_user_id, created_by)
where
  state_seq = 0;

-- 2) RLS hardening: clients can no longer update rooms directly
drop policy if exists rooms_update_authenticated on public.rooms;
create policy rooms_update_authenticated on public.rooms
for update to authenticated
using (false)
with check (false);

-- 3) Stage roles (LiveKit gating)
create table if not exists public.room_stage_roles (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_stage_roles_role_check'
  ) then
    alter table public.room_stage_roles
      add constraint room_stage_roles_role_check
      check (role in ('host', 'speaker', 'audience'));
  end if;
end $$;

alter table public.room_stage_roles enable row level security;

drop policy if exists room_stage_roles_select_authenticated on public.room_stage_roles;
drop policy if exists room_stage_roles_insert_denied on public.room_stage_roles;
drop policy if exists room_stage_roles_update_denied on public.room_stage_roles;
drop policy if exists room_stage_roles_delete_denied on public.room_stage_roles;

create policy room_stage_roles_select_authenticated on public.room_stage_roles
for select to authenticated
using (true);

-- Deny client writes; realtime service should use service role.
create policy room_stage_roles_insert_denied on public.room_stage_roles
for insert to authenticated
with check (false);

create policy room_stage_roles_update_denied on public.room_stage_roles
for update to authenticated
using (false)
with check (false);

create policy room_stage_roles_delete_denied on public.room_stage_roles
for delete to authenticated
using (false);

-- 4) Stage stream metadata (HLS playback for Audience)
create table if not exists public.room_stage_streams (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  provider text,
  hls_playback_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.room_stage_streams enable row level security;

drop policy if exists room_stage_streams_select_authenticated on public.room_stage_streams;
drop policy if exists room_stage_streams_insert_denied on public.room_stage_streams;
drop policy if exists room_stage_streams_update_denied on public.room_stage_streams;
drop policy if exists room_stage_streams_delete_denied on public.room_stage_streams;

create policy room_stage_streams_select_authenticated on public.room_stage_streams
for select to authenticated
using (true);

-- Deny client writes; realtime service should use service role.
create policy room_stage_streams_insert_denied on public.room_stage_streams
for insert to authenticated
with check (false);

create policy room_stage_streams_update_denied on public.room_stage_streams
for update to authenticated
using (false)
with check (false);

create policy room_stage_streams_delete_denied on public.room_stage_streams
for delete to authenticated
using (false);

drop trigger if exists room_stage_streams_set_updated_at on public.room_stage_streams;
create trigger room_stage_streams_set_updated_at
before update on public.room_stage_streams
for each row execute function public.set_updated_at();
