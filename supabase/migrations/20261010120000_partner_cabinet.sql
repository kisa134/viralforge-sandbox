-- Partner (creator) cabinet: self-signup via Supabase Auth (email OTP / magic link), personal tracked links, own stats.
-- Security model:
--   * Partners get NO direct table access except SELECT on their own creator row and their own tracked links (RLS).
--   * All partner writes and all stats go through public SECURITY INVOKER wrappers → private SECURITY DEFINER functions
--     (private schema is not exposed by the API). Each private function scopes by auth.uid() → creator.auth_user_id.
--   * Stats are aggregates only: no buyer PII (customer_hash, landing_site, note_attributes, names, emails) ever leaves.
--   * Admins (public.admins) keep full access via the existing admin_all policies.

-- ── Schema additions ──
alter table public.creator add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.creator add column if not exists email text;
alter table public.creator add column if not exists telegram text;
alter table public.creator add column if not exists self_signup boolean not null default false;
create index if not exists creator_email_idx on public.creator (lower(email));
create unique index if not exists creator_display_name_uk on public.creator (lower(display_name));

alter table public.product add column if not exists image_url text;
alter table public.product add column if not exists pitch text;
alter table public.tracked_link add column if not exists label text;
create index if not exists tracked_link_creator_idx on public.tracked_link (creator_id);
create index if not exists conversion_creator_idx on public.conversion (creator_id);
create index if not exists payout_creator_idx on public.payout (creator_id);
create index if not exists attribution_touch_creator_idx on public.attribution_touch (creator_id);

-- Catalog photos (likky.store Shopify CDN) + short pitch for partners
update public.product p set image_url = v.img, pitch = v.pitch
from (values
  ('study-room-creative-night-light-resin-ornaments', 'https://cdn.shopify.com/s/files/1/1078/5524/9749/files/3_c27215ee-716b-4bc8-89fe-59a388b305e2.png?v=1789848263&width=600',
   'Дракон на хрустальном шаре, тёплое свечение. Хит для «до/после» в тёмной комнате и как подарок.'),
  ('luminous-witchs-cauldron-lamp-resin-craft', 'https://cdn.shopify.com/s/files/1/1078/5524/9749/files/5_06362d4f-4f7b-470a-997e-5e840a180050.png?v=1789848265&width=600',
   'Светящийся котёл ведьмы. Уютный Хэллоуин-декор: щелчок — и комната оживает.'),
  ('design-a-resin-lantern-as-a-halloween-gift', 'https://cdn.shopify.com/s/files/1/1078/5524/9749/files/2_34b5587e-fd46-4d8d-a107-f15ba79e0f16.png?v=1789848264&width=600',
   'Огненный дракон-фонарь. Самый эффектный кадр в темноте, самый дорогой чек.'),
  ('bat-wing-table-lamp-halloween-resin-ornaments', 'https://cdn.shopify.com/s/files/1/1078/5524/9749/files/2_763a1b8f-1b4f-4f47-bc14-c2a543d1bc7f.png?v=1789848262&width=600',
   'Лампа с крыльями летучей мыши. Spooky-декор для полки и стола.'),
  ('new-baby-halloween-long-sleeved-jumpsuit-pumpkin-letter-halloween-baby-jumpsuits-triangle-rompers', 'https://cdn.shopify.com/s/files/1/1078/5524/9749/files/3_d755a89d-d636-4a0d-81a7-761c0d015904.png?v=1789848260&width=600',
   'Костюм летучей мыши для малыша. Милота для мам: первый Хэллоуин.')
) as v(handle, img, pitch)
where p.handle = v.handle;

-- ── Direct read access for partners: own creator row and own links only ──
create or replace function private.my_creator_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.creator c where c.auth_user_id = (select auth.uid()) limit 1;
$$;
revoke all on function private.my_creator_id() from public, anon;
grant execute on function private.my_creator_id() to authenticated;

drop policy if exists partner_read_own on public.creator;
create policy partner_read_own on public.creator for select to authenticated
  using (auth_user_id = (select auth.uid()));
drop policy if exists partner_read_own on public.tracked_link;
create policy partner_read_own on public.tracked_link for select to authenticated
  using (creator_id = (select private.my_creator_id()));

