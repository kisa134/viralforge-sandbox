// DemoDataSource — СГЕНЕРИРОВАННЫЕ ПРИМЕРНЫЕ ДАННЫЕ. Не реальные цифры Likky / ViralForge.
// Детерминированный seed: одинаковые «примерные» числа при каждом открытии (даты — относительно сегодня).
// Реальные здесь только названия и публичные цены SKU с likky.store; COGS, просмотры, заказы, выплаты — выдуманы.
import type {
  Asset, CostItem, Creator, CreatorLead, DataSource, Dataset, LeadStage, Platform, Post, PostStats,
} from "./model";
import { emptyDataset } from "./model";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;

export function generateDemo(now = Date.now()): Dataset {
  const r = rng(20261008);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const int = (a: number, b: number) => Math.floor(between(a, b + 1));
  const poisson = (lambda: number) => {
    // Knuth for small lambda, normal approx for big
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r() + r() + r() - 1.5) * 2));
    const L = Math.exp(-lambda); let k = 0; let p = 1;
    do { k++; p *= r(); } while (p > L);
    return k - 1;
  };
  const iso = (t: number) => new Date(t).toISOString();

  const d = emptyDataset("DEMO", "DEMO · сгенерированные примерные данные (не реальные)");
  d.meta.warnings.push("Все числа на этой вкладке — сгенерированный пример для показа логики. Это не продажи Likky.");

  // Products: public titles/prices from likky.store; COGS = demo.
  const sku: [string, string, number][] = [
    ["p_dragon", "Dragon Night Lamp", 4995],
    ["p_fire", "Fire Dragon Halloween Lamp", 7995],
    ["p_cauldron", "Witch Cauldron Lamp", 4995],
    ["p_bat", "Bat Halloween Lamp", 4995],
    ["p_baby", "Baby Halloween Bat Costume", 3995],
  ];
  for (const [id, title, price] of sku) {
    d.products.push({ id, title, price_cents: price, cogs_cents: Math.round(price * between(0.25, 0.4)) });
    d.offers.push({ id: "o_" + id.slice(2), product_id: id, name: title, payout_rule: "PCT_MARGIN", payout_value: 0.15, hold_days: 14 });
  }
  const offerWeights = [0.45, 0.15, 0.17, 0.15, 0.08];
  const pickOffer = () => { let x = r(); for (let i = 0; i < offerWeights.length; i++) { x -= offerWeights[i]; if (x <= 0) return d.offers[i]; } return d.offers[0]; };

  d.trends.push(
    { id: "t_maker", name: "Maker «don't scroll»", niche_bucket: "LIKE_LIKKY_resin" },
    { id: "t_gift", name: "Gift for guys / friends obsessed", niche_bucket: "ADJACENT_gadget" },
    { id: "t_question", name: "Would you put this / too much?", niche_bucket: "ADJACENT_hook" },
    { id: "t_halloween", name: "Halloween cozy-horror", niche_bucket: "SEASONAL" },
  );
  const formulaSpec: [string, string, string, string, number][] = [
    ["fc_maker", "t_maker", "Maker don't-scroll", "GLOW", 1.6],
    ["fc_gift", "t_gift", "Gift-for-guys unbox", "GIFT", 1.2],
    ["fc_wyp", "t_question", "Would you put + BUY2", "DRAGON", 1.0],
    ["fc_keep", "t_question", "Keep or trash", "KEEP", 0.8],
    ["fc_desk", "t_gift", "Desk / gaming flex", "SETUP", 0.7],
    ["fc_witch", "t_halloween", "Witch / bat Halloween", "BREW", 0.9],
  ];
  const formulaMult: Record<string, number> = {};
  for (const [id, trend, name, kw, mult] of formulaSpec) {
    d.formulas.push({ id, trend_id: trend, name, cta_keyword: kw });
    formulaMult[id] = mult;
    for (let i = 1; i <= 3; i++) d.scenarios.push({ id: `${id}_s${i}`, formula_id: id, offer_id: pickOffer().id, mode: i === 1 ? "AI" : "HUMAN" });
  }

  // Recruiting: 4 example TG chats
  const sources: [string, string, number][] = [
    ["rs_freelance", "TG: фриланс-видео чат (пример)", 1.0],
    ["rs_ugc", "TG: UGC-креаторы чат (пример)", 1.5],
    ["rs_montage", "TG: монтажёры чат (пример)", 0.7],
    ["rs_ref", "Рефералы креаторов (пример)", 0.5],
  ];
  const quality: Record<string, number> = {};
  for (const [id, name, q] of sources) {
    d.recruit_sources.push({ id, name, type: id === "rs_ref" ? "REFERRAL" : "TG_CHAT" });
    quality[id] = q;
  }
  let leadSeq = 0;
  for (const [sid] of sources) {
    const nAds = sid === "rs_ref" ? 1 : int(2, 4);
    for (let a = 0; a < nAds; a++) {
      const adId = `ra_${sid}_${a}`;
      const posted = now - int(3, 30) * DAY;
      d.recruit_ads.push({ id: adId, source_id: sid, variant: a % 2 ? "B" : "A", posted_at: iso(posted), cost_cents: 0 });
      const nLeads = int(6, 18);
      for (let l = 0; l < nLeads; l++) {
        const q = quality[sid];
        const stages: LeadStage[] = ["NEW", "REPLIED", "SAMPLES_SENT", "APPROVED", "ONBOARDED", "FIRST_POST", "FIRST_SALE"];
        const pass = [0.85, 0.6, 0.55 * Math.min(1.3, q), 0.8, 0.65, 0.45 * Math.min(1.4, q)];
        let s = 0;
        while (s < pass.length && r() < pass[s]) s++;
        let stage: LeadStage = stages[s];
        if (s < 4 && r() < 0.5) stage = s <= 1 ? "GHOSTED" : "REJECTED";
        d.leads.push({ id: `l_${++leadSeq}`, recruit_ad_id: adId, source_id: sid, stage, created_at: iso(posted + between(0, 2) * DAY) });
      }
    }
  }

  // Creators = onboarded leads + 2 internal AI accounts
  const nicks = ["mira", "lena", "kate", "dasha", "ann", "vika", "sonya", "ira", "masha", "nastya", "oleg", "max", "tim", "liza", "yana", "alina", "vlad", "zhenya", "polina", "kira", "roma", "nika", "artem", "eva", "gleb", "uma", "dina", "lev", "ruslan", "sasha"];
  let ni = 0;
  for (const l of d.leads) {
    if (!["ONBOARDED", "FIRST_POST", "FIRST_SALE"].includes(l.stage)) continue;
    const nick = nicks[ni++ % nicks.length] + (ni > nicks.length ? ni : "");
    const act = new Date(l.created_at).getTime() + int(1, 4) * DAY;
    d.creators.push({ id: `c_${nick}`, lead_id: l.id, type: "PARTNER_HUMAN", display_name: `@${nick} (пример)`, status: "ACTIVE", activated_at: iso(Math.min(act, now)), promo_code: `LIKKY-${nick.toUpperCase()}` });
  }
  for (const n of ["vex", "glowlab"]) d.creators.push({ id: `c_ai_${n}`, lead_id: null, type: "INTERNAL_AI", display_name: `@${n}.ai (наш AI, пример)`, status: "ACTIVE", activated_at: iso(now - 28 * DAY), promo_code: `LIKKY-${n.toUpperCase()}` });

  // Posts, stats, orders
  const platforms: Platform[] = ["IG", "TT", "YT"];
  let postSeq = 0, orderSeq = 0, assetSeq = 0;
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  for (const c of d.creators) {
    const skill = Math.exp((r() - 0.5) * 1.6); // creator talent multiplier
    const firstSaleLead = c.lead_id ? leadById.get(c.lead_id)?.stage : "FIRST_SALE";
    const isOnlyOnboarded = firstSaleLead === "ONBOARDED";
    const start = new Date(c.activated_at!).getTime();
    const postsPerDay = c.type === "INTERNAL_AI" ? 2 : isOnlyOnboarded ? 0 : between(0.3, 1.8);
    const churnAt = r() < 0.25 ? start + between(4, 14) * DAY : Infinity;
    for (let t = start; t < Math.min(now, churnAt); t += DAY) {
      const n = poisson(postsPerDay);
      for (let k = 0; k < n; k++) {
        const sc = pick(d.scenarios);
        const aiAsset = c.type === "INTERNAL_AI" || sc.mode === "AI";
        const asset: Asset = { id: `a_${++assetSeq}`, scenario_id: sc.id, creator_id: c.id, source: aiAsset ? "AI_HIGGSFIELD" : "HUMAN", qc_verdict: r() < 0.84 ? "PASS" : r() < 0.6 ? "FIX" : "KILL" };
        d.assets.push(asset);
        if (aiAsset) d.costs.push({ category: "HIGGSFIELD", amount_cents: int(100, 400), incurred_at: iso(t), ref_type: "ASSET", ref_id: asset.id });
        if (asset.qc_verdict !== "PASS") continue; // FIX/KILL не постятся
        const posted = t + between(0, 1) * DAY;
        if (posted > now) continue;
        const post: Post = { id: `po_${++postSeq}`, asset_id: asset.id, creator_id: c.id, platform: pick(platforms), permalink: `https://example.com/demo-post/${postSeq}`, posted_at: iso(posted), formula_id: sc.formula_id };
        d.posts.push(post);
        const ageDays = (now - posted) / DAY;
        const mature = Math.min(1, 0.35 + ageDays / 5);
        const views = Math.round(Math.exp(8.4 + (r() + r() + r() - 1.5) * 2.0) * formulaMult[sc.formula_id!] * skill * mature);
        const kw = Math.round(views * between(0.001, 0.004));
        const dm = Math.round(kw * between(0.55, 0.9));
        const clicks = Math.round(dm * between(0.45, 0.7) + views * between(0.00005, 0.0002));
        const sessions = Math.round(clicks * between(0.75, 0.92));
        const stats: PostStats = { post_id: post.id, views, likes: Math.round(views * between(0.02, 0.07)), comments: Math.round(kw * between(1.2, 2.5)), shares: Math.round(views * between(0.002, 0.012)), saves: post.platform === "IG" ? null : Math.round(views * between(0.002, 0.01)), keyword_comments: kw, dm_sent: dm, clicks, sessions };
        d.post_stats.push(stats);
        const nOrders = poisson(sessions * between(0.02, 0.045));
        const offer = d.offers.find((o) => o.id === sc.offer_id) ?? d.offers[0];
        const prod = d.products.find((p) => p.id === offer.product_id)!;
        for (let o = 0; o < nOrders; o++) {
          const ot = posted + between(0.05, Math.min(6, Math.max(0.1, ageDays))) * DAY;
          if (ot > now) continue;
          const qty = r() < 0.18 ? 2 : 1;
          const usePromo = r() < 0.55;
          const discount = usePromo ? Math.round(prod.price_cents * qty * 0.1) : 0;
          const sub = prod.price_cents * qty;
          const id = `or_${++orderSeq}`;
          d.orders.push({ id, external_id: `#D${1000 + orderSeq}`, ordered_at: iso(ot), subtotal_cents: sub, discount_cents: discount, total_cents: sub - discount, discount_codes: usePromo ? [c.promo_code!] : [], is_sandbox: true });
          d.order_items.push({ order_id: id, product_id: prod.id, title: prod.title, qty, price_cents: prod.price_cents, cogs_cents: prod.cogs_cents });
          d.conversions.push({ order_id: id, creator_id: c.id, post_id: post.id, offer_id: offer.id, method: usePromo ? "PROMO" : r() < 0.85 ? "LINK" : "PIXEL" });
          const refunded = r() < 0.05;
          if (refunded) d.refunds.push({ order_id: id, amount_cents: sub - discount, created_at: iso(Math.min(now, ot + between(1, 10) * DAY)), type: "REFUND" });
          const margin = sub - discount - (prod.cogs_cents ?? 0) * qty;
          const amount = Math.round(Math.max(0, margin) * offer.payout_value);
          const age = (now - ot) / DAY;
          d.commissions.push({ id: `cm_${id}`, conversion_order_id: id, creator_id: c.id, kind: "CPA", amount_cents: amount, status: refunded ? "VOID" : age < offer.hold_days ? "HELD" : "APPROVED", payout_id: null });
        }
      }
    }
    if (c.type === "PARTNER_HUMAN") d.costs.push({ category: "SAMPLES", amount_cents: int(2500, 4500), incurred_at: c.activated_at!, ref_type: "CREATOR", ref_id: c.id });
  }
  // Organic (unattributed) orders — no creator credit
  for (let t = now - 30 * DAY; t < now; t += DAY) {
    const n = poisson(0.5);
    for (let k = 0; k < n; k++) {
      const prod = pick(d.products);
      const id = `or_${++orderSeq}`;
      d.orders.push({ id, external_id: `#D${1000 + orderSeq}`, ordered_at: iso(t + between(0, 1) * DAY), subtotal_cents: prod.price_cents, discount_cents: 0, total_cents: prod.price_cents, discount_codes: [], is_sandbox: true });
      d.order_items.push({ order_id: id, product_id: prod.id, title: prod.title, qty: 1, price_cents: prod.price_cents, cogs_cents: prod.cogs_cents });
    }
  }
  // Weekly payouts: APPROVED older than 17 days → PAID in a past Friday payout
  const byCreator = new Map<string, number>();
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  for (const cm of d.commissions) {
    const ord = cm.conversion_order_id ? orderById.get(cm.conversion_order_id) : undefined;
    if (cm.status === "APPROVED" && ord && now - new Date(ord.ordered_at).getTime() > 17 * DAY) {
      cm.status = "PAID"; cm.payout_id = `py_${cm.creator_id}`;
      byCreator.set(cm.creator_id, (byCreator.get(cm.creator_id) ?? 0) + cm.amount_cents);
    }
  }
  byCreator.forEach((amt, cid) => d.payouts.push({ id: `py_${cid}`, creator_id: cid, amount_cents: amt, status: "PAID", paid_at: iso(now - int(1, 3) * DAY), method: pick(["CARD_RU", "USDT"]) }));
  for (let t = now - 30 * DAY; t < now; t += DAY) d.costs.push({ category: "APIFY", amount_cents: int(40, 180), incurred_at: iso(t), ref_type: "TREND", ref_id: null });
  return d;
}

export class DemoDataSource implements DataSource {
  id = "DEMO" as const;
  label = "DEMO (пример)";
  isDemo = true;
  async load() { return generateDemo(); }
}

// keep types referenced for isolatedModules builds
export type { Creator, CreatorLead, CostItem };
