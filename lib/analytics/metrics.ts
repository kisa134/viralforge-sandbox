// Metric formulas = docs/ANALYTICS_SYSTEM.md §6. Pure functions over Dataset; null = no data (never fake 0).
import type { Dataset, PostStats } from "./model";

export type Period = 7 | 30 | 0; // 0 = all time

export function filterByPeriod(d: Dataset, days: Period, now = Date.now()): Dataset {
  if (!days) return d;
  const from = now - days * 86400000;
  const inP = (iso: string | null) => !!iso && new Date(iso).getTime() >= from;
  const posts = d.posts.filter((p) => inP(p.posted_at));
  const postIds = new Set(posts.map((p) => p.id));
  const orders = d.orders.filter((o) => inP(o.ordered_at));
  const orderIds = new Set(orders.map((o) => o.id));
  return {
    ...d,
    recruit_ads: d.recruit_ads.filter((a) => inP(a.posted_at)),
    leads: d.leads.filter((l) => inP(l.created_at)),
    posts,
    post_stats: d.post_stats.filter((s) => postIds.has(s.post_id)),
    orders,
    order_items: d.order_items.filter((i) => orderIds.has(i.order_id)),
    refunds: d.refunds.filter((r) => orderIds.has(r.order_id)),
    conversions: d.conversions.filter((c) => orderIds.has(c.order_id)),
    commissions: d.commissions.filter((c) => !c.conversion_order_id || orderIds.has(c.conversion_order_id)),
    payouts: d.payouts.filter((p) => !p.paid_at || inP(p.paid_at)),
    costs: d.costs.filter((c) => inP(c.incurred_at)),
  };
}

const sumN = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
export const ratio = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Money {
  gross_cents: number; refunds_cents: number; net_cents: number; cogs_cents: number | null; margin_cents: number | null;
  commission_cents: number; commission_by_status: Record<string, number>; costs_by_category: Record<string, number>;
  content_cost_cents: number; recruit_cost_cents: number; profit_cents: number | null; orders: number; attributed_orders: number;
  aov_cents: number | null; cac_per_sale_cents: number | null; romi: number | null; paid_out_cents: number;
}

export function money(d: Dataset): Money {
  const refundsBy = new Map<string, number>();
  for (const r of d.refunds) refundsBy.set(r.order_id, (refundsBy.get(r.order_id) ?? 0) + r.amount_cents);
  const gross = d.orders.reduce((a, o) => a + o.total_cents, 0);
  const refunds = d.refunds.reduce((a, r) => a + r.amount_cents, 0);
  let cogsKnown = true; let cogs = 0;
  const refundedFully = new Set(d.orders.filter((o) => (refundsBy.get(o.id) ?? 0) >= o.total_cents).map((o) => o.id));
  for (const it of d.order_items) {
    if (refundedFully.has(it.order_id)) continue;
    if (it.cogs_cents === null) cogsKnown = false; else cogs += it.cogs_cents * it.qty;
  }
  if (!d.order_items.length) cogsKnown = false;
  const byStatus: Record<string, number> = { HELD: 0, APPROVED: 0, PAID: 0, VOID: 0 };
  for (const c of d.commissions) byStatus[c.status] = (byStatus[c.status] ?? 0) + c.amount_cents;
  const commission = byStatus.HELD + byStatus.APPROVED + byStatus.PAID;
  const costsBy: Record<string, number> = {};
  for (const c of d.costs) costsBy[c.category] = (costsBy[c.category] ?? 0) + c.amount_cents;
  const content = (costsBy.HIGGSFIELD ?? 0) + (costsBy.APIFY ?? 0) + (costsBy.SAMPLES ?? 0) + (costsBy.ADS ?? 0);
  const recruit = (costsBy.RECRUIT_AD ?? 0) + d.recruit_ads.reduce((a, x) => a + x.cost_cents, 0);
  const net = gross - refunds;
  const margin = cogsKnown ? net - cogs : null;
  const spend = commission + content + recruit;
  const profit = margin === null ? null : margin - spend;
  const attributed = d.conversions.length;
  return {
    gross_cents: gross, refunds_cents: refunds, net_cents: net, cogs_cents: cogsKnown ? cogs : null, margin_cents: margin,
    commission_cents: commission, commission_by_status: byStatus, costs_by_category: costsBy, content_cost_cents: content,
    recruit_cost_cents: recruit, profit_cents: profit, orders: d.orders.length, attributed_orders: attributed,
    aov_cents: d.orders.length ? Math.round(gross / d.orders.length) : null,
    cac_per_sale_cents: attributed ? Math.round(spend / attributed) : null,
    romi: profit === null || spend === 0 ? null : profit / spend,
    paid_out_cents: d.payouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount_cents, 0),
  };
}

