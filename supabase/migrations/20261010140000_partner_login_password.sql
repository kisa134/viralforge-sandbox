-- Partners register with LOGIN + PASSWORD (no email). The `partner-signup` edge function (service role) creates an auth user
-- with an internal, never-delivered address <login>@partners.likky.invalid, email_confirm = true, app_metadata.login = <login>,
-- and the creator row (display_name = login). No email is ever sent.

alter table public.creator add column if not exists login text;
create unique index if not exists creator_login_uk on public.creator (lower(login));

-- Per-IP signup throttle (written only by the edge function via service role; admins may read)
create table if not exists public.signup_attempt (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  ok          boolean not null default false,
  login       text,
  created_at  timestamptz not null default now()
);
create index if not exists signup_attempt_ip_time on public.signup_attempt (ip_hash, created_at desc);
alter table public.signup_attempt enable row level security;
revoke all on public.signup_attempt from anon, authenticated;
grant select on public.signup_attempt to authenticated;
drop policy if exists admin_all on public.signup_attempt;
create policy admin_all on public.signup_attempt for select to authenticated using ((select private.is_admin()));

-- Admins by email OR by partner login. app_metadata is server-controlled (users cannot edit it), unlike user_metadata.
alter table public.admins drop constraint if exists admins_pkey;
alter table public.admins alter column email drop not null;
alter table public.admins add column if not exists login text;
alter table public.admins add column if not exists id bigint generated always as identity;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admins_pk_id') then
    alter table public.admins add constraint admins_pk_id primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admins_email_uk') then
    alter table public.admins add constraint admins_email_uk unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admins_login_uk') then
    alter table public.admins add constraint admins_login_uk unique (login);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admins_login_lower') then
    alter table public.admins add constraint admins_login_lower check (login = lower(login));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admins_email_or_login') then
    alter table public.admins add constraint admins_email_or_login check (email is not null or login is not null);
  end if;
end $$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where (a.email is not null and a.email = lower(coalesce((select auth.jwt()) ->> 'email', '')))
       or (a.login is not null and a.login = lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'login', '')))
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- Profile payload now includes login
create or replace function private.partner_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'nick', c.display_name, 'login', c.login, 'telegram', c.telegram, 'handles', c.handles,
    'status', c.status, 'email', c.email, 'created_at', c.created_at)
  from public.creator c where c.auth_user_id = (select auth.uid());
$$;

-- ───────── Approval: new partners are PENDING until an admin approves ─────────
alter table public.creator drop constraint if exists creator_status_check;
alter table public.creator add constraint creator_status_check
  check (status in ('PENDING','ACTIVE','FROZEN','BANNED','CHURNED','REJECTED'));

-- Email-auth fallback path also creates PENDING partners (no bypass of approval)
create or replace function private.partner_register(p_nick text, p_telegram text, p_handles jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_nick text := lower(regexp_replace(trim(coalesce(p_nick, '')), '^@', ''));
  v_tg text := left(regexp_replace(trim(coalesce(p_telegram, '')), '^@?', '@'), 40);
  v_h jsonb := '{}'::jsonb;
  k text; v text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Войдите заново' using errcode = '28000'; end if;
  if v_tg = '@' then v_tg := null; end if;
  foreach k in array array['IG','TT','YT'] loop
    v := left(trim(coalesce(p_handles ->> k, '')), 60);
    if v <> '' then v_h := v_h || jsonb_build_object(k, v); end if;
  end loop;

  select id into v_id from public.creator where auth_user_id = v_uid;
  if v_id is not null then
    -- Existing partner: only contacts can change (nick/login is part of every link; status is admin-only)
    update public.creator set telegram = v_tg, handles = v_h, contact = coalesce(v_tg, contact) where id = v_id;
    return private.partner_me();
  end if;

  if v_nick !~ '^[a-z0-9_]{3,24}$' then raise exception 'Ник: 3–24 символа, латиница, цифры или _'; end if;
  select id into v_id from public.creator where auth_user_id is null and v_email <> '' and lower(email) = v_email limit 1;
  if v_id is not null then
    update public.creator set auth_user_id = v_uid, telegram = v_tg, handles = v_h, contact = coalesce(v_tg, contact) where id = v_id;
    return private.partner_me();
  end if;
  if exists (select 1 from public.creator where lower(display_name) = v_nick or lower(login) = v_nick) then
    raise exception 'Ник «%» уже занят — выберите другой', v_nick;
  end if;
  insert into public.creator (type, display_name, login, email, telegram, contact, handles, status, self_signup, auth_user_id)
  values ('PARTNER_HUMAN', v_nick, v_nick, nullif(v_email, ''), v_tg, v_tg, v_h, 'PENDING', true, v_uid);
  return private.partner_me();
end $$;

-- Catalog only for ACTIVE partners
create or replace function private.partner_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id, 'title', p.title, 'handle', p.handle, 'pdp_url', p.pdp_url, 'price_cents', p.price_cents,
    'image_url', p.image_url, 'pitch', p.pitch,
    'payout_rule', ep.rule, 'payout_value', ep.value) order by p.price_cents desc, p.title), '[]'::jsonb)
  from public.product p
  join lateral (select o.id from public.offer o where o.product_id = p.id and o.status = 'LIVE' order by o.created_at limit 1) o on true
  cross join lateral private.effective_payout((select private.my_creator_id()), o.id) ep
  where p.status = 'ACTIVE'
    and exists (select 1 from public.creator c where c.auth_user_id = (select auth.uid()) and c.status = 'ACTIVE');
