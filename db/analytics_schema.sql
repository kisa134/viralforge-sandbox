-- ViralForge × Likky — analytics core schema (Postgres 14+ / Supabase)
-- Spec: ANALYTICS_SYSTEM.md (2026-10-08, Asia/Dubai)
-- Conventions: money = integer cents + currency; timestamps = timestamptz (UTC stored, report in Asia/Dubai);
-- PII only as salted sha256 hashes; enums as CHECK constraints (easy to extend); no soft delete — status fields.

create extension if not exists pgcrypto;

-- ───────────────────────── Store & offers ─────────────────────────
create table brand (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  domain        text not null unique,
  platform      text not null default 'SHOPIFY' check (platform in ('SHOPIFY','OTHER')),
  shop_id       text,
  currency      char(3) not null default 'USD',
  timezone      text not null default 'Asia/Dubai',
  created_at    timestamptz not null default now()
);

create table product (
  id                   uuid primary key default gen_random_uuid(),
  brand_id             uuid not null references brand(id),
  shopify_product_id   text,
  shopify_variant_id   text unique,
  sku                  text,
  title                text not null,
  handle               text,
  pdp_url              text,
  price_cents          integer not null check (price_cents >= 0),
  cogs_cents           integer check (cogs_cents >= 0),          -- entered by founder; null = unknown
  shipping_cost_cents  integer check (shipping_cost_cents >= 0),
  payment_fee_pct      numeric(5,4) default 0,                   -- e.g. 0.0290
  margin_cents         integer generated always as (
                          price_cents - coalesce(cogs_cents,0) - coalesce(shipping_cost_cents,0)
                          - round(price_cents * coalesce(payment_fee_pct,0))::integer) stored,
  status               text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at           timestamptz not null default now()
);

create table offer (
  id                       uuid primary key default gen_random_uuid(),
  product_id               uuid not null references product(id),
  name                     text not null,
  payout_rule              text not null check (payout_rule in ('CPA_FIXED','PCT_REVENUE','PCT_MARGIN','HYBRID')),
  payout_value             numeric(12,4) not null,               -- cents if CPA_FIXED, fraction (0.15) if PCT_*
  repeat_payout_value      numeric(12,4),                        -- HYBRID: rate for repeat orders
  hold_days                integer not null default 14,
  attribution_window_days  integer not null default 7,
  buyer_discount_pct       numeric(5,4) default 0,
  geos                     text[] default '{}',
  claim_strip              text[] default '{}',
  allowed_claims           text[] default '{}',
  creative_limit           integer,
  is_sandbox               boolean not null default false,
  status                   text not null default 'DRAFT' check (status in ('DRAFT','LIVE','PAUSED','ENDED')),
  created_at               timestamptz not null default now()
);

-- ───────────────────────── Trends & creative ─────────────────────────
create table competitor_account (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null check (platform in ('IG','TT','YT')),
  handle        text not null,
  niche_bucket  text,
  followers     bigint,
  first_seen_at timestamptz not null default now(),
  unique (platform, handle)
);

create table trend (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  niche_bucket  text,
  platform      text check (platform in ('IG','TT','YT','MULTI')),
  signal        text check (signal in ('PATTERN','SOUND','HASHTAG','SEASONAL')),
  viral_score   numeric(10,4),
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','FADING','DEAD')),
  first_seen_at timestamptz not null default now()
);

create table reference_video (
  id                     uuid primary key default gen_random_uuid(),
  competitor_account_id  uuid references competitor_account(id),
  trend_id               uuid references trend(id),
  platform               text not null check (platform in ('IG','TT','YT')),
  url                    text not null,
  code_or_id             text not null,
  plays                  bigint,          -- null = not scraped (never coerce to 0)
  likes                  bigint,
  comments               bigint,
  shares                 bigint,
  saves                  bigint,
  duration_s             numeric(6,2),
  music_id               text,
  cta_pattern            text,
  scrape_date            date not null,
  apify_run_id           text,
  apify_dataset_id       text,
  unique (platform, code_or_id, scrape_date)
);

