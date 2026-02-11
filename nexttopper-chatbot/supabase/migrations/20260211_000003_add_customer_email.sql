-- Add email support and customer profiles for Next Toppers chatbot

alter table if exists public.nt_chat_sessions
  add column if not exists nt_user_email text;

alter table if exists public.nt_leads
  add column if not exists email text;

alter table if exists public.nt_support_tickets
  add column if not exists email text;

create table if not exists public.nt_customer_profiles (
  id uuid primary key default gen_random_uuid(),
  nt_user_id text unique,
  email text unique not null,
  name text,
  phone_e164 text,
  last_purchase_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists nt_customer_profiles_set_updated_at on public.nt_customer_profiles;
create trigger nt_customer_profiles_set_updated_at
before update on public.nt_customer_profiles
for each row execute function public.nt_set_updated_at();

create index if not exists nt_customer_profiles_email_idx on public.nt_customer_profiles(email);

alter table public.nt_customer_profiles enable row level security;

drop policy if exists "nt_customer_profiles_staff_read" on public.nt_customer_profiles;
create policy "nt_customer_profiles_staff_read"
  on public.nt_customer_profiles
  for select
  to authenticated
  using (public.nt_is_staff());

drop policy if exists "nt_customer_profiles_staff_write" on public.nt_customer_profiles;
create policy "nt_customer_profiles_staff_write"
  on public.nt_customer_profiles
  for all
  to authenticated
  using (public.nt_is_staff())
  with check (public.nt_is_staff());

-- Seed a test customer profile (safe to re-run)
insert into public.nt_customer_profiles (nt_user_id, email, name, phone_e164)
values ('TEST_NT_1001', 'rahul@example.com', 'Rahul', '+919999999999')
on conflict (email) do update
set nt_user_id = excluded.nt_user_id,
    name = excluded.name,
    phone_e164 = excluded.phone_e164;
