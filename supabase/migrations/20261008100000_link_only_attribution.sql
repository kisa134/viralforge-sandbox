-- Link-only attribution (founder decision 2026-10-08: no Shopify discount codes).
-- Orders are matched by `ref` (tracked link slug) from landing_site / landing_site_ref / note (cart) attributes / referring_site;
-- unmatched orders are assigned manually by an admin via attribute_order_manual().
alter table public."order" add column if not exists landing_site_ref text;
alter table public."order" add column if not exists ref text;               -- resolved tracked_link slug (if any)
create index if not exists order_ref_idx on public."order" (ref);
create index if not exists tracked_link_utm_content_idx on public.tracked_link (utm_content);
comment on table public.promo_code is
  'Internal creator slug LIKKY-<NICK>. NOT required to exist in Shopify; used only as an optional fallback if an order happens to carry such a discount code.';

-- Manual (re)assignment of an order to a creator, or removal (p_creator = null). Admin-only (RLS + explicit check).
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
  v_rule := coalesce(c.payout_rule, s ->> 'payout_rule', 'CPA_FIXED');
  v_value := case when c.payout_rule is not null then c.payout_value else (s ->> 'payout_value')::numeric end;
  if v_value is null then return v_conv; end if;                 -- «задай сумму»: attributed, commission waits

  if v_rule = 'CPA_FIXED' then
    v_amount := round(v_value * 100);
  elsif v_rule = 'PCT_REVENUE' then
    v_basis := o.subtotal_cents; v_amount := round(o.subtotal_cents * v_value);
  else
    select bool_or(cogs_cents is null), sum(cogs_cents * qty) into v_cogs_missing, v_cogs from public.order_item where order_id = o.id;
    if v_cogs_missing is distinct from false then return v_conv; end if;   -- no items or missing COGS
    v_basis := o.subtotal_cents - v_cogs; v_amount := greatest(0, round(v_basis * v_value));
  end if;

  insert into public.commission (conversion_id, creator_id, kind, basis_cents, rate, amount_cents, status, hold_until, idempotency_key)
  values (v_conv, c.id, 'CPA', v_basis, v_value, v_amount, 'HELD',
          o.ordered_at + make_interval(days => coalesce((s ->> 'hold_days')::int, 14)), 'cpa:' || o.external_id);
  return v_conv;
end $$;

revoke all on function public.attribute_order_manual(uuid, uuid) from public, anon;
grant execute on function public.attribute_order_manual(uuid, uuid) to authenticated;