-- ── Effective payout: creator override → offer → global settings ──
create or replace function private.effective_payout(p_creator uuid, p_offer uuid)
returns table (rule text, value numeric)
language sql stable security definer set search_path = '' as $$
  select
    case when c.payout_rule is not null then c.payout_rule
         when o.payout_value is not null then o.payout_rule
         else coalesce(s.value ->> 'payout_rule', 'CPA_FIXED') end,
    case when c.payout_rule is not null then c.payout_value
         when o.payout_value is not null then o.payout_value
         else (s.value ->> 'payout_value')::numeric end
  from (select 1) one
  left join public.creator c on c.id = p_creator
  left join public.offer o on o.id = p_offer
  left join public.app_settings s on s.key = 'global'
  where (select private.is_admin()) or p_creator = (select private.my_creator_id());   -- own rate or admin only
$$;
revoke all on function private.effective_payout(uuid, uuid) from public, anon;
grant execute on function private.effective_payout(uuid, uuid) to authenticated;   -- used by admin attribute_order_manual (invoker)

-- ── Profile ──
create or replace function private.partner_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'nick', c.display_name, 'telegram', c.telegram, 'handles', c.handles,
    'status', c.status, 'email', c.email, 'created_at', c.created_at)
  from public.creator c where c.auth_user_id = (select auth.uid());
$$;

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
  if v_nick !~ '^[a-z0-9_]{2,24}$' then raise exception 'Ник: 2–24 символа, латиница, цифры или _'; end if;
  if v_tg = '@' then v_tg := null; end if;
  foreach k in array array['IG','TT','YT'] loop
    v := left(trim(coalesce(p_handles ->> k, '')), 60);
    if v <> '' then v_h := v_h || jsonb_build_object(k, v); end if;
  end loop;

  select id into v_id from public.creator where auth_user_id = v_uid;
  if v_id is not null then
    -- Existing partner: nick is fixed once links exist (it is part of every link); contacts can change.
    if exists (select 1 from public.creator where lower(display_name) = v_nick and id <> v_id)
       and not exists (select 1 from public.tracked_link t where t.creator_id = v_id) then
      raise exception 'Ник «%» уже занят — выберите другой', v_nick;
    end if;
    update public.creator set telegram = v_tg, handles = v_h, contact = coalesce(v_tg, contact),
      display_name = case when exists (select 1 from public.tracked_link t where t.creator_id = v_id) then display_name else v_nick end
    where id = v_id;
    return private.partner_me();
  end if;

  -- Founder may have pre-created the creator with this email: claim it.
  select id into v_id from public.creator where auth_user_id is null and v_email <> '' and lower(email) = v_email limit 1;
  if v_id is not null then
    update public.creator set auth_user_id = v_uid, telegram = v_tg, handles = v_h, contact = coalesce(v_tg, contact) where id = v_id;
    return private.partner_me();
  end if;

  if exists (select 1 from public.creator where lower(display_name) = v_nick) then
    raise exception 'Ник «%» уже занят — выберите другой', v_nick;
  end if;
  insert into public.creator (type, display_name, email, telegram, contact, handles, status, self_signup, auth_user_id, activated_at)
  values ('PARTNER_HUMAN', v_nick, nullif(v_email, ''), v_tg, v_tg, v_h, 'ACTIVE', true, v_uid, now());
  return private.partner_me();
end $$;

-- ── Catalog (no cost/margin data) ──
create or replace function private.partner_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id, 'title', p.title, 'handle', p.handle, 'pdp_url', p.pdp_url, 'price_cents', p.price_cents,
    'image_url', p.image_url, 'pitch', p.pitch,
    'payout_rule', ep.rule, 'payout_value', ep.value) order by p.price_cents desc, p.title), '[]'::jsonb)
  from public.product p
  join lateral (select o.id from public.offer o where o.product_id = p.id and o.status = 'LIVE' order by o.created_at limit 1) o on true
  cross join lateral private.effective_payout((select private.my_creator_id()), o.id) ep
  where p.status = 'ACTIVE' and (select auth.uid()) is not null;
$$;

-- ── Create a personal tracked link ──
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
  if c.status <> 'ACTIVE' then raise exception 'Аккаунт приостановлен — напишите нам'; end if;
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

