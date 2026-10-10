-- Default creator payout = 15% of order subtotal (Shopify subtotal_price: after discounts, excl. shipping & tax).
-- Precedence unchanged: partner override → product/offer rate (when payout_value set) → global default (app_settings 'global').
update public.app_settings
   set value = value || '{"payout_rule":"PCT_REVENUE","payout_value":0.15}'::jsonb, updated_at = now()
 where key = 'global';

-- Global default as seen by a given creator (override if set, else global) — used for «Твоя ставка»
create or replace function private.creator_base_rate(p_creator uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when c.payout_rule is not null
    then jsonb_build_object('rule', c.payout_rule, 'value', c.payout_value, 'source', 'partner')
    else jsonb_build_object('rule', coalesce(s.value ->> 'payout_rule', 'CPA_FIXED'), 'value', (s.value ->> 'payout_value')::numeric, 'source', 'default') end
  from (select 1) one
  left join public.creator c on c.id = p_creator
  left join public.app_settings s on s.key = 'global'
  where (select private.is_admin()) or p_creator = (select private.my_creator_id());
$$;

-- Profile payload now includes the effective base rate
create or replace function private.partner_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'nick', c.display_name, 'login', c.login, 'telegram', c.telegram, 'handles', c.handles,
    'status', c.status, 'email', c.email, 'created_at', c.created_at,
    'rate', private.creator_base_rate(c.id))
  from public.creator c where c.auth_user_id = (select auth.uid());
$$;

-- ── Admin: default rate get/set ──
create or replace function private.admin_get_default_rate() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb;
begin
  perform private.admin_check();
  select value into s from public.app_settings where key = 'global';
  return jsonb_build_object('rule', coalesce(s ->> 'payout_rule', 'CPA_FIXED'), 'value', (s ->> 'payout_value')::numeric);
end $$;

create or replace function private.admin_set_default_rate(p_rule text, p_value numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  if p_rule not in ('CPA_FIXED','PCT_REVENUE') then raise exception 'Неверный тип ставки'; end if;
  if p_value is null or p_value < 0 or (p_rule = 'PCT_REVENUE' and p_value > 1) or (p_rule = 'CPA_FIXED' and p_value > 10000) then
    raise exception 'Неверное значение ставки';
  end if;
  update public.app_settings
     set value = value || jsonb_build_object('payout_rule', p_rule, 'payout_value', p_value), updated_at = now()
   where key = 'global';
  if not found then
    insert into public.app_settings (key, value) values ('global', jsonb_build_object('payout_rule', p_rule, 'payout_value', p_value, 'hold_days', 14, 'attribution_window_days', 7));
  end if;
  insert into public.events (event_id, name, occurred_at, source, props)
  values (gen_random_uuid(), 'admin_default_rate_set', now(), 'rpc:admin', jsonb_build_object('rule', p_rule, 'value', p_value, 'by', coalesce((select auth.jwt()) -> 'app_metadata' ->> 'login', (select auth.jwt()) ->> 'email')));
end $$;

-- admin_partners: add effective base rate
create or replace function private.admin_partners() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.admin_check();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'login', coalesce(c.login, c.display_name), 'nick', c.display_name, 'telegram', c.telegram, 'handles', c.handles,
    'status', c.status, 'self_signup', c.self_signup, 'has_account', c.auth_user_id is not null, 'created_at', c.created_at,
    'payout_rule', c.payout_rule, 'payout_value', c.payout_value,
    'effective', private.creator_base_rate(c.id),
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

create or replace function public.admin_get_default_rate() returns jsonb language sql stable security invoker set search_path = '' as $$ select private.admin_get_default_rate(); $$;
create or replace function public.admin_set_default_rate(p_rule text, p_value numeric) returns void language sql security invoker set search_path = '' as $$ select private.admin_set_default_rate(p_rule, p_value); $$;

do $$
declare f text;
begin
  foreach f in array array['private.creator_base_rate(uuid)', 'private.admin_get_default_rate()', 'private.admin_set_default_rate(text, numeric)',
    'public.admin_get_default_rate()', 'public.admin_set_default_rate(text, numeric)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
