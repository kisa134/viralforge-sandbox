-- RLS / auth: business tables readable & writable ONLY by authenticated users whose email is in public.admins.
-- anon (publishable key) gets nothing. Edge functions use the service role (bypasses RLS) for click logging & webhooks.

create table if not exists public.admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    if t = 'admins' then
      execute 'create policy admin_all on public.admins for select to authenticated using ((select private.is_admin()))';
    else
      execute format('create policy admin_all on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    end if;
  end loop;
end $$;

-- Views run with the caller's rights (so RLS applies) and are not exposed to anon
alter view public.v_post_latest_metrics set (security_invoker = true);
alter view public.v_post_funnel set (security_invoker = true);
alter view public.v_order_margin set (security_invoker = true);
alter view public.v_creator_leaderboard set (security_invoker = true);
alter view public.v_formula_perf set (security_invoker = true);
alter view public.v_recruit_funnel set (security_invoker = true);
revoke all on public.v_post_latest_metrics, public.v_post_funnel, public.v_order_margin,
  public.v_creator_leaderboard, public.v_formula_perf, public.v_recruit_funnel from anon;

alter function public.approve_matured_commissions() set search_path = public;
revoke all on function public.approve_matured_commissions() from public, anon;
grant execute on function public.approve_matured_commissions() to authenticated;

-- Future objects created by this role: no anon access by default
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;
