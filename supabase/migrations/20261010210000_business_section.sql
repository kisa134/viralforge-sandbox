-- «📈 Бизнес» in /admin: landed costs per product (CJdropshipping), business settings, admin-only metrics RPC, AI key lookup for the advisor.
alter table public.product
  add column if not exists cj_spu text,
  add column if not exists ship_days_min smallint,
  add column if not exists ship_days_max smallint,
  add column if not exists ship_method text,
  add column if not exists cost_note text;

-- CJ screenshots 2026-10-10: product cost (cogs_cents) + shipping to US (shipping_cost_cents) = landed cost
update public.product set cj_spu='CJYD3124802', cogs_cents=538,  shipping_cost_cents=1210, ship_days_min=15, ship_days_max=25, ship_method='CJPacket FJTY', cost_note='Негабарит (oversized) — дорогая доставка' where handle='luminous-witchs-cauldron-lamp-resin-craft';
update public.product set cj_spu='CJJT3092636', cogs_cents=492,  shipping_cost_cents=964,  ship_days_min=5,  ship_days_max=11, ship_method='CJPacket' where handle='study-room-creative-night-light-resin-ornaments';
update public.product set cj_spu='CJJT2991330', cogs_cents=580,  shipping_cost_cents=1004, ship_days_min=5,  ship_days_max=11, ship_method='CJPacket' where handle='bat-wing-table-lamp-halloween-resin-ornaments';
update public.product set cj_spu='CJJT3040236', cogs_cents=2465, shipping_cost_cents=1537, ship_days_min=4,  ship_days_max=7,  ship_method='CJPacket', cost_note='Размер 14×13,5 см; у CJ цена $23.78–35.07 в зависимости от размера' where handle='design-a-resin-lantern-as-a-halloween-gift';
update public.product set cj_spu='CJYE1562565', cogs_cents=384,  shipping_cost_cents=644,  ship_days_min=5,  ship_days_max=11, ship_method='CJPacket' where handle like 'new-baby-halloween-long-sleeved-jumpsuit%';

update public.app_settings
   set value = jsonb_build_object('payment_fee_pct', 0.029, 'payment_fee_fixed_cents', 30, 'refund_rate', 0.05, 'free_shipping_note', '') || value, updated_at = now()
 where key = 'global';