export interface FunnelStep { key: string; label: string; value: number | null; hint: string }

export function funnel(d: Dataset): FunnelStep[] {
  const st = d.post_stats;
  const s = (k: keyof PostStats) => sumN(st.map((x) => x[k] as number | null));
  const m = money(d);
  const qcPass = d.assets.filter((a) => a.qc_verdict === "PASS").length;
  return [
    { key: "trends", label: "Тренды", value: d.trends.length || null, hint: "Apify → кластеры" },
    { key: "formulas", label: "Формулы", value: d.formulas.length || null, hint: "formula cards" },
    { key: "scenarios", label: "Сценарии / ТЗ", value: d.scenarios.length || null, hint: "scenario.schema" },
    { key: "assets", label: "Ролики сделано", value: d.assets.length || null, hint: "AI + живые" },
    { key: "qc", label: "Прошли QC", value: d.assets.length ? qcPass : null, hint: "PASS" },
    { key: "posts", label: "Посты", value: d.posts.length || null, hint: "post_confirm" },
    { key: "views", label: "Просмотры", value: s("views"), hint: "последний снапшот" },
    { key: "kw", label: "Комменты с кодом", value: s("keyword_comments"), hint: "keyword" },
    { key: "dm", label: "DM со ссылкой", value: s("dm_sent"), hint: "dm_link_sent" },
    { key: "clicks", label: "Клики", value: s("clicks"), hint: "редиректор" },
    { key: "sessions", label: "Сессии", value: s("sessions"), hint: "Shopify pixel" },
    { key: "orders", label: "Заказы (атриб.)", value: d.orders.length ? m.attributed_orders : null, hint: "conversion" },
    { key: "refunds", label: "Возвраты", value: d.orders.length ? d.refunds.length : null, hint: "refund" },
    { key: "accrued", label: "Начислено, $", value: d.commissions.length ? m.commission_cents / 100 : null, hint: "HELD+APPROVED+PAID" },
    { key: "paid", label: "Выплачено, $", value: d.payouts.length ? m.paid_out_cents / 100 : null, hint: "payout PAID" },
  ];
}

export interface FormulaRow {
  id: string; name: string; trend: string | null; posts: number; views: number | null; median_views: number | null;
  hit_rate: number | null; er: number | null; kw_per_1k: number | null; orders: number; revenue_cents: number; rev_per_1k_views: number | null;
}
export function formulaTable(d: Dataset, hitThreshold: number): FormulaRow[] {
  const stats = new Map(d.post_stats.map((s) => [s.post_id, s]));
  const orderTotal = new Map(d.orders.map((o) => [o.id, o.total_cents]));
  const postFormula = new Map(d.posts.map((p) => [p.id, p.formula_id]));
  const rows: FormulaRow[] = [];
  const formulas = [...d.formulas, { id: "__none", trend_id: null, name: "Без формулы / неизвестно", cta_keyword: null }];
  for (const f of formulas) {
    const posts = d.posts.filter((p) => (p.formula_id ?? "__none") === f.id);
    if (!posts.length && f.id === "__none") continue;
    const ss = posts.map((p) => stats.get(p.id)).filter(Boolean) as PostStats[];
    const views = sumN(ss.map((s) => s.views));
    const viewList = ss.map((s) => s.views).filter((v): v is number => v !== null);
    const eng = sumN(ss.map((s) => (s.views === null ? null : (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.saves ?? 0))));
    const convs = d.conversions.filter((c) => c.post_id && (postFormula.get(c.post_id) ?? "__none") === f.id);
    const revenue = convs.reduce((a, c) => a + (orderTotal.get(c.order_id) ?? 0), 0);
    rows.push({
      id: f.id, name: f.name, trend: d.trends.find((t) => t.id === f.trend_id)?.name ?? null, posts: posts.length, views,
      median_views: median(viewList), hit_rate: viewList.length ? viewList.filter((v) => v >= hitThreshold).length / viewList.length : null,
      er: ratio(eng, views), kw_per_1k: (() => { const k = sumN(ss.map((s) => s.keyword_comments)); const r = ratio(k, views); return r === null ? null : r * 1000; })(),
      orders: convs.length, revenue_cents: revenue, rev_per_1k_views: views ? (revenue / views) * 1000 : null,
    });
  }
  return rows.sort((a, b) => b.revenue_cents - a.revenue_cents || (b.views ?? 0) - (a.views ?? 0));
}

