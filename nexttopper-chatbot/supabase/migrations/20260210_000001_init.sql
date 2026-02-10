-- Next Toppers AI Counselor schema (v1)

create extension if not exists "pgcrypto";

-- Helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null check (role in ('admin','counselor')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','counselor')
  );
$$;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
  on public.profiles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2) course_catalog
create table if not exists public.course_catalog (
  id uuid primary key default gen_random_uuid(),
  batch_key text unique not null,
  batch_name text not null,
  class_group text not null check (class_group in ('9','10','11_12')),
  target_exam text not null check (target_exam in ('board','jee','neet','mixed')),
  price_inr integer not null check (price_inr >= 0),
  start_date date,
  status text not null check (status in ('open','full','closed')),
  syllabus_url text,
  purchase_url text,
  highlights text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

drop trigger if exists course_catalog_set_updated_at on public.course_catalog;
create trigger course_catalog_set_updated_at
before update on public.course_catalog
for each row execute function public.set_updated_at();

alter table public.course_catalog enable row level security;

drop policy if exists "course_catalog_public_read" on public.course_catalog;
create policy "course_catalog_public_read"
  on public.course_catalog
  for select
  to anon, authenticated
  using (true);

drop policy if exists "course_catalog_admin_write" on public.course_catalog;
create policy "course_catalog_admin_write"
  on public.course_catalog
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3) offers
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  active boolean not null default true,
  valid_from date,
  valid_to date,
  updated_at timestamptz not null default now()
);

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at
before update on public.offers
for each row execute function public.set_updated_at();

alter table public.offers enable row level security;

drop policy if exists "offers_public_read" on public.offers;
create policy "offers_public_read"
  on public.offers
  for select
  to anon, authenticated
  using (true);

drop policy if exists "offers_admin_write" on public.offers;
create policy "offers_admin_write"
  on public.offers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4) timetable_entries
create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null references public.course_catalog(batch_key),
  date date not null,
  start_time time not null,
  end_time time not null,
  subject text not null,
  teacher text,
  meeting_link text,
  notes text,
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists timetable_entries_batch_date_idx
  on public.timetable_entries(batch_key, date);

drop trigger if exists timetable_entries_set_updated_at on public.timetable_entries;
create trigger timetable_entries_set_updated_at
before update on public.timetable_entries
for each row execute function public.set_updated_at();

alter table public.timetable_entries enable row level security;

drop policy if exists "timetable_public_read" on public.timetable_entries;
create policy "timetable_public_read"
  on public.timetable_entries
  for select
  to anon, authenticated
  using (true);

drop policy if exists "timetable_admin_write" on public.timetable_entries;
create policy "timetable_admin_write"
  on public.timetable_entries
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5) leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('student','parent','lead')),
  name text,
  phone_e164 text not null,
  class_moving_to text,
  target_exam text check (target_exam in ('board','jee','neet','mixed','unknown')),
  query_text text,
  source text not null,
  page_url text,
  utm jsonb not null default '{}'::jsonb,
  priority text not null default 'normal' check (priority in ('normal','high')),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_phone_idx on public.leads(phone_e164);

alter table public.leads enable row level security;

drop policy if exists "leads_staff_read" on public.leads;
create policy "leads_staff_read"
  on public.leads
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "leads_staff_update" on public.leads;
create policy "leads_staff_update"
  on public.leads
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- 6) support_tickets
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null check (issue_type in ('video_not_playing','pdf_not_opening','payment_failed','other')),
  issue_details text,
  nt_user_id text,
  nt_user_name text,
  nt_user_mobile text,
  phone_e164 text,
  page_url text,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_created_at_idx on public.support_tickets(created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "support_tickets_staff_read" on public.support_tickets;
create policy "support_tickets_staff_read"
  on public.support_tickets
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "support_tickets_staff_update" on public.support_tickets;
create policy "support_tickets_staff_update"
  on public.support_tickets
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- 7) chat logging
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  nt_user_id text,
  nt_user_name text,
  nt_user_mobile text,
  persona text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at();

