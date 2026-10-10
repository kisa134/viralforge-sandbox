-- Creator payout = 15% of gross margin: (product subtotal after discounts, excl. shipping/tax) − Σ landed COGS × qty, floor 0.
-- Rule type PCT_MARGIN (already allowed on creator/offer). Missing COGS → commission NEEDS_REVIEW (amount 0) for admin.
update public.app_settings
   set value = value || '{"payout_rule":"PCT_MARGIN","payout_value":0.15}'::jsonb, updated_at = now()
 where key = 'global';

alter table public.commission drop constraint if exists commission_status_check;
alter table public.commission add constraint commission_status_check check (status in ('HELD','APPROVED','PAID','VOID','NEEDS_REVIEW'));
comment on column public.order_item.cogs_cents is 'Landed unit cost snapshot at order time (CJ product + shipping to US), cents';

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
    -- PCT_MARGIN: margin = subtotal (after discounts, no shipping/tax) − Σ landed cost (CJ product + shipping) × qty, floor 0.
    -- Uses current product costs; any item without COGS → NEEDS_REVIEW (never pay on a wrong base).
    select bool_or(p.cogs_cents is null) or count(*) = 0, sum((coalesce(p.cogs_cents, 0) + coalesce(p.shipping_cost_cents, 0)) * oi.qty)
      into v_cogs_missing, v_cogs
      from public.order_item oi left join public.product p on p.id = oi.product_id where oi.order_id = o.id;
    if v_cogs_missing is distinct from false then
      insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
      values (v_conv, c.id, 'CPA', null, v_value, 0, 'NEEDS_REVIEW', null, 'cpa:' || o.external_id);
      return v_conv;
    end if;
    v_basis := greatest(0, o.subtotal_cents - v_cogs); v_amount := round(v_basis * v_value);
  end if;

  insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
  values (v_conv, c.id, 'CPA', v_basis, v_value, v_amount, 'HELD',
          o.ordered_at + make_interval(days => coalesce((s ->> 'hold_days')::int, 14)), 'cpa:' || o.external_id);
  return v_conv;
end $$;
revoke all on function public.attribute_order_manual(uuid, uuid) from public, anon;
grant execute on function public.attribute_order_manual(uuid, uuid) to authenticated;

-- Default rate: allow % of margin
create or replace function private.admin_set_default_rate(p_rule text, p_value numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  if p_rule not in ('CPA_FIXED','PCT_REVENUE','PCT_MARGIN') then raise exception 'Неверный тип ставки'; end if;
  if p_value is null or p_value < 0 or (p_rule <> 'CPA_FIXED' and p_value > 1) or (p_rule = 'CPA_FIXED' and p_value > 10000) then
    raise exception 'Неверное значение ставки';
  end if;
  update public.app_settings
     set value = value || jsonb_build_object('payout_rule', p_rule, 'payout_value', p_value), updated_at = now()
   where key = 'global';
  insert into public.events (event_id, name, occurred_at, source, props)
  values (gen_random_uuid(), 'admin_default_rate_set', now(), 'rpc:admin', jsonb_build_object('rule', p_rule, 'value', p_value, 'by', coalesce((select auth.jwt()) -> 'app_metadata' ->> 'login', (select auth.jwt()) ->> 'email')));
end $$;

-- Per-product payout in $ for the partner (computed server-side; COGS itself is never returned)
create or replace function private.payout_cents_for(p_rule text, p_value numeric, p_product uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when p_value is null then null
    when p_rule = 'CPA_FIXED' then round(p_value * 100)::int
    when p_rule = 'PCT_REVENUE' then round(p.price_cents * p_value)::int
    when p_rule = 'PCT_MARGIN' then case when p.cogs_cents is null then null
         else round(greatest(0, p.price_cents - p.cogs_cents - coalesce(p.shipping_cost_cents, 0)) * p_value)::int end
  end
  from public.product p where p.id = p_product;
$$;
revoke all on function private.payout_cents_for(text, numeric, uuid) from public, anon;
grant execute on function private.payout_cents_for(text, numeric, uuid) to authenticated;

create or replace function private.partner_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id, 'title', p.title, 'handle', p.handle, 'pdp_url', p.pdp_url, 'price_cents', p.price_cents,
    'image_url', p.image_url, 'pitch', p.pitch,
    'payout_rule', ep.rule, 'payout_value', ep.value, 'payout_cents', private.payout_cents_for(ep.rule, ep.value, p.id)) order by p.price_cents desc, p.title), '[]'::jsonb)
  from public.product p
  join lateral (select o.id from public.offer o where o.product_id = p.id and o.status = 'LIVE' order by o.created_at limit 1) o on true
  cross join lateral private.effective_payout((select private.my_creator_id()), o.id) ep
  where p.status = 'ACTIVE'
    and exists (select 1 from public.creator c where c.auth_user_id = (select auth.uid()) and c.status = 'ACTIVE');
$$;

-- Business metrics: offer status is LIVE (fix), + count of commissions waiting for COGS review
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
      (select max(ordered_at) from per_order) last_order_at,
      (select count(*) from public.commission cm where cm.status = 'NEEDS_REVIEW') commissions_needs_review),
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
    from public.product p cross join s left join public.offer ofr on ofr.product_id = p.id and ofr.status = 'LIVE'
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