$$;
-- partner_create_link already refuses non-ACTIVE partners («Аккаунт приостановлен»); make the pending message explicit
create or replace function private.partner_create_link(p_product uuid, p_platform text, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.creator%rowtype;
  p public.product%rowtype;
  v_offer uuid; v_n int; v_slug text; v_src text; v_dest text;
  v_label text := nullif(left(trim(coalesce(p_label, '')), 60), '');
begin
  select * into c from public.creator where auth_user_id = (select auth.uid());
  if not found then raise exception 'Сначала заполните профиль'; end if;
  if c.status = 'PENDING' then raise exception 'Заявка ещё на рассмотрении — ссылки появятся после одобрения'; end if;
  if c.status <> 'ACTIVE' then raise exception 'Доступ закрыт — напишите нам'; end if;
  if p_platform not in ('IG','TT','YT') then raise exception 'Неизвестная площадка'; end if;
  select * into p from public.product where id = p_product and status = 'ACTIVE';
  if not found then raise exception 'Товар не найден'; end if;
  select id into v_offer from public.offer where product_id = p.id and status = 'LIVE' order by created_at limit 1;
  if v_offer is null then raise exception 'Товар сейчас недоступен'; end if;
  if (select count(*) from public.tracked_link where creator_id = c.id) >= 200 then raise exception 'Слишком много ссылок — напишите нам'; end if;
  v_n := (select count(*) from public.tracked_link where creator_id = c.id) + 1;
  loop
    v_slug := c.display_name || '-' || v_n;
    exit when not exists (select 1 from public.tracked_link where token = v_slug);
    v_n := v_n + 1;
  end loop;
  v_src := case p_platform when 'IG' then 'instagram' when 'TT' then 'tiktok' else 'youtube' end;
  v_dest := coalesce(p.pdp_url, 'https://likky.store/products/' || p.handle)
    || '?ref=' || v_slug || '&utm_source=' || v_src || '&utm_medium=creator&utm_campaign=' || c.display_name || '&utm_content=' || v_slug;
  insert into public.tracked_link (token, creator_id, offer_id, platform, dest_url, utm_source, utm_medium, utm_campaign, utm_content, label)
  values (v_slug, c.id, v_offer, p_platform, v_dest, v_src, 'creator', c.display_name, v_slug, v_label);
  return jsonb_build_object('token', v_slug, 'dest_url', v_dest, 'platform', p_platform, 'label', v_label, 'product_title', p.title);
end $$;

-- ───────── Admin RPCs (private SECURITY DEFINER, each checks private.is_admin(); public invoker wrappers) ─────────
create or replace function private.admin_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select private.is_admin()), false) then raise exception 'Только для админа' using errcode = '42501'; end if;
end $$;

create or replace function private.admin_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('is_admin', coalesce((select private.is_admin()), false),
    'login', (select auth.jwt()) -> 'app_metadata' ->> 'login', 'email', (select auth.jwt()) ->> 'email');
$$;

