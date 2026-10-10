-- Creator payout = FIXED $ per sale, set per product (offer.payout_rule CPA_FIXED, payout_value USD per unit) × qty.
-- Precedence: partner individual override (creator.payout_rule/value) > product fixed $. Global default no longer applies (kept in DB, value null).
-- No payout for a product → commission NEEDS_REVIEW ($0). One shared calc used by manual attribution and the Shopify webhook.

update public.offer o set payout_rule = 'CPA_FIXED', payout_value = x.usd
  from (values ('study-room-creative-night-light-resin-ornaments', 5.31), ('bat-wing-table-lamp-halloween-resin-ornaments', 5.12),
               ('luminous-witchs-cauldron-lamp-resin-craft', 4.87), ('design-a-resin-lantern-as-a-halloween-gift', 5.99)) x(handle, usd),
       public.product p
 where p.id = o.product_id and p.handle = x.handle;
update public.offer o set payout_rule = 'CPA_FIXED', payout_value = 4.45
  from public.product p where p.id = o.product_id and p.handle like 'new-baby-halloween-long-sleeved-jumpsuit%';

update public.app_settings set value = value || '{"payout_rule":"CPA_FIXED","payout_value":null}'::jsonb, updated_at = now() where key = 'global';

-- ── Shared commission calculation ──
create or replace function private.calc_order_commission(p_order uuid, p_creator uuid)
returns table (amount_cents integer, basis_cents integer, rate numeric, needs_review boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  o public."order"%rowtype; c public.creator%rowtype; s jsonb;
  v_amt bigint := 0; v_missing boolean := false; v_n int := 0; v_qty int := 0; v_land bigint := 0; v_land_missing boolean := false;
  it record; v_rule text; v_val numeric; v_rates numeric[] := '{}';
begin
  select * into o from public."order" where id = p_order;
  select * into c from public.creator where id = p_creator;
  select value into s from public.app_settings where key = 'global';
  for it in
    select oi.qty, oi.price_cents, p.id as pid, p.cogs_cents, p.shipping_cost_cents, ofr.payout_rule as orule, ofr.payout_value as oval
    from public.order_item oi
    left join public.product p on p.id = oi.product_id
    left join lateral (select x.payout_rule, x.payout_value from public.offer x where x.product_id = p.id and x.status = 'LIVE' order by x.created_at limit 1) ofr on true
    where oi.order_id = p_order
  loop
    v_n := v_n + 1; v_qty := v_qty + it.qty;
    if it.cogs_cents is null then v_land_missing := true; else v_land := v_land + (it.cogs_cents + coalesce(it.shipping_cost_cents, 0)) * it.qty; end if;
    if c.payout_rule is null then          -- product fixed $ (or legacy offer/global rule)
      v_rule := case when it.oval is not null then it.orule else s ->> 'payout_rule' end;
      v_val  := case when it.oval is not null then it.oval else (s ->> 'payout_value')::numeric end;
      if it.pid is null or v_val is null then v_missing := true;
      elsif v_rule = 'CPA_FIXED' then v_amt := v_amt + round(v_val * 100) * it.qty; v_rates := v_rates || v_val;
      elsif v_rule = 'PCT_REVENUE' then v_amt := v_amt + round(it.price_cents * it.qty * v_val); v_rates := v_rates || v_val;
      elsif v_rule = 'PCT_MARGIN' then
        if it.cogs_cents is null then v_missing := true;
        else v_amt := v_amt + round(greatest(0, it.price_cents - it.cogs_cents - coalesce(it.shipping_cost_cents, 0)) * it.qty * v_val); v_rates := v_rates || v_val; end if;
      else v_missing := true; end if;
    end if;
  end loop;
  if v_n = 0 then return query select 0, null::int, null::numeric, true; return; end if;

  if c.payout_rule is not null then      -- partner individual override (whole order)
    if c.payout_value is null then return query select 0, null::int, null::numeric, true; return; end if;
    if c.payout_rule = 'CPA_FIXED' then return query select (round(c.payout_value * 100) * v_qty)::int, null::int, c.payout_value, false; return; end if;
    if c.payout_rule = 'PCT_REVENUE' then return query select round(o.subtotal_cents * c.payout_value)::int, o.subtotal_cents, c.payout_value, false; return; end if;
    if c.payout_rule = 'PCT_MARGIN' then
      if v_land_missing then return query select 0, null::int, c.payout_value, true; return; end if;
      return query select round(greatest(0, o.subtotal_cents - v_land) * c.payout_value)::int, greatest(0, o.subtotal_cents - v_land)::int, c.payout_value, false; return;
    end if;
    return query select 0, null::int, null::numeric, true; return;
  end if;
  return query select case when v_missing then 0 else v_amt::int end, null::int,
    case when array_length(v_rates, 1) > 0 and (select count(distinct r) from unnest(v_rates) r) = 1 then v_rates[1] else null end, v_missing;
end $$;
revoke all on function private.calc_order_commission(uuid, uuid) from public, anon;
grant execute on function private.calc_order_commission(uuid, uuid) to authenticated, service_role;
-- webhook (service_role) entry point
create or replace function public.calc_order_commission(p_order uuid, p_creator uuid)
returns table (amount_cents integer, basis_cents integer, rate numeric, needs_review boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.calc_order_commission(p_order, p_creator); $$;
revoke all on function public.calc_order_commission(uuid, uuid) from public, anon, authenticated;
grant execute on function public.calc_order_commission(uuid, uuid) to service_role;
grant usage on schema private to service_role;

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
  select cc.amount_cents, cc.basis_cents, cc.rate, cc.needs_review into v_amount, v_basis, v_value, v_cogs_missing
    from private.calc_order_commission(o.id, c.id) cc;
  if v_cogs_missing then   -- no payout set for a product (or no COGS for a %-of-margin override) → admin review, $0
    insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
    values (v_conv, c.id, 'CPA', null, v_value, 0, 'NEEDS_REVIEW', null, 'cpa:' || o.external_id);
    return v_conv;
  end if;

  insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
  values (v_conv, c.id, 'CPA', v_basis, v_value, v_amount, 'HELD',
          o.ordered_at + make_interval(days => coalesce((s ->> 'hold_days')::int, 14)), 'cpa:' || o.external_id);
  return v_conv;
end $$;
revoke all on function public.attribute_order_manual(uuid, uuid) from public, anon;
grant execute on function public.attribute_order_manual(uuid, uuid) to authenticated;

-- ── Admin: product payout $ + add product ──
create or replace function private.admin_update_product_costs(p_product uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pay numeric;
begin
  perform private.admin_check();
  update public.product set
    title               = case when p ? 'title' and btrim(p ->> 'title') <> '' then left(btrim(p ->> 'title'), 120) else title end,
    price_cents         = case when p ? 'price_cents' and (p ->> 'price_cents') <> '' then (p ->> 'price_cents')::int else price_cents end,
    cogs_cents          = case when p ? 'cogs_cents' then nullif(p ->> 'cogs_cents', '')::int else cogs_cents end,
    shipping_cost_cents = case when p ? 'shipping_cost_cents' then nullif(p ->> 'shipping_cost_cents', '')::int else shipping_cost_cents end,
    ship_days_min       = case when p ? 'ship_days_min' then nullif(p ->> 'ship_days_min', '')::smallint else ship_days_min end,
    ship_days_max       = case when p ? 'ship_days_max' then nullif(p ->> 'ship_days_max', '')::smallint else ship_days_max end,
    ship_method         = case when p ? 'ship_method' then left(nullif(btrim(p ->> 'ship_method'), ''), 60) else ship_method end,
    cj_spu              = case when p ? 'cj_spu' then left(nullif(btrim(p ->> 'cj_spu'), ''), 40) else cj_spu end,
    cost_note           = case when p ? 'cost_note' then left(nullif(btrim(p ->> 'cost_note'), ''), 200) else cost_note end
  where id = p_product;
  if not found then raise exception 'Товар не найден'; end if;
  if exists (select 1 from public.product where id = p_product and (price_cents <= 0 or cogs_cents < 0 or shipping_cost_cents < 0 or cogs_cents > 1000000 or shipping_cost_cents > 1000000)) then
    raise exception 'Неверная цена или себестоимость';
  end if;
  if p ? 'payout_cents' then
    v_pay := nullif(p ->> 'payout_cents', '')::numeric / 100;
    if v_pay is not null and (v_pay < 0 or v_pay > 1000) then raise exception 'Выплата: $0–1000'; end if;
    update public.offer set payout_rule = 'CPA_FIXED', payout_value = v_pay where product_id = p_product and status = 'LIVE';
    if not found then
      insert into public.offer (product_id, name, payout_rule, payout_value, status)
      select id, title, 'CPA_FIXED', v_pay, 'LIVE' from public.product where id = p_product;
    end if;
  end if;
end $$;

create or replace function private.admin_add_product(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := left(btrim(coalesce(p ->> 'title', '')), 120);
  v_handle text := lower(regexp_replace(regexp_replace(btrim(coalesce(p ->> 'handle', '')), '^.*/products/', ''), '[?#].*$', ''));
  v_price int := nullif(p ->> 'price_cents', '')::int;
  v_pay numeric := nullif(p ->> 'payout_cents', '')::numeric / 100;
  v_brand uuid; v_id uuid; v_dom text;
begin
  perform private.admin_check();
  if v_title = '' then raise exception 'Укажите название'; end if;
  if v_handle !~ '^[a-z0-9][a-z0-9-]{1,200}$' then raise exception 'Укажите handle или ссылку на товар (…/products/handle)'; end if;
  if v_price is null or v_price <= 0 then raise exception 'Укажите цену'; end if;
  if v_pay is not null and (v_pay < 0 or v_pay > 1000) then raise exception 'Выплата: $0–1000'; end if;
  if exists (select 1 from public.product where handle = v_handle) then raise exception 'Товар с таким handle уже есть'; end if;
  select id into v_brand from public.brand order by created_at limit 1;
  select coalesce(value ->> 'store_domain', 'likky.store') into v_dom from public.app_settings where key = 'global';
  insert into public.product (brand_id, title, handle, sku, pdp_url, price_cents, cogs_cents, shipping_cost_cents, ship_days_min, ship_days_max, ship_method, cj_spu, cost_note, image_url, pitch, status)
  values (v_brand, v_title, v_handle, v_handle, 'https://' || v_dom || '/products/' || v_handle, v_price,
          nullif(p ->> 'cogs_cents', '')::int, nullif(p ->> 'shipping_cost_cents', '')::int,
          nullif(p ->> 'ship_days_min', '')::smallint, nullif(p ->> 'ship_days_max', '')::smallint,
          left(nullif(btrim(p ->> 'ship_method'), ''), 60), left(nullif(btrim(p ->> 'cj_spu'), ''), 40), left(nullif(btrim(p ->> 'cost_note'), ''), 200),
          nullif(btrim(p ->> 'image_url'), ''), left(nullif(btrim(p ->> 'pitch'), ''), 300), 'ACTIVE')
  returning id into v_id;
  insert into public.offer (product_id, name, payout_rule, payout_value, status) values (v_id, v_title, 'CPA_FIXED', v_pay, 'LIVE');
  return v_id;
end $$;
create or replace function public.admin_add_product(p jsonb) returns uuid language sql security invoker set search_path = '' as $$ select private.admin_add_product(p); $$;
revoke all on function private.admin_add_product(jsonb) from public, anon;
grant execute on function private.admin_add_product(jsonb) to authenticated;
revoke all on function public.admin_add_product(jsonb) from public, anon;
grant execute on function public.admin_add_product(jsonb) to authenticated;

-- Partner catalog: only the $ per sale (no rule / % / COGS)
create or replace function private.partner_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id, 'title', p.title, 'handle', p.handle, 'pdp_url', p.pdp_url, 'price_cents', p.price_cents,
    'image_url', p.image_url, 'pitch', p.pitch,
    'payout_cents', private.payout_cents_for(ep.rule, ep.value, p.id)) order by p.price_cents desc, p.title), '[]'::jsonb)
  from public.product p
  join lateral (select o.id from public.offer o where o.product_id = p.id and o.status = 'LIVE' order by o.created_at limit 1) o on true
  cross join lateral private.effective_payout((select private.my_creator_id()), o.id) ep
  where p.status = 'ACTIVE'
    and exists (select 1 from public.creator c where c.auth_user_id = (select auth.uid()) and c.status = 'ACTIVE');
$$;