create table formula_card (
  id            text primary key,                 -- e.g. fc_maker_dont_scroll_craftedbyelliee
  trend_id      uuid references trend(id),
  version       integer not null default 1,
  niche_bucket  text,
  cta_keyword   text,
  card          jsonb not null,                   -- full formula-card.schema.json payload
  status        text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','RETIRED')),
  created_at    timestamptz not null default now()
);

create table scenario (
  id            text primary key,                 -- scenario_id from scenario.schema.json
  formula_id    text references formula_card(id),
  offer_id      uuid references offer(id),
  mode          text not null check (mode in ('AI','HUMAN','HYBRID')),
  pattern       text,
  keyword       text,
  spec          jsonb not null,                   -- full scenario.schema.json payload
  created_at    timestamptz not null default now()
);

-- ───────────────────────── Recruiting & creators ─────────────────────────
create table recruit_source (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('TG_CHAT','TG_CHANNEL','REFERRAL','APP_SIGNUP','OTHER')),
  name           text not null,
  url            text,
  audience_size  integer,
  created_at     timestamptz not null default now()
);

create table recruit_ad (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references recruit_source(id),
  variant     text,
  text_hash   text,
  start_code  text unique,                        -- unique DM start word / deep-link param
  cost_cents  integer not null default 0,
  posted_at   timestamptz not null
);

create table creator_lead (
  id                uuid primary key default gen_random_uuid(),
  recruit_ad_id     uuid references recruit_ad(id),
  source_id         uuid references recruit_source(id),
  tg_username_hash  text,
  stage             text not null default 'NEW' check (stage in
                      ('NEW','REPLIED','SAMPLES_SENT','APPROVED','ONBOARDED','FIRST_POST','FIRST_SALE','REJECTED','GHOSTED')),
  samples_urls      text[] default '{}',
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  stage_changed_at  timestamptz not null default now()
);

create table creator (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid unique references creator_lead(id),
  type             text not null check (type in ('PARTNER_HUMAN','INTERNAL_AI','APP_USER')),
  display_name     text not null,
  geo              text,
  tier             text not null default 'NEW' check (tier in ('NEW','PRO','ELITE')),
  quality_score    numeric(5,2) default 50,
  payout_method    text check (payout_method in ('CARD_RU','USDT','WISE','PAYPAL','OTHER')),
  payout_currency  char(3),
  contact_hash     text,                          -- for self-order fraud check
  kyc_status       text not null default 'NONE' check (kyc_status in ('NONE','PENDING','VERIFIED','REJECTED')),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE','FROZEN','BANNED','CHURNED')),
  activated_at     timestamptz,
  created_at       timestamptz not null default now()
);

create table creator_account (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references creator(id),
  platform     text not null check (platform in ('IG','TT','YT')),
  handle       text not null,
  url          text,
  followers    bigint,
  slot_role    text check (slot_role in ('HERO','GIFT','SEASONAL')),
  verified_at  timestamptz,
  unique (platform, handle)
);

create table assignment (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references creator(id),
  offer_id      uuid not null references offer(id),
  scenario_ids  text[] default '{}',
  posts_target  integer,
  due_at        timestamptz,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','EXHAUSTED','EXPIRED','REVOKED')),
  created_at    timestamptz not null default now()
);
create unique index assignment_active_uk on assignment (creator_id, offer_id) where status = 'ACTIVE';

create table asset (
  id                 uuid primary key default gen_random_uuid(),
  scenario_id        text references scenario(id),
  assignment_id      uuid references assignment(id),
  creator_id         uuid references creator(id),
  batch_id           text,
  source             text not null check (source in ('AI_HIGGSFIELD','HUMAN','HYBRID')),
  file_url           text,
  duration_sec       numeric(6,2),
  aspect             text default '9:16',
  higgsfield_job_id  text,
  cost_credits       numeric(12,2),
  status             text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','READY','REJECTED','POSTED','RETIRED')),
  created_at         timestamptz not null default now()
);

create table qc_review (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references asset(id),
  reviewer     text not null check (reviewer in ('BOT','HUMAN')),
  verdict      text not null check (verdict in ('PASS','FIX','KILL')),
  score        numeric(5,2),
  flags        text[] default '{}',
  reviewed_at  timestamptz not null default now()
);

