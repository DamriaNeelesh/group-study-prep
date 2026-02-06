-- StudyRoom (Serverless Edition) - initial schema
--
-- Creates:
-- - public.profiles: basic profile info (display name)
-- - public.rooms: authoritative YouTube sync state (reliable for late joiners)
--
-- Notes:
-- - RLS is enabled; policies are currently permissive for authenticated users.
-- - Anonymous auth users are considered "authenticated" after sign-in.

create extension if not exists "pgcrypto" with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_authenticated on public.profiles
for select to authenticated
using (true);

create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (auth.uid() = id);

create policy profiles_update_own on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Study Room',
  current_video_id text,
  is_paused boolean not null default true,
  playback_position_seconds double precision not null default 0,
  playback_rate double precision not null default 1,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

drop policy if exists rooms_select_authenticated on public.rooms;
drop policy if exists rooms_insert_authenticated on public.rooms;
drop policy if exists rooms_update_authenticated on public.rooms;
drop policy if exists rooms_delete_owner on public.rooms;

create policy rooms_select_authenticated on public.rooms
for select to authenticated
using (true);

create policy rooms_insert_authenticated on public.rooms
for insert to authenticated
with check (auth.uid() = created_by);

create policy rooms_update_authenticated on public.rooms
for update to authenticated
using (true)
with check (true);

create policy rooms_delete_owner on public.rooms
for delete to authenticated
using (auth.uid() = created_by);

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

