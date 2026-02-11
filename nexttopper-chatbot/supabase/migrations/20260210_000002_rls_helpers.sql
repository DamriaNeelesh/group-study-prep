-- RLS helper functions should bypass row security to avoid recursion

create or replace function public.nt_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.nt_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.nt_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.nt_profiles p
    where p.id = auth.uid()
      and p.role in ('admin','counselor')
  );
$$;