-- ───────────────────────── Posts & funnel ─────────────────────────
create table keyword (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,                      -- normalized UPPER alnum
  creator_id  uuid not null references creator(id),
  offer_id    uuid not null references offer(id),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED','ABUSED')),
  created_at  timestamptz not null default now()
);
create unique index keyword_active_uk on keyword (keyword, creator_id) where status = 'ACTIVE';

create table post (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid references asset(id),
  creator_account_id  uuid not null references creator_account(id),
  assignment_id       uuid references assignment(id),
  keyword_id          uuid references keyword(id),
  platform            text not null check (platform in ('IG','TT','YT')),
  permalink           text not null unique,
  platform_post_id    text,
  caption             text,
  has_disclosure      boolean,
  status              text not null default 'LIVE' check (status in ('LIVE','DELETED','BANNED')),
  posted_at           timestamptz not null
);

create table post_metrics_snapshot (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references post(id),
  captured_at     timestamptz not null default now(),
  age_hours       integer,
  views           bigint,
  likes           bigint,
  comments        bigint,
  shares          bigint,
  saves           bigint,
  avg_watch_s     numeric(6,2),
  hold_3s_pct     numeric(5,4),
  keyword_comments integer,
  source          text not null check (source in ('APIFY','API','SCREENSHOT','MANUAL'))
);
create index pms_post_time on post_metrics_snapshot (post_id, captured_at desc);

create table promo_code (
  code                 text primary key,
  creator_id           uuid not null references creator(id),
  offer_id             uuid references offer(id),
  shopify_discount_id  text,
  discount_pct         numeric(5,4) default 0,
  status               text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED'))
);

create table tracked_link (
  token          text primary key,                -- base62 ~64 bit, never sequential
  creator_id     uuid not null references creator(id),
  offer_id       uuid not null references offer(id),
  post_id        uuid references post(id),        -- null = evergreen creator×offer link
  sub_id         text,
  promo_code     text references promo_code(code),
  dest_url       text not null,
  utm_source     text default 'vf',
  utm_medium     text default 'creator',
  utm_campaign   text,
  utm_content    text,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create table dm_conversation (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid references post(id),
  keyword_id       uuid references keyword(id),
  creator_id       uuid not null references creator(id),
  platform         text check (platform in ('IG','TT','YT')),
  fan_handle_hash  text,
  link_token       text references tracked_link(token),
  source           text not null check (source in ('MANYCHAT','BOT','SELF_REPORT')),
  started_at       timestamptz not null default now(),
  link_sent_at     timestamptz
);

create table click (
  id          uuid primary key default gen_random_uuid(),
  token       text not null references tracked_link(token),
  visitor_id  text,
  clicked_at  timestamptz not null default now(),
  ip_hash     text,
  ua_hash     text,
  referer     text,
  country     char(2),
  is_bot      boolean not null default false
);
create index click_token_time on click (token, clicked_at desc);

create table session (
  id                uuid primary key default gen_random_uuid(),
  visitor_id        text not null,
  click_id          uuid unique references click(id),
  token             text references tracked_link(token),
  started_at        timestamptz not null,
  landing_url       text,
  utm_source        text, utm_medium text, utm_campaign text, utm_content text,
  pages             integer default 1,
  product_viewed    boolean default false,
  added_to_cart     boolean default false,
  checkout_started  boolean default false
);

-- ───────────────────────── Orders, attribution, money ─────────────────────────
create table "order" (
  id                uuid primary key default gen_random_uuid(),
  external_id       text not null unique,          -- Shopify order id
  brand_id          uuid not null references brand(id),
  session_id        uuid references session(id),
  ordered_at        timestamptz not null,
  currency          char(3) not null default 'USD',
  subtotal_cents    integer not null,
  discount_cents    integer not null default 0,
  shipping_cents    integer not null default 0,
  tax_cents         integer not null default 0,
  total_cents       integer not null,
  financial_status  text not null check (financial_status in ('PENDING','PAID','PARTIALLY_REFUNDED','REFUNDED','VOIDED','CHARGEBACK')),
  customer_hash     text,
  is_first_order    boolean,
  landing_site      text,
  referring_site    text,
  discount_codes    text[] default '{}',
  note_attributes   jsonb,
  is_sandbox        boolean not null default false
);
create index order_customer on "order" (customer_hash);

create table order_item (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references "order"(id) on delete cascade,
  product_id      uuid references product(id),
  variant_id      text,
  qty             integer not null check (qty > 0),
  price_cents     integer not null,
  cogs_cents      integer,                         -- snapshot at order time
  discount_cents  integer not null default 0
);

create table refund (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references "order"(id),
  external_id   text unique,
  type          text not null check (type in ('REFUND','CANCEL','CHARGEBACK')),
  amount_cents  integer not null,
  reason        text,
  created_at    timestamptz not null
);

create table attribution_touch (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('LINK_CLICK','PROMO','KEYWORD','DM','PIXEL','MANUAL')),
  creator_id   uuid not null references creator(id),
  offer_id     uuid references offer(id),
  post_id      uuid references post(id),
  token        text references tracked_link(token),
  visitor_id   text,
  order_id     uuid references "order"(id),        -- filled for PROMO/PIXEL/MANUAL
  occurred_at  timestamptz not null,
  raw          jsonb
);
create index touch_visitor on attribution_touch (visitor_id, occurred_at desc);
create index touch_token on attribution_touch (token);