create or replace function private.admin_partners() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.admin_check();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'login', coalesce(c.login, c.display_name), 'nick', c.display_name, 'telegram', c.telegram, 'handles', c.handles,
    'status', c.status, 'self_signup', c.self_signup, 'has_account', c.auth_user_id is not null, 'created_at', c.created_at,
    'payout_rule', c.payout_rule, 'payout_value', c.payout_value,
    'links', (select count(*) from public.tracked_link t where t.creator_id = c.id),
    'clicks', (select count(*) from public.click k join public.tracked_link t on t.token = k.token where t.creator_id = c.id and not k.is_bot),
    'orders', (select count(*) from public.conversion cv join public."order" o on o.id = cv.order_id
               where cv.creator_id = c.id and cv.is_valid and o.financial_status not in ('REFUNDED','VOIDED','CHARGEBACK')),
    'revenue_cents', coalesce((select sum(o.subtotal_cents) from public.conversion cv join public."order" o on o.id = cv.order_id
               where cv.creator_id = c.id and cv.is_valid and o.financial_status not in ('REFUNDED','VOIDED','CHARGEBACK')), 0),
    'earned_cents', coalesce((select sum(cm.amount_cents) from public.commission cm where cm.creator_id = c.id and cm.status <> 'VOID'), 0),
    'paid_cents', coalesce((select sum(cm.amount_cents) from public.commission cm where cm.creator_id = c.id and cm.status = 'PAID'), 0)
  ) order by c.created_at desc), '[]'::jsonb) into r
  from public.creator c where c.type = 'PARTNER_HUMAN';
  return r;
end $$;

create or replace function private.admin_set_partner_status(p_creator uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  if p_status not in ('PENDING','ACTIVE','FROZEN','REJECTED') then raise exception 'Неверный статус'; end if;
  update public.creator set status = p_status,
    activated_at = case when p_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end
  where id = p_creator;
  if not found then raise exception 'Партнёр не найден'; end if;
end $$;

create or replace function private.admin_set_partner_rate(p_creator uuid, p_rule text, p_value numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  if p_rule is not null and p_rule not in ('CPA_FIXED','PCT_REVENUE','PCT_MARGIN') then raise exception 'Неверное правило'; end if;
  if p_value is not null and (p_value < 0 or (p_rule <> 'CPA_FIXED' and p_value > 1)) then raise exception 'Неверное значение ставки'; end if;
  update public.creator set payout_rule = p_rule, payout_value = case when p_rule is null then null else p_value end where id = p_creator;
  if not found then raise exception 'Партнёр не найден'; end if;
end $$;

create or replace function private.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.admin_check();
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'login', a.login, 'email', a.email, 'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
  into r from public.admins a;
  return r;
end $$;

create or replace function private.admin_add_admin(p_login text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := lower(regexp_replace(trim(coalesce(p_login, '')), '^@', ''));
begin
  perform private.admin_check();
  if v !~ '^[a-z0-9_]{3,24}$' then raise exception 'Логин: 3–24 символа, латиница, цифры или _'; end if;
  if not exists (select 1 from auth.users u where u.raw_app_meta_data ->> 'login' = v) then
    raise exception 'Нет аккаунта с логином «%». Пусть сначала зарегистрируется на /partner/', v;
  end if;
  insert into public.admins (login) values (v) on conflict (login) do nothing;
end $$;

create or replace function private.admin_remove_admin(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  if (select count(*) from public.admins) <= 1 then raise exception 'Нельзя удалить последнего админа'; end if;
  if exists (select 1 from public.admins a where a.id = p_id and (
       a.login = lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'login', ''))
       or a.email = lower(coalesce((select auth.jwt()) ->> 'email', '')))) then
    raise exception 'Нельзя удалить самого себя';
  end if;
  delete from public.admins where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.admin_check()', 'private.admin_whoami()', 'private.admin_partners()',
    'private.admin_set_partner_status(uuid, text)', 'private.admin_set_partner_rate(uuid, text, numeric)',
    'private.admin_list_admins()', 'private.admin_add_admin(text)', 'private.admin_remove_admin(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

create or replace function public.admin_whoami() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.admin_whoami(); $$;
create or replace function public.admin_partners() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.admin_partners(); $$;
create or replace function public.admin_set_partner_status(p_creator uuid, p_status text) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_partner_status(p_creator, p_status); $$;
create or replace function public.admin_set_partner_rate(p_creator uuid, p_rule text, p_value numeric) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_partner_rate(p_creator, p_rule, p_value); $$;
create or replace function public.admin_list_admins() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.admin_list_admins(); $$;
create or replace function public.admin_add_admin(p_login text) returns void language sql security invoker set search_path = '' as $$ select private.admin_add_admin(p_login); $$;
create or replace function public.admin_remove_admin(p_id bigint) returns void language sql security invoker set search_path = '' as $$ select private.admin_remove_admin(p_id); $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_whoami()', 'public.admin_partners()',
    'public.admin_set_partner_status(uuid, text)', 'public.admin_set_partner_rate(uuid, text, numeric)',
    'public.admin_list_admins()', 'public.admin_add_admin(text)', 'public.admin_remove_admin(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