-- ── Own stats (aggregates only, no buyer PII). p_from = null → all time ──
create or replace function private.partner_stats(p_from timestamptz default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select id from public.creator where auth_user_id = (select auth.uid())),
  links as (
    select t.token, t.label, t.platform, t.created_at, t.revoked_at, t.dest_url, pr.title as product_title
    from public.tracked_link t join me on me.id = t.creator_id
    left join public.offer o on o.id = t.offer_id left join public.product pr on pr.id = o.product_id
  ),
  clk as (
    select k.token, count(*) as clicks
    from public.click k join links l on l.token = k.token
    where not k.is_bot and (p_from is null or k.clicked_at >= p_from)
    group by k.token
  ),
  conv as (
    select cv.id, coalesce(at.token, '') as token,
           case when od.financial_status in ('REFUNDED','VOIDED','CHARGEBACK') then 0 else od.subtotal_cents end as revenue_cents,
           od.financial_status in ('REFUNDED','VOIDED','CHARGEBACK') as refunded
    from public.conversion cv join me on me.id = cv.creator_id
    join public."order" od on od.id = cv.order_id
    left join public.attribution_touch at on at.id = cv.touch_id
    where cv.is_valid and not od.is_sandbox and (p_from is null or od.ordered_at >= p_from)
  ),
  com as (
    select coalesce(cv.token, '') as token,
      case when cm.status = 'HELD' and cm.hold_until is not null and cm.hold_until <= now() then 'APPROVED' else cm.status end as st,
      cm.amount_cents
    from public.commission cm join me on me.id = cm.creator_id
    left join conv cv on cv.id = cm.conversion_id
    where cm.status <> 'VOID' and not cm.is_sandbox and (p_from is null or cv.id is not null)
  ),
  per as (
    select l.token, l.label, l.platform, l.created_at, l.revoked_at is not null as revoked, l.product_title,
      coalesce((select clicks from clk where clk.token = l.token), 0) as clicks,
      (select count(*) from conv where conv.token = l.token and not conv.refunded) as orders,
      coalesce((select sum(revenue_cents) from conv where conv.token = l.token), 0) as revenue_cents,
      coalesce((select sum(amount_cents) from com where com.token = l.token and com.st = 'HELD'), 0) as held_cents,
      coalesce((select sum(amount_cents) from com where com.token = l.token and com.st = 'APPROVED'), 0) as approved_cents,
      coalesce((select sum(amount_cents) from com where com.token = l.token and com.st = 'PAID'), 0) as paid_cents
    from links l
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'links', coalesce((select jsonb_agg(to_jsonb(per) order by per.created_at desc) from per), '[]'::jsonb),
    'unlinked', jsonb_build_object(            -- orders assigned manually by the founder (no link)
      'orders', (select count(*) from conv where token = '' and not refunded),
      'revenue_cents', coalesce((select sum(revenue_cents) from conv where token = ''), 0)),
    'totals', jsonb_build_object(
      'clicks', coalesce((select sum(clicks) from clk), 0),
      'orders', (select count(*) from conv where not refunded),
      'revenue_cents', coalesce((select sum(revenue_cents) from conv), 0),
      'held_cents', coalesce((select sum(amount_cents) from com where st = 'HELD'), 0),
      'approved_cents', coalesce((select sum(amount_cents) from com where st = 'APPROVED'), 0),
      'paid_cents', coalesce((select sum(amount_cents) from com where st = 'PAID'), 0)),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object(
        'period_start', py.period_start, 'period_end', py.period_end, 'amount_cents', py.amount_cents,
        'currency', py.currency, 'method', py.method, 'status', py.status, 'paid_at', py.paid_at) order by coalesce(py.paid_at, py.created_at) desc)
      from public.payout py join me on me.id = py.creator_id where not py.is_sandbox), '[]'::jsonb),
    'hold_days', coalesce(((select value from public.app_settings where key = 'global') ->> 'hold_days')::int, 14)
  ) end;
$$;