create table conversion (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references "order"(id),   -- max one payable conversion per order
  touch_id        uuid not null references attribution_touch(id),
  first_touch_id  uuid references attribution_touch(id),
  creator_id      uuid not null references creator(id),
  offer_id        uuid references offer(id),
  post_id         uuid references post(id),
  method          text not null check (method in ('PROMO','LINK','PIXEL','KEYWORD','MANUAL')),
  model           text not null default 'LAST_PAYABLE',
  window_days     integer not null,
  is_valid        boolean not null default true,
  fraud_flag      text,
  created_at      timestamptz not null default now()
);

create table payout (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references creator(id),
  period_start  date not null,
  period_end    date not null,
  amount_cents  integer not null,                  -- in USD cents (base)
  currency      char(3) not null,                  -- paid currency
  fx_rate       numeric(14,6),                     -- paid currency per 1 USD
  method        text not null check (method in ('CARD_RU','USDT','WISE','PAYPAL','OTHER')),
  status        text not null default 'DRAFT' check (status in ('DRAFT','PROCESSING','PAID','FAILED')),
  proof_ref     text,
  is_sandbox    boolean not null default false,
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table commission (
  id               uuid primary key default gen_random_uuid(),
  conversion_id    uuid references conversion(id),
  refund_id        uuid references refund(id),      -- set for CLAWBACK
  creator_id       uuid not null references creator(id),
  kind             text not null check (kind in ('CPA','REVSHARE','BONUS','ADJUSTMENT','CLAWBACK')),
  basis_cents      integer,                         -- revenue or margin base used
  rate             numeric(12,4),
  amount_cents     integer not null,                -- signed: CLAWBACK negative
  currency         char(3) not null default 'USD',
  status           text not null default 'HELD' check (status in ('HELD','APPROVED','PAID','VOID')),
  hold_until       timestamptz,
  payout_id        uuid references payout(id),
  idempotency_key  text not null unique,            -- e.g. cpa:{order_id} / clawback:{order_id}:{refund_id}
  is_sandbox       boolean not null default false,
  created_at       timestamptz not null default now()
);
create index commission_creator_status on commission (creator_id, status);

create table cost_item (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('HIGGSFIELD','APIFY','ADS','SAMPLES','RECRUIT_AD','TOOLS','FEES','OTHER')),
  amount_cents  integer not null,
  currency      char(3) not null default 'USD',
  incurred_at   timestamptz not null,
  ref_type      text check (ref_type in ('ASSET','POST','CREATOR','RECRUIT_AD','OFFER','TREND','NONE')),
  ref_id        text,
  external_ref  text,                               -- Apify run id, Higgsfield txn id, invoice
  note          text
);