-- ── Admin: edit product costs ──
create or replace function private.admin_update_product_costs(p_product uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  update public.product set
    cogs_cents          = case when p ? 'cogs_cents' then nullif(p ->> 'cogs_cents', '')::int else cogs_cents end,
    shipping_cost_cents = case when p ? 'shipping_cost_cents' then nullif(p ->> 'shipping_cost_cents', '')::int else shipping_cost_cents end,
    ship_days_min       = case when p ? 'ship_days_min' then nullif(p ->> 'ship_days_min', '')::smallint else ship_days_min end,
    ship_days_max       = case when p ? 'ship_days_max' then nullif(p ->> 'ship_days_max', '')::smallint else ship_days_max end,
    ship_method         = case when p ? 'ship_method' then left(nullif(btrim(p ->> 'ship_method'), ''), 60) else ship_method end,
    cj_spu              = case when p ? 'cj_spu' then left(nullif(btrim(p ->> 'cj_spu'), ''), 40) else cj_spu end,
    cost_note           = case when p ? 'cost_note' then left(nullif(btrim(p ->> 'cost_note'), ''), 200) else cost_note end
  where id = p_product;
  if not found then raise exception 'Товар не найден'; end if;
  if exists (select 1 from public.product where id = p_product and (cogs_cents < 0 or shipping_cost_cents < 0 or cogs_cents > 1000000 or shipping_cost_cents > 1000000)) then
    raise exception 'Неверная себестоимость';
  end if;
end $$;

-- ── Admin: business settings (whitelisted keys) ──
create or replace function private.admin_set_biz_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb;
begin
  perform private.admin_check();
  if p ? 'payment_fee_pct' then
    if (p ->> 'payment_fee_pct')::numeric not between 0 and 0.2 then raise exception 'Комиссия: 0–20%%'; end if;
    v := v || jsonb_build_object('payment_fee_pct', (p ->> 'payment_fee_pct')::numeric); end if;
  if p ? 'payment_fee_fixed_cents' then
    if (p ->> 'payment_fee_fixed_cents')::int not between 0 and 500 then raise exception 'Фикс. комиссия: $0–5'; end if;
    v := v || jsonb_build_object('payment_fee_fixed_cents', (p ->> 'payment_fee_fixed_cents')::int); end if;
  if p ? 'refund_rate' then
    if (p ->> 'refund_rate')::numeric not between 0 and 0.5 then raise exception 'Возвраты: 0–50%%'; end if;
    v := v || jsonb_build_object('refund_rate', (p ->> 'refund_rate')::numeric); end if;
  if p ? 'free_shipping_note' then v := v || jsonb_build_object('free_shipping_note', left(coalesce(p ->> 'free_shipping_note', ''), 200)); end if;
  update public.app_settings set value = value || v, updated_at = now() where key = 'global';
end $$;

-- ── Admin: business metrics (aggregates only) ──
create or replace function private.admin_biz_metrics(p_from timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  r jsonb;
begin
  perform private.admin_check();
  with
  s as (select value from public.app_settings where key = 'global'),
  vo as (  -- valid attributed orders (real, not refunded)
    select o.id, o.ordered_at, o.subtotal_cents, o.total_cents, cv.creator_id
    from public.conversion cv join public."order" o on o.id = cv.order_id
    where cv.is_valid and not o.is_sandbox and o.financial_status not in ('REFUNDED','VOIDED','CHARGEBACK')),
  oi as (
    select i.order_id, i.product_id, i.qty, i.price_cents,
           i.qty * (coalesce(p.cogs_cents, 0) + coalesce(p.shipping_cost_cents, 0)) as landed_cents,
           (p.cogs_cents is null) as cost_missing
    from public.order_item i left join public.product p on p.id = i.product_id),
  ord_cost as (select order_id, sum(landed_cents) landed_cents, bool_or(cost_missing) cost_missing from oi group by 1),
  comm as (
    select cv.order_id, sum(cm.amount_cents) amount_cents
    from public.commission cm join public.conversion cv on cv.id = cm.conversion_id
    where cm.status <> 'VOID' and cm.kind = 'CPA' group by 1),
  clicks as (
    select k.clicked_at, t.creator_id, ofr.product_id
    from public.click k join public.tracked_link t on t.token = k.token left join public.offer ofr on ofr.id = t.offer_id
    where not k.is_bot),
  per_order as (
    select vo.*, coalesce(oc.landed_cents, 0) landed_cents, coalesce(oc.cost_missing, false) cost_missing, coalesce(cm.amount_cents, 0) commission_cents
    from vo left join ord_cost oc on oc.order_id = vo.id left join comm cm on cm.order_id = vo.id),
  agg as (
    select
      (select count(*) from clicks where clicked_at >= v_from) clicks,
      (select count(*) from per_order where ordered_at >= v_from) orders,
      (select coalesce(sum(subtotal_cents), 0) from per_order where ordered_at >= v_from) revenue_cents,
      (select coalesce(sum(total_cents), 0) from per_order where ordered_at >= v_from) total_cents,
      (select coalesce(sum(landed_cents), 0) from per_order where ordered_at >= v_from) landed_cents,
      (select coalesce(sum(commission_cents), 0) from per_order where ordered_at >= v_from) commission_cents,
      (select count(*) from per_order where ordered_at >= v_from and cost_missing) orders_cost_missing,
      (select count(*) from public."order" o where not o.is_sandbox and o.ordered_at >= v_from) store_orders,
      (select coalesce(sum(o.subtotal_cents), 0) from public."order" o where not o.is_sandbox and o.ordered_at >= v_from and o.financial_status not in ('REFUNDED','VOIDED','CHARGEBACK')) store_revenue_cents,
      (select count(*) from public."order" o join public.conversion cv on cv.order_id = o.id where not o.is_sandbox and o.ordered_at >= v_from and o.financial_status in ('REFUNDED','CHARGEBACK')) refunded_orders,
      (select count(*) from public.post where posted_at >= v_from) posts,
      (select count(*) from public.tracked_link where created_at >= v_from) links_created,
      (select count(*) from public.tracked_link) links_total,
      (select max(clicked_at) from clicks) last_click_at,
      (select max(ordered_at) from per_order) last_order_at),
  cr as (
    select
      count(*) filter (where status = 'ACTIVE') active,
      count(*) filter (where status = 'PENDING') pending,
      count(*) filter (where status in ('FROZEN','REJECTED','BANNED')) blocked,
      count(*) filter (where status = 'ACTIVE' and exists (select 1 from public.tracked_link t where t.creator_id = c.id)) with_links,
      count(*) filter (where status = 'ACTIVE' and exists (select 1 from clicks k where k.creator_id = c.id and k.clicked_at >= v_from)) with_clicks,
      count(*) filter (where status = 'ACTIVE' and exists (select 1 from per_order po where po.creator_id = c.id and po.ordered_at >= v_from)) with_orders,
      count(*) filter (where status = 'ACTIVE' and activated_at < now() - interval '7 days'
                       and not exists (select 1 from clicks k where k.creator_id = c.id and k.clicked_at >= now() - interval '7 days')) inactive_7d
    from public.creator c where c.type = 'PARTNER_HUMAN'),
  top as (
    select coalesce(c.login, c.display_name) login,
      (select count(*) from clicks k where k.creator_id = c.id and k.clicked_at >= v_from) clicks,
      (select count(*) from per_order po where po.creator_id = c.id and po.ordered_at >= v_from) orders,
      (select coalesce(sum(po.subtotal_cents), 0) from per_order po where po.creator_id = c.id and po.ordered_at >= v_from) revenue_cents
    from public.creator c where c.type = 'PARTNER_HUMAN'),
  prod as (
    select p.id, p.title, p.handle, p.price_cents, p.cogs_cents, p.shipping_cost_cents, p.cj_spu, p.ship_days_min, p.ship_days_max, p.ship_method, p.cost_note, p.image_url,
      case when ofr.payout_value is not null then ofr.payout_rule else s.value ->> 'payout_rule' end payout_rule,
      case when ofr.payout_value is not null then ofr.payout_value else (s.value ->> 'payout_value')::numeric end payout_value,
      (select count(*) from clicks k where k.product_id = p.id and k.clicked_at >= v_from) clicks,
      (select count(distinct po.id) from per_order po join oi on oi.order_id = po.id where oi.product_id = p.id and po.ordered_at >= v_from) orders,
      (select coalesce(sum(oi.qty), 0) from per_order po join oi on oi.order_id = po.id where oi.product_id = p.id and po.ordered_at >= v_from) units,
      (select coalesce(sum(oi.qty * oi.price_cents), 0) from per_order po join oi on oi.order_id = po.id where oi.product_id = p.id and po.ordered_at >= v_from) revenue_cents,
      (select count(*) from public.tracked_link t where t.offer_id = ofr.id) links
    from public.product p cross join s left join public.offer ofr on ofr.product_id = p.id and ofr.status = 'ACTIVE'
    where p.status = 'ACTIVE'),
  wk as (
    select gs::date week_start,
      (select count(*) from clicks k where k.clicked_at >= gs and k.clicked_at < gs + interval '7 days') clicks,
      (select count(*) from per_order po where po.ordered_at >= gs and po.ordered_at < gs + interval '7 days') orders,
      (select coalesce(sum(subtotal_cents), 0) from per_order po where po.ordered_at >= gs and po.ordered_at < gs + interval '7 days') revenue_cents,
      (select coalesce(sum(total_cents), 0) from per_order po where po.ordered_at >= gs and po.ordered_at < gs + interval '7 days') total_cents,
      (select coalesce(sum(landed_cents), 0) from per_order po where po.ordered_at >= gs and po.ordered_at < gs + interval '7 days') landed_cents,
      (select coalesce(sum(commission_cents), 0) from per_order po where po.ordered_at >= gs and po.ordered_at < gs + interval '7 days') commission_cents
    from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') gs),
  roll as (  -- rolling 7d vs previous 7d (week-over-week)
    select w.k,
      (select count(*) from clicks c2 where c2.clicked_at >= w.a and c2.clicked_at < w.b) clicks,
      (select count(*) from per_order po where po.ordered_at >= w.a and po.ordered_at < w.b) orders,
      (select coalesce(sum(subtotal_cents), 0) from per_order po where po.ordered_at >= w.a and po.ordered_at < w.b) revenue_cents,
      (select coalesce(sum(total_cents), 0) from per_order po where po.ordered_at >= w.a and po.ordered_at < w.b) total_cents,
      (select coalesce(sum(landed_cents), 0) from per_order po where po.ordered_at >= w.a and po.ordered_at < w.b) landed_cents,
      (select coalesce(sum(commission_cents), 0) from per_order po where po.ordered_at >= w.a and po.ordered_at < w.b) commission_cents,
      (select count(distinct creator_id) from clicks c2 where c2.clicked_at >= w.a and c2.clicked_at < w.b) active_creators
    from (values ('cur', now() - interval '7 days', now() + interval '1 minute'), ('prev', now() - interval '14 days', now() - interval '7 days')) w(k, a, b))
  select jsonb_build_object(
    'generated_at', now(), 'from', p_from,
    'settings', (select value from s),
    'totals', (select to_jsonb(agg) from agg),
    'creators', (select to_jsonb(cr) from cr),
    'top_creators', coalesce((select jsonb_agg(to_jsonb(t) order by t.revenue_cents desc, t.orders desc, t.clicks desc) from (select * from top where clicks > 0 or orders > 0 order by revenue_cents desc, orders desc, clicks desc limit 5) t), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(prod) order by prod.price_cents desc, prod.title) from prod), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(to_jsonb(wk) order by wk.week_start) from wk), '[]'::jsonb),
    'wow', (select jsonb_object_agg(k, to_jsonb(roll) - 'k') from roll)
  ) into r;
  return r;
