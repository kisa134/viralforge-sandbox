// SupabaseDataSource — live mode. Reads tables/views from supabase/migrations via the logged-in admin session (RLS).
// Not yet tested against a live project (Supabase project creation is blocked until the invoice is paid).
import type { DataSource, Dataset, Platform } from "./model";
import { emptyDataset } from "./model";
import { sb, supabaseConfigured } from "./sbClient";

export { supabaseConfigured };
type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function table(name: string): Promise<R[]> {
  const c = sb();
  if (!c) throw new Error("Supabase не настроен");
  const { data, error } = await c.from(name).select("*").limit(10000);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data ?? [];
}

export class SupabaseDataSource implements DataSource {
  id = "SUPABASE" as const;
  label = "База (Supabase)";
  isDemo = false;
  async load(): Promise<Dataset> {
    const d = emptyDataset("SUPABASE", "База · Supabase (живые данные)");
    if (!supabaseConfigured) { d.meta.warnings.push("Supabase не настроен."); return d; }
    try {
      const [products, trends, formulas, scenarios, sources, ads, leads, creators, promos, accounts, assets, qc, posts,
        metrics, funnel, orders, items, refunds, convs, comms, payouts, costs] = await Promise.all([
        table("product"), table("trend"), table("formula_card"), table("scenario"), table("recruit_source"),
        table("recruit_ad"), table("creator_lead"), table("creator"), table("promo_code"), table("creator_account"), table("asset"),
        table("qc_review"), table("post"), table("v_post_latest_metrics"), table("v_post_funnel"), table("order"), table("order_item"),
        table("refund"), table("conversion"), table("commission"), table("payout"), table("cost_item"),
      ]);
      if (!products.length) d.meta.warnings.push("База пустая или нет доступа: проверьте, что ваш email добавлен в таблицу admins.");
      d.products = products.map((p) => ({ id: p.id, title: p.title, price_cents: p.price_cents, cogs_cents: p.cogs_cents }));
      d.trends = trends.map((t) => ({ id: t.id, name: t.name, niche_bucket: t.niche_bucket }));
      d.formulas = formulas.map((f) => ({ id: f.id, trend_id: f.trend_id, name: f.card?.hook ?? f.id, cta_keyword: f.cta_keyword }));
      d.scenarios = scenarios.map((s) => ({ id: s.id, formula_id: s.formula_id, offer_id: s.offer_id, mode: s.mode }));
      d.recruit_sources = sources.map((s) => ({ id: s.id, name: s.name, type: s.type }));
      d.recruit_ads = ads.map((a) => ({ id: a.id, source_id: a.source_id, variant: a.variant, posted_at: a.posted_at, cost_cents: a.cost_cents }));
      d.leads = leads.map((l) => ({ id: l.id, recruit_ad_id: l.recruit_ad_id, source_id: l.source_id ?? ads.find((a) => a.id === l.recruit_ad_id)?.source_id ?? null, stage: l.stage, created_at: l.created_at }));
      d.creators = creators.map((c) => ({ id: c.id, lead_id: c.lead_id, type: c.type, display_name: "@" + c.display_name, status: c.status, activated_at: c.activated_at ?? c.created_at, promo_code: promos.find((p) => p.creator_id === c.id)?.code ?? null }));
      const lastQc = new Map<string, R>();
      for (const q of qc) { const prev = lastQc.get(q.asset_id); if (!prev || prev.reviewed_at < q.reviewed_at) lastQc.set(q.asset_id, q); }
      d.assets = assets.map((a) => ({ id: a.id, scenario_id: a.scenario_id, creator_id: a.creator_id, source: a.source, qc_verdict: lastQc.get(a.id)?.verdict ?? null }));
      const accCreator = new Map(accounts.map((a) => [a.id, a.creator_id]));
      const assetScenario = new Map(assets.map((a) => [a.id, a.scenario_id]));
      const scenarioFormula = new Map(scenarios.map((s) => [s.id, s.formula_id]));
      d.posts = posts.map((p) => ({ id: p.id, asset_id: p.asset_id, creator_id: accCreator.get(p.creator_account_id) ?? "", platform: p.platform as Platform, permalink: p.permalink, posted_at: p.posted_at, formula_id: scenarioFormula.get(assetScenario.get(p.asset_id) ?? "") ?? null }));
      const m = new Map(metrics.map((x) => [x.post_id, x]));
      const f = new Map(funnel.map((x) => [x.post_id, x]));
      d.post_stats = posts.map((p) => { const a = m.get(p.id) ?? {}; const b = f.get(p.id) ?? {}; return { post_id: p.id, views: a.views ?? null, likes: a.likes ?? null, comments: a.comments ?? null, shares: a.shares ?? null, saves: a.saves ?? null, keyword_comments: b.keyword_comments ?? null, dm_sent: b.dm_sent ?? null, clicks: b.clicks ?? null, sessions: b.sessions ?? null }; });
      d.orders = orders.map((o) => ({ id: o.id, external_id: o.name ?? o.external_id, ordered_at: o.ordered_at, subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, total_cents: o.total_cents, discount_codes: o.discount_codes ?? [], is_sandbox: o.is_sandbox }));
      d.order_items = items.map((i) => ({ order_id: i.order_id, product_id: i.product_id, title: null, qty: i.qty, price_cents: i.price_cents, cogs_cents: i.cogs_cents }));
      d.refunds = refunds.map((r) => ({ order_id: r.order_id, amount_cents: r.amount_cents, created_at: r.created_at, type: r.type }));
      d.conversions = convs.filter((c) => c.is_valid).map((c) => ({ order_id: c.order_id, creator_id: c.creator_id, post_id: c.post_id, offer_id: c.offer_id, method: c.method }));
      const convOrder = new Map(convs.map((c) => [c.id, c.order_id]));
      const now = Date.now();
      d.commissions = comms.map((c) => ({
        id: c.id, conversion_order_id: convOrder.get(c.conversion_id) ?? null, creator_id: c.creator_id, kind: c.kind, amount_cents: c.amount_cents,
        status: c.status === "HELD" && c.hold_until && new Date(c.hold_until).getTime() <= now ? "APPROVED" : c.status, // matured hold
        payout_id: c.payout_id, hold_until: c.hold_until,
      }));
      d.payouts = payouts.map((p) => ({ id: p.id, creator_id: p.creator_id, amount_cents: p.amount_cents, status: p.status, paid_at: p.paid_at, method: p.proof_ref || p.method }));
      d.costs = costs.map((c) => ({ category: c.category, amount_cents: c.amount_cents, incurred_at: c.incurred_at, ref_type: c.ref_type, ref_id: c.ref_id }));
    } catch (e) {
      d.meta.warnings.push(`Ошибка загрузки из Supabase: ${(e as Error).message}`);
    }
    return d;
  }
}