do $$
declare f text;
begin
  foreach f in array array['private.partner_me()', 'private.partner_register(text, text, jsonb)', 'private.partner_catalog()',
                           'private.partner_create_link(uuid, text, text)', 'private.partner_stats(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── Public API (exposed via PostgREST rpc). SECURITY INVOKER wrappers; anon cannot execute. ──
create or replace function public.partner_me() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.partner_me(); $$;
create or replace function public.partner_register(p_nick text, p_telegram text default null, p_handles jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$ select private.partner_register(p_nick, p_telegram, p_handles); $$;
create or replace function public.partner_catalog() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.partner_catalog(); $$;
create or replace function public.partner_create_link(p_product uuid, p_platform text, p_label text default null)
returns jsonb language sql security invoker set search_path = '' as $$ select private.partner_create_link(p_product, p_platform, p_label); $$;
create or replace function public.partner_stats(p_from timestamptz default null) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.partner_stats(p_from); $$;

do $$
declare f text;
begin
  foreach f in array array['public.partner_me()', 'public.partner_register(text, text, jsonb)', 'public.partner_catalog()',
                           'public.partner_create_link(uuid, text, text)', 'public.partner_stats(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── Manual attribution: use the same payout precedence (creator → offer → global) ──
create or replace function public.attribute_order_manual(p_order uuid, p_creator uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  o public."order"%rowtype;
  c public.creator%rowtype;
  s jsonb;
  v_rule text; v_value numeric; v_offer uuid; v_touch uuid; v_conv uuid;
  v_amount integer; v_basis integer; v_cogs integer; v_cogs_missing boolean;
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception 'not allowed';
  end if;
  select * into o from public."order" where id = p_order;
  if not found then raise exception 'order not found'; end if;
  if exists (select 1 from public.commission where idempotency_key = 'cpa:' || o.external_id and status = 'PAID') then
    raise exception 'Начисление по этому заказу уже выплачено — сначала отмените выплату';
  end if;

  delete from public.commission where idempotency_key = 'cpa:' || o.external_id;
  delete from public.conversion where order_id = o.id;
  if p_creator is null then return null; end if;

  select * into c from public.creator where id = p_creator;
  if not found then raise exception 'creator not found'; end if;
  select value into s from public.app_settings where key = 'global';
  select ofr.id into v_offer from public.order_item oi join public.offer ofr on ofr.product_id = oi.product_id where oi.order_id = o.id limit 1;

  insert into public.attribution_touch (type, creator_id, offer_id, order_id, occurred_at, raw)
  values ('MANUAL', c.id, v_offer, o.id, now(), jsonb_build_object('by', (select auth.jwt()) ->> 'email'))
  returning id into v_touch;
  insert into public.conversion (order_id, touch_id, creator_id, offer_id, method, window_days)
  values (o.id, v_touch, c.id, v_offer, 'MANUAL', coalesce((s ->> 'attribution_window_days')::int, 7))
  returning id into v_conv;

  if o.financial_status in ('REFUNDED', 'VOIDED') then return v_conv; end if;
  select ep.rule, ep.value into v_rule, v_value from private.effective_payout(c.id, v_offer) ep;
  v_rule := coalesce(v_rule, 'CPA_FIXED');
  if v_value is null then return v_conv; end if;                 -- «ставка уточняется»: attributed, commission waits

  if v_rule = 'CPA_FIXED' then
    v_amount := round(v_value * 100);
  elsif v_rule = 'PCT_REVENUE' then
    v_basis := o.subtotal_cents; v_amount := round(o.subtotal_cents * v_value);
  else
    select bool_or(cogs_cents is null), sum(cogs_cents * qty) into v_cogs_missing, v_cogs from public.order_item where order_id = o.id;
    if v_cogs_missing is distinct from false then return v_conv; end if;
    v_basis := o.subtotal_cents - v_cogs; v_amount := greatest(0, round(v_basis * v_value));
  end if;

  insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
  values (v_conv, c.id, 'CPA', v_basis, v_value, v_amount, 'HELD',
          o.ordered_at + make_interval(days => coalesce((s ->> 'hold_days')::int, 14)), 'cpa:' || o.external_id);
  return v_conv;
end $$;
revoke all on function public.attribute_order_manual(uuid, uuid) from public, anon;
grant execute on function public.attribute_order_manual(uuid, uuid) to authenticated;