export interface CreatorRow {
  id: string; name: string; type: string; source: string | null; posts: number; posts_per_day: number | null; views: number | null;
  clicks: number | null; orders: number; cr: number | null; revenue_cents: number; earned_cents: number; epc_cents: number | null;
  refund_rate: number | null; last_post: string | null;
}
export function creatorTable(d: Dataset, days: Period): CreatorRow[] {
  const stats = new Map(d.post_stats.map((s) => [s.post_id, s]));
  const orderTotal = new Map(d.orders.map((o) => [o.id, o.total_cents]));
  const refunded = new Set(d.refunds.map((r) => r.order_id));
  const leadSource = new Map(d.leads.map((l) => [l.id, l.source_id]));
  const sourceName = new Map(d.recruit_sources.map((s) => [s.id, s.name]));
  return d.creators.map((c) => {
    const posts = d.posts.filter((p) => p.creator_id === c.id);
    const ss = posts.map((p) => stats.get(p.id)).filter(Boolean) as PostStats[];
    const clicks = sumN(ss.map((s) => s.clicks));
    const convs = d.conversions.filter((x) => x.creator_id === c.id);
    const earned = d.commissions.filter((x) => x.creator_id === c.id && x.status !== "VOID").reduce((a, x) => a + x.amount_cents, 0);
    const last = posts.map((p) => p.posted_at).sort().pop() ?? null;
    const span = days || (posts.length ? Math.max(1, (Date.now() - new Date(posts.map((p) => p.posted_at).sort()[0]).getTime()) / 86400000) : 0);
    const src = c.lead_id ? leadSource.get(c.lead_id) : null;
    return {
      id: c.id, name: c.display_name, type: c.type, source: src ? sourceName.get(src) ?? null : c.type === "INTERNAL_AI" ? "наш аккаунт" : null,
      posts: posts.length, posts_per_day: span ? posts.length / span : null, views: sumN(ss.map((s) => s.views)), clicks,
      orders: convs.length, cr: ratio(convs.length, clicks), revenue_cents: convs.reduce((a, x) => a + (orderTotal.get(x.order_id) ?? 0), 0),
      earned_cents: earned, epc_cents: clicks ? earned / clicks : null,
      refund_rate: convs.length ? convs.filter((x) => refunded.has(x.order_id)).length / convs.length : null, last_post: last,
    };
  }).sort((a, b) => b.earned_cents - a.earned_cents || b.orders - a.orders || (b.views ?? 0) - (a.views ?? 0));
}

export function creatorHealth(d: Dataset, rows: CreatorRow[]) {
  const active = rows.filter((r) => r.last_post && Date.now() - new Date(r.last_post).getTime() < 7 * 86400000).length;
  const earning = rows.filter((r) => r.earned_cents > 0).length;
  const humans = d.creators.filter((c) => c.type === "PARTNER_HUMAN");
  const withPost = humans.filter((c) => d.posts.some((p) => p.creator_id === c.id)).length;
  return {
    total: rows.length, active, earning,
    pct_earning: rows.length ? earning / rows.length : null,
    activation_rate: humans.length ? withPost / humans.length : null,
  };
}

const STAGE_ORDER = ["NEW", "REPLIED", "SAMPLES_SENT", "APPROVED", "ONBOARDED", "FIRST_POST", "FIRST_SALE"];
export const RECRUIT_STEPS = [
  { key: "leads", label: "Лиды", min: 0 },
  { key: "replied", label: "Ответили", min: 1 },
  { key: "samples", label: "Прислали ролики", min: 2 },
  { key: "approved", label: "Одобрены", min: 3 },
  { key: "onboarded", label: "Онбординг", min: 4 },
  { key: "first_post", label: "Первый пост", min: 5 },
  { key: "first_sale", label: "Первая продажа", min: 6 },
];
export interface RecruitRow { id: string; name: string; ads: number; counts: number[]; cost_cents: number; revenue_cents: number }
export function recruitTable(d: Dataset): RecruitRow[] {
  const orderTotal = new Map(d.orders.map((o) => [o.id, o.total_cents]));
  return d.recruit_sources.map((s) => {
    const leads = d.leads.filter((l) => l.source_id === s.id);
    const counts = RECRUIT_STEPS.map((st) => leads.filter((l) => STAGE_ORDER.indexOf(l.stage) >= st.min || (st.min === 0)).length);
    // REJECTED/GHOSTED leads count only in "Лиды"
    const creators = d.creators.filter((c) => c.lead_id && leads.some((l) => l.id === c.lead_id)).map((c) => c.id);
    const revenue = d.conversions.filter((c) => creators.includes(c.creator_id)).reduce((a, c) => a + (orderTotal.get(c.order_id) ?? 0), 0);
    const ads = d.recruit_ads.filter((a) => a.source_id === s.id);
    const samples = d.costs.filter((c) => c.category === "SAMPLES" && c.ref_id && creators.includes(c.ref_id)).reduce((a, c) => a + c.amount_cents, 0);
    return { id: s.id, name: s.name, ads: ads.length, counts, cost_cents: ads.reduce((a, x) => a + x.cost_cents, 0) + samples, revenue_cents: revenue };
  });
}
