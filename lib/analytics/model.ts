// Client-side entity model for the /analytics cabinet.
// Field names mirror db/analytics_schema.sql (snake_case) so Supabase rows map 1:1.
// Money = integer cents (USD). Dates = ISO strings.

export type Platform = "IG" | "TT" | "YT";
export type DatasetKind = "DEMO" | "IMPORT" | "SUPABASE";

export interface Product { id: string; title: string; price_cents: number; cogs_cents: number | null }
export interface Offer {
  id: string; product_id: string; name: string;
  payout_rule: "CPA_FIXED" | "PCT_REVENUE" | "PCT_MARGIN" | "HYBRID";
  payout_value: number; hold_days: number;
}
export interface Trend { id: string; name: string; niche_bucket: string | null }
export interface FormulaCard { id: string; trend_id: string | null; name: string; cta_keyword: string | null }
export interface Scenario { id: string; formula_id: string | null; offer_id: string | null; mode: "AI" | "HUMAN" | "HYBRID" }

export interface RecruitSource { id: string; name: string; type: string }
export interface RecruitAd { id: string; source_id: string; variant: string | null; posted_at: string; cost_cents: number }
export type LeadStage =
  | "NEW" | "REPLIED" | "SAMPLES_SENT" | "APPROVED" | "ONBOARDED" | "FIRST_POST" | "FIRST_SALE" | "REJECTED" | "GHOSTED";
export interface CreatorLead { id: string; recruit_ad_id: string | null; source_id: string | null; stage: LeadStage; created_at: string }

export interface Creator {
  id: string; lead_id: string | null; type: "PARTNER_HUMAN" | "INTERNAL_AI" | "APP_USER";
  display_name: string; status: string; activated_at: string | null; promo_code: string | null;
}
export interface Asset {
  id: string; scenario_id: string | null; creator_id: string | null;
  source: "AI_HIGGSFIELD" | "HUMAN" | "HYBRID"; qc_verdict: "PASS" | "FIX" | "KILL" | null;
}
export interface Post {
  id: string; asset_id: string | null; creator_id: string; platform: Platform; permalink: string; posted_at: string;
  formula_id: string | null; // denormalized: post → asset → scenario → formula
}
/** Latest PostMetricsSnapshot + funnel rollup (v_post_latest_metrics + v_post_funnel). null = not measured. */
export interface PostStats {
  post_id: string; views: number | null; likes: number | null; comments: number | null; shares: number | null;
  saves: number | null; keyword_comments: number | null; dm_sent: number | null; clicks: number | null; sessions: number | null;
}
export interface Order {
  id: string; external_id: string; ordered_at: string; subtotal_cents: number; discount_cents: number;
  total_cents: number; discount_codes: string[]; is_sandbox: boolean;
}
export interface OrderItem { order_id: string; product_id: string | null; title: string | null; qty: number; price_cents: number; cogs_cents: number | null }
export interface Refund { order_id: string; amount_cents: number; created_at: string; type: "REFUND" | "CANCEL" | "CHARGEBACK" }
export interface Conversion {
  order_id: string; creator_id: string; post_id: string | null; offer_id: string | null;
  method: "PROMO" | "LINK" | "PIXEL" | "KEYWORD" | "MANUAL";
}
export interface Commission {
  id: string; conversion_order_id: string | null; creator_id: string;
  kind: "CPA" | "REVSHARE" | "BONUS" | "ADJUSTMENT" | "CLAWBACK";
  amount_cents: number; status: "HELD" | "APPROVED" | "PAID" | "VOID"; payout_id: string | null;
}
export interface Payout { id: string; creator_id: string; amount_cents: number; status: "DRAFT" | "PROCESSING" | "PAID" | "FAILED"; paid_at: string | null; method: string }
export interface CostItem {
  category: "HIGGSFIELD" | "APIFY" | "ADS" | "SAMPLES" | "RECRUIT_AD" | "TOOLS" | "FEES" | "OTHER";
  amount_cents: number; incurred_at: string; ref_type: string | null; ref_id: string | null;
}

export interface Dataset {
  meta: { kind: DatasetKind; label: string; generated_at: string; warnings: string[] };
  products: Product[]; offers: Offer[]; trends: Trend[]; formulas: FormulaCard[]; scenarios: Scenario[];
  recruit_sources: RecruitSource[]; recruit_ads: RecruitAd[]; leads: CreatorLead[];
  creators: Creator[]; assets: Asset[]; posts: Post[]; post_stats: PostStats[];
  orders: Order[]; order_items: OrderItem[]; refunds: Refund[]; conversions: Conversion[];
  commissions: Commission[]; payouts: Payout[]; costs: CostItem[];
}

export function emptyDataset(kind: DatasetKind, label: string): Dataset {
  return {
    meta: { kind, label, generated_at: new Date().toISOString(), warnings: [] },
    products: [], offers: [], trends: [], formulas: [], scenarios: [], recruit_sources: [], recruit_ads: [], leads: [],
    creators: [], assets: [], posts: [], post_stats: [], orders: [], order_items: [], refunds: [], conversions: [],
    commissions: [], payouts: [], costs: [],
  };
}

export interface DataSource {
  id: DatasetKind;
  label: string;
  isDemo: boolean;
  load(): Promise<Dataset>;
}