alter table public.chat_sessions enable row level security;

drop policy if exists "chat_sessions_staff_read" on public.chat_sessions;
create policy "chat_sessions_staff_read"
  on public.chat_sessions
  for select
  to authenticated
  using (public.is_staff());

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','bot','system')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on public.chat_messages(session_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_staff_read" on public.chat_messages;
create policy "chat_messages_staff_read"
  on public.chat_messages
  for select
  to authenticated
  using (public.is_staff());

-- 8) user_enrollments
create table if not exists public.user_enrollments (
  id uuid primary key default gen_random_uuid(),
  nt_user_id text unique not null,
  batch_key text not null references public.course_catalog(batch_key),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_enrollments_set_updated_at on public.user_enrollments;
create trigger user_enrollments_set_updated_at
before update on public.user_enrollments
for each row execute function public.set_updated_at();

alter table public.user_enrollments enable row level security;

drop policy if exists "user_enrollments_staff_read" on public.user_enrollments;
create policy "user_enrollments_staff_read"
  on public.user_enrollments
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists "user_enrollments_staff_write" on public.user_enrollments;
create policy "user_enrollments_staff_write"
  on public.user_enrollments
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Optional: KB (for LLM fallback + search)
create table if not exists public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  tags text[] not null default '{}'::text[],
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
  ) stored,
  updated_at timestamptz not null default now()
);

create index if not exists kb_articles_search_idx on public.kb_articles using gin (search);

drop trigger if exists kb_articles_set_updated_at on public.kb_articles;
create trigger kb_articles_set_updated_at
before update on public.kb_articles
for each row execute function public.set_updated_at();

alter table public.kb_articles enable row level security;

drop policy if exists "kb_articles_public_read" on public.kb_articles;
create policy "kb_articles_public_read"
  on public.kb_articles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "kb_articles_admin_write" on public.kb_articles;
create policy "kb_articles_admin_write"
  on public.kb_articles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Seed data (safe to re-run)
insert into public.course_catalog (
  batch_key, batch_name, class_group, target_exam, price_inr, start_date, status, highlights
)
values
  ('aarambh_9', 'Aarambh Batch (Class 9)', '9', 'board', 3500, '2026-03-15', 'open', array['Live Classes','Notes','Practice Tests']),
  ('abhay_10', 'Abhay Batch (Class 10)', '10', 'board', 3500, '2026-03-15', 'open', array['Live Classes','Notes','DPPs','Test Series']),
  ('prarambh_11_12', 'Prarambh Batch (Class 11/12)', '11_12', 'mixed', 4999, '2026-03-15', 'open', array['Live Classes','Notes','DPPs','JEE/NEET Guidance'])
on conflict (batch_key) do update
set
  batch_name = excluded.batch_name,
  class_group = excluded.class_group,
  target_exam = excluded.target_exam,
  price_inr = excluded.price_inr,
  start_date = excluded.start_date,
  status = excluded.status,
  highlights = excluded.highlights;

insert into public.user_enrollments (nt_user_id, batch_key)
values ('TEST_NT_1001', 'abhay_10')
on conflict (nt_user_id) do update
set batch_key = excluded.batch_key;

insert into public.offers (title, description, active)
values ('Early Bird', 'Early enrollment discount (limited time).', true)
on conflict do nothing;

insert into public.kb_articles (title, content, tags)
values
  ('Installments / EMI', 'Installments/EMI availability depends on the current batch and payment partner. Please request a callback for exact options.', array['fees','installment','emi']),
  ('Video Not Playing', 'Try: 1) Clear app cache 2) Update the Next Toppers app 3) Switch network. If still not working, raise a ticket.', array['support','video']),
  ('PDF Not Opening', 'Try: 1) Update the app 2) Re-download PDF 3) Use a different PDF viewer. If still not working, raise a ticket.', array['support','pdf'])
on conflict do nothing;
