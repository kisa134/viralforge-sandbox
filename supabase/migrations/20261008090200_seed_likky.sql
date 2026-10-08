-- Seed: Likky store + public catalog (prices from likky.store, 2026-10-08). COGS unknown → null (founder enters in the cabinet).
insert into public.brand (name, domain, platform, shop_id, currency, timezone)
values ('Likky', 'likky.store', 'SHOPIFY', '107855249749', 'USD', 'Asia/Dubai')
on conflict (domain) do nothing;

with b as (select id from public.brand where domain = 'likky.store')
insert into public.product (brand_id, title, handle, pdp_url, price_cents, sku)
select b.id, v.title, v.handle, 'https://likky.store/products/' || v.handle, v.price, v.handle
from b, (values
  ('Dragon Night Lamp', 'study-room-creative-night-light-resin-ornaments', 4995),
  ('Witch Cauldron Lamp', 'luminous-witchs-cauldron-lamp-resin-craft', 4995),
  ('Fire Dragon Halloween Lamp', 'design-a-resin-lantern-as-a-halloween-gift', 7995),
  ('Bat Halloween Lamp', 'bat-wing-table-lamp-halloween-resin-ornaments', 4995),
  ('Baby Halloween Bat Costume', 'new-baby-halloween-long-sleeved-jumpsuit-pumpkin-letter-halloween-baby-jumpsuits-triangle-rompers', 3995)
) as v(title, handle, price)
where not exists (select 1 from public.product p where p.handle = v.handle);

-- One evergreen offer per product; payout rule comes from app_settings (payout_value null = «задай сумму»)
insert into public.offer (product_id, name, payout_rule, payout_value, status)
select p.id, p.title, 'CPA_FIXED', null, 'LIVE'
from public.product p
where not exists (select 1 from public.offer o where o.product_id = p.id);