end $$;

-- ── Advisor edge function: AI keys may live in Vault (service_role only, whitelisted names) ──
create or replace function public.get_ai_secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret from vault.decrypted_secrets ds
  where ds.name = p_name and p_name in ('openai_api_key', 'anthropic_api_key', 'ai_gateway_api_key') limit 1;
$$;
revoke all on function public.get_ai_secret(text) from public, anon, authenticated;
grant execute on function public.get_ai_secret(text) to service_role;

create or replace function public.admin_biz_metrics(p_from timestamptz default null) returns jsonb language sql stable security invoker set search_path = '' as $$ select private.admin_biz_metrics(p_from); $$;
create or replace function public.admin_update_product_costs(p_product uuid, p jsonb) returns void language sql security invoker set search_path = '' as $$ select private.admin_update_product_costs(p_product, p); $$;
create or replace function public.admin_set_biz_settings(p jsonb) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_biz_settings(p); $$;

do $$
declare f text;
begin
  foreach f in array array['private.admin_biz_metrics(timestamptz)', 'private.admin_update_product_costs(uuid, jsonb)', 'private.admin_set_biz_settings(jsonb)',
    'public.admin_biz_metrics(timestamptz)', 'public.admin_update_product_costs(uuid, jsonb)', 'public.admin_set_biz_settings(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