create table experiment (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  hypothesis      text,
  entity_type     text not null check (entity_type in ('FORMULA','SCENARIO','RECRUIT_AD','OFFER','POST')),
  variants        jsonb not null,
  primary_metric  text not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  result          text
);

create table experiment_assignment (
  experiment_id  uuid not null references experiment(id),
  variant        text not null,
  entity_id      text not null,
  assigned_at    timestamptz not null default now(),
  primary key (experiment_id, entity_id)
);

-- Raw append-only event log (all sources); entities are materialized from here in v2.
create table events (
  event_id     uuid primary key,
  name         text not null,
  occurred_at  timestamptz not null,
  source       text not null,
  is_sandbox   boolean not null default false,
  props        jsonb not null default '{}',
  received_at  timestamptz not null default now()
);
create index events_name_time on events (name, occurred_at desc);

-- ───────────────────────── Reporting views ─────────────────────────
create view v_post_latest_metrics as
select distinct on (post_id) post_id, captured_at, views, likes, comments, shares, saves, keyword_comments
from post_metrics_snapshot order by post_id, captured_at desc;

-- Per-post funnel rollup (used by the /analytics cabinet SupabaseDataSource)
create view v_post_funnel as
select p.id as post_id,
       (select m.keyword_comments from v_post_latest_metrics m where m.post_id = p.id) as keyword_comments,
       (select count(*) from dm_conversation d where d.post_id = p.id and d.link_sent_at is not null) as dm_sent,
       (select count(*) from click c join tracked_link t on t.token = c.token where t.post_id = p.id and not c.is_bot) as clicks,
       (select count(*) from session s join tracked_link t on t.token = s.token where t.post_id = p.id) as sessions
from post p;

create view v_order_margin as
select o.id as order_id, o.ordered_at, o.is_sandbox,
       o.subtotal_cents - o.discount_cents as gross_net_cents,
       coalesce((select sum(r.amount_cents) from refund r where r.order_id = o.id), 0) as refunded_cents,
       coalesce((select sum(oi.cogs_cents * oi.qty) from order_item oi where oi.order_id = o.id), 0) as cogs_cents
from "order" o;

create view v_creator_leaderboard as
select c.id as creator_id, c.display_name, c.type,
       count(distinct p.id) as posts,
       coalesce(sum(m.views), 0) as views,
       (select count(*) from conversion cv where cv.creator_id = c.id and cv.is_valid) as orders,
       (select coalesce(sum(cm.amount_cents), 0) from commission cm where cm.creator_id = c.id and cm.status <> 'VOID') as earned_cents
from creator c
left join creator_account ca on ca.creator_id = c.id
left join post p on p.creator_account_id = ca.id
left join v_post_latest_metrics m on m.post_id = p.id
group by c.id;

create view v_formula_perf as
select f.id as formula_id,
       count(distinct p.id) as posts,
       percentile_cont(0.5) within group (order by m.views) as median_views,
       count(distinct cv.id) as orders
from formula_card f
left join scenario s on s.formula_id = f.id
left join asset a on a.scenario_id = s.id
left join post p on p.asset_id = a.id
left join v_post_latest_metrics m on m.post_id = p.id
left join conversion cv on cv.post_id = p.id and cv.is_valid
group by f.id;

create view v_recruit_funnel as
select rs.id as source_id, rs.name,
       count(distinct ra.id) as ads,
       count(distinct l.id) as leads,
       count(distinct l.id) filter (where l.stage in ('APPROVED','ONBOARDED','FIRST_POST','FIRST_SALE')) as approved,
       count(distinct l.id) filter (where l.stage in ('ONBOARDED','FIRST_POST','FIRST_SALE')) as onboarded,
       count(distinct l.id) filter (where l.stage in ('FIRST_POST','FIRST_SALE')) as first_post,
       count(distinct l.id) filter (where l.stage = 'FIRST_SALE') as first_sale
from recruit_source rs
left join recruit_ad ra on ra.source_id = rs.id
left join creator_lead l on l.recruit_ad_id = ra.id or (l.recruit_ad_id is null and l.source_id = rs.id)
group by rs.id;
