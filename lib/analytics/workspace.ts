// Browser-mode workspace: creators, products/COGS, tracked links, imported Shopify orders, payouts, settings.
// Everything lives in localStorage of this browser (+ JSON backup export/import). Real data, entered by the founder.
import type { Commission, Conversion, Dataset, Order, OrderItem, Platform, Post, PostStats, Refund } from "./model";
import { emptyDataset } from "./model";
import type { Row } from "./csv";

export type PayoutRule = "CPA_FIXED" | "PCT_REVENUE" | "PCT_MARGIN";
export const RULE_LABEL: Record<PayoutRule, string> = { CPA_FIXED: "фикс $ за продажу", PCT_REVENUE: "% от суммы заказа", PCT_MARGIN: "% от маржи" };

export interface WsSettings {
  payout_rule: PayoutRule;
  payout_value: number | null; // USD for CPA_FIXED, fraction (0.15) for PCT_*; null = «задай сумму»
  hold_days: number;
  attribution_window_days: number;
  store_domain: string;
}
export interface WsProduct { id: string; title: string; handle: string; price_cents: number; cogs_cents: number | null; keyword: string }
export interface WsCreator {
  id: string; nick: string; contact: string; handles: { IG: string; TT: string; YT: string };
  promo_code: string; // internal creator id «LIKKY-NICK» (not a Shopify discount code; matched only if a code happens to exist)
  payout_rule: PayoutRule | null; payout_value: number | null; status: "ACTIVE" | "PAUSED"; created_at: string;
}
export interface WsLink {
  code: string; creator_id: string; product_id: string; platform: Platform; keyword: string;
  url: string; short_url: string | null; permalink: string | null; created_at: string;
}
export interface WsOrderItem { title: string; sku: string; qty: number; price_cents: number; product_id: string | null }
export interface WsOrder {
  external_id: string; ordered_at: string; subtotal_cents: number; discount_cents: number; total_cents: number;
  refunded_cents: number; discount_codes: string[]; financial_status: string; utm_content: string | null; ref: string | null;
  utm_campaign?: string | null; creator_hint?: string | null; // from CSV columns utm_campaign / creator
  manual_creator_id?: string | null; // founder's manual choice: creator id, "none" = органика, absent = авто
  items: WsOrderItem[]; imported_at: string;
}
export interface WsPayout { id: string; creator_id: string; commission_ids: string[]; amount_cents: number; paid_at: string; note: string }
export interface Workspace {
  version: 1; settings: WsSettings; products: WsProduct[]; creators: WsCreator[]; links: WsLink[];
  orders: WsOrder[]; post_rows: Row[]; payouts: WsPayout[];
}

export const DEFAULT_PRODUCTS: WsProduct[] = [
  { id: "dragon", title: "Dragon Night Lamp", handle: "study-room-creative-night-light-resin-ornaments", price_cents: 4995, cogs_cents: null, keyword: "DRAGON" },
  { id: "cauldron", title: "Witch Cauldron Lamp", handle: "luminous-witchs-cauldron-lamp-resin-craft", price_cents: 4995, cogs_cents: null, keyword: "BREW" },
  { id: "fire", title: "Fire Dragon Halloween Lamp", handle: "design-a-resin-lantern-as-a-halloween-gift", price_cents: 7995, cogs_cents: null, keyword: "FIRE" },
  { id: "bat", title: "Bat Halloween Lamp", handle: "bat-wing-table-lamp-halloween-resin-ornaments", price_cents: 4995, cogs_cents: null, keyword: "BAT" },
  { id: "baby", title: "Baby Halloween Bat Costume", handle: "new-baby-halloween-long-sleeved-jumpsuit-pumpkin-letter-halloween-baby-jumpsuits-triangle-rompers", price_cents: 3995, cogs_cents: null, keyword: "BABY" },
];

export function defaultWorkspace(): Workspace {
  return {
    version: 1,
    settings: { payout_rule: "CPA_FIXED", payout_value: null, hold_days: 14, attribution_window_days: 7, store_domain: "likky.store" },
    products: DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    creators: [], links: [], orders: [], post_rows: [], payouts: [],
  };
}

const KEY = "vf_ws_v1";
export function loadWorkspace(): Workspace {
  if (typeof window === "undefined") return defaultWorkspace();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultWorkspace();
    return normalize(JSON.parse(raw));
  } catch { return defaultWorkspace(); }
}
export function saveWorkspace(ws: Workspace) { localStorage.setItem(KEY, JSON.stringify(ws)); }
export function hasWorkspaceData(): boolean {
  const ws = loadWorkspace();
  return ws.creators.length + ws.orders.length + ws.links.length + ws.post_rows.length > 0;
}
export function normalize(x: Partial<Workspace>): Workspace {
  const d = defaultWorkspace();
  if (!x || x.version !== 1) throw new Error("Неизвестный формат бэкапа (нужен version: 1)");
  const products = d.products.map((p) => ({ ...p, ...(x.products?.find((q) => q.id === p.id) ?? {}) }));
  for (const q of x.products ?? []) if (!products.some((p) => p.id === q.id)) products.push(q);
  return {
    version: 1, settings: { ...d.settings, ...(x.settings ?? {}) }, products,
    creators: x.creators ?? [], links: x.links ?? [], orders: x.orders ?? [], post_rows: x.post_rows ?? [], payouts: x.payouts ?? [],
  };
}

const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function normalizeNick(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "").split("").map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9_]+/g, "").slice(0, 24);
}
export const promoCodeFor = (nick: string) => `LIKKY-${normalizeNick(nick).toUpperCase().replace(/_/g, "")}`;
export const PLATFORM_SOURCE: Record<Platform, string> = { IG: "instagram", TT: "tiktok", YT: "youtube" };

/** Link-only attribution: straight to the product page, `ref` = tracked link slug (= post code). */
export function buildProductLink(domain: string, handle: string, slug: string, platform: Platform, nick: string): string {
  return `https://${domain}/products/${handle}?ref=${encodeURIComponent(slug)}` +
    `&utm_source=${PLATFORM_SOURCE[platform]}&utm_medium=creator&utm_campaign=${encodeURIComponent(nick)}&utm_content=${encodeURIComponent(slug)}`;
}
export function nextPostCode(ws: { links: WsLink[] }, creator: WsCreator): string {
  let n = ws.links.filter((l) => l.creator_id === creator.id).length + 1;
  while (ws.links.some((l) => l.code === `${creator.nick}-${n}`)) n++;
  return `${creator.nick}-${n}`;
}
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ───────── Shopify orders CSV → WsOrder ─────────
const g = (r: Row, ...keys: string[]) => { for (const k of keys) { const v = r[k.toLowerCase()]; if (v !== undefined && v !== "") return v; } return ""; };
const money = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(/[$€₽]/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : null; };
function parseParams(s: string): URLSearchParams | null {
  if (!s) return null;
  try { return new URL(s, "https://x.invalid").searchParams; } catch { return null; }
}
export function matchProduct(products: WsProduct[], title: string, sku: string): string | null {
  const t = title.toLowerCase();
  let best: WsProduct | null = null;
  for (const p of products) {
    if (sku && sku.toLowerCase() === p.handle) return p.id;
    if (t.includes(p.title.toLowerCase()) && (!best || p.title.length > best.title.length)) best = p;
  }
  return best?.id ?? null;
}

/** Accepts Shopify "Orders → Export" CSV (one row per line item) or our simple template. Upserts by order Name/id. */
export function importOrderRows(ws: Workspace, rows: Row[]): { added: number; updated: number; skipped: number } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const id = g(r, "name", "order_id", "id", "заказ");
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  let added = 0, updated = 0, skipped = rows.length ? 0 : 0;
  groups.forEach((rs, ext) => {
    const h = rs[0];
    const items: WsOrderItem[] = rs.map((r) => {
      const title = g(r, "lineitem name", "product", "товар");
      const sku = g(r, "lineitem sku", "sku");
      return { title, sku, qty: Number(g(r, "lineitem quantity", "qty", "quantity") || 1), price_cents: money(g(r, "lineitem price", "price")) ?? 0, product_id: matchProduct(ws.products, title, sku) };
    }).filter((i) => i.title || i.price_cents);
    const subtotal = money(g(h, "subtotal", "сумма")) ?? items.reduce((a, i) => a + i.price_cents * i.qty, 0);
    const discount = money(g(h, "discount amount", "discount", "скидка")) ?? 0;
    const total = money(g(h, "total", "итого")) ?? subtotal - discount;
    const codes = g(h, "discount code", "discount_code", "promo", "промокод").split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    const landing = parseParams(g(h, "landing site", "landing_site", "landing"));
    const notes = g(h, "note attributes", "note_attributes");
    const noteRef = notes.match(/(?:^|[\s,;])_?(?:vf_)?ref\s*[:=]\s*([A-Za-z0-9_-]+)/i)?.[1] ?? null;
    const dateRaw = g(h, "paid at", "created at", "ordered_at", "date", "дата");
    const t = Date.parse(dateRaw.replace(/ ([+-]\d{4})$/, "$1"));
    if (!Number.isFinite(t)) { skipped++; return; }
    const order: WsOrder = {
      external_id: ext, ordered_at: new Date(t).toISOString(), subtotal_cents: subtotal, discount_cents: discount, total_cents: total,
      refunded_cents: money(g(h, "refunded amount", "refunded", "возврат")) ?? 0, discount_codes: codes,
      financial_status: g(h, "financial status", "status").toLowerCase() || "paid",
      utm_content: g(h, "utm_content") || landing?.get("utm_content") || null,
      ref: g(h, "ref", "vf_ref") || landing?.get("ref") || noteRef || null,
      utm_campaign: g(h, "utm_campaign") || landing?.get("utm_campaign") || null,
      creator_hint: g(h, "creator", "креатор", "creator_nick") || null,
      items, imported_at: new Date().toISOString(),
    };
    const i = ws.orders.findIndex((o) => o.external_id === ext);
    if (i >= 0) { if (ws.orders[i].manual_creator_id !== undefined) order.manual_creator_id = ws.orders[i].manual_creator_id; ws.orders[i] = order; updated++; } else { ws.orders.push(order); added++; }
  });
  return { added, updated, skipped };
}

// ───────── Attribution + accruals (browser mode) ─────────
export interface Accrual {
  id: string; order: WsOrder; creator_id: string | null; link_code: string | null; method: "LINK" | "MANUAL" | "PROMO" | null;
  how: string; // human-readable: how the order got attributed
  amount_cents: number | null; status: "HELD" | "APPROVED" | "PAID" | "VOID" | null; hold_until: string | null; payout_id: string | null;
  reason: string | null; // why amount is unknown
}

export function ruleFor(ws: Workspace, c: WsCreator): { rule: PayoutRule; value: number | null } {
  return c.payout_rule ? { rule: c.payout_rule, value: c.payout_value } : { rule: ws.settings.payout_rule, value: ws.settings.payout_value };
}

export function computeAccruals(ws: Workspace, now = Date.now()): Accrual[] {
  const byCode = new Map(ws.creators.map((c) => [c.promo_code.toUpperCase(), c]));
  const byNick = new Map(ws.creators.map((c) => [c.nick, c]));
  const byId = new Map(ws.creators.map((c) => [c.id, c]));
  const linkByCode = new Map(ws.links.map((l) => [l.code.toLowerCase(), l]));
  const paidBy = new Map<string, string>();
  ws.payouts.forEach((p) => p.commission_ids.forEach((id) => paidBy.set(id, p.id)));
  const products = new Map(ws.products.map((p) => [p.id, p]));
  return ws.orders.map((o) => {
    const id = `cm_${o.external_id}`;
    let creator: WsCreator | undefined;
    let method: Accrual["method"] = null;
    let link: WsLink | undefined;
    let how = "органика";
    // Priority: manual → ref/utm_content (tracked link) → CSV column creator → utm_campaign (nick) → discount code (optional fallback)
    if (o.manual_creator_id) {
      if (o.manual_creator_id !== "none") { creator = byId.get(o.manual_creator_id); if (creator) { method = "MANUAL"; how = "вручную"; } }
    } else {
      for (const tok of [o.ref, o.utm_content]) {
        const l = tok ? linkByCode.get(tok.toLowerCase()) : undefined;
        if (l) { link = l; creator = byId.get(l.creator_id); method = "LINK"; how = `ссылка ${l.code}`; break; }
      }
      const hint = o.creator_hint ? o.creator_hint.trim() : "";
      if (!creator && hint) {
        const l = linkByCode.get(hint.toLowerCase());
        creator = l ? byId.get(l.creator_id) : byNick.get(normalizeNick(hint)) ?? byCode.get(hint.toUpperCase());
        if (l && creator) link = l;
        if (creator) { method = "MANUAL"; how = `колонка creator`; }
      }
      if (!creator && o.utm_campaign) { creator = byNick.get(normalizeNick(o.utm_campaign)); if (creator) { method = "LINK"; how = `utm_campaign ${o.utm_campaign}`; } }
      if (!creator) for (const code of o.discount_codes) { const c = byCode.get(code.toUpperCase()); if (c) { creator = c; method = "PROMO"; how = `код ${code}`; break; } }
    }
    const base = { id, order: o, link_code: link?.code ?? null, payout_id: null as string | null, how };
    if (!creator) return { ...base, creator_id: null, method: null, amount_cents: null, status: null, hold_until: null, reason: o.manual_creator_id === "none" ? "органика (вручную)" : "органика: нет метки креатора (ref / колонка creator) — выберите креатора вручную" };
    const { rule, value } = ruleFor(ws, creator);
    const net = Math.max(0, o.total_cents - o.refunded_cents);
    const voided = o.refunded_cents >= o.total_cents && o.total_cents > 0 || ["refunded", "voided"].includes(o.financial_status);
    let amount: number | null = null; let reason: string | null = null;
    if (value === null || value === undefined) reason = "задай сумму/процент выплаты в Настройках";
    else if (rule === "CPA_FIXED") amount = voided ? 0 : Math.round(value * 100);
    else if (rule === "PCT_REVENUE") amount = Math.round(net * value);
    else {
      const missing = o.items.some((i) => !i.product_id || products.get(i.product_id)?.cogs_cents == null) || !o.items.length;
      if (missing) reason = "нет COGS по товару — задай в Настройках";
      else {
        const cogs = o.items.reduce((a, i) => a + (products.get(i.product_id!)!.cogs_cents ?? 0) * i.qty, 0);
        const share = o.total_cents ? net / o.total_cents : 0;
        amount = Math.round(Math.max(0, net - cogs * share) * value);
      }
    }
    const holdUntil = new Date(new Date(o.ordered_at).getTime() + ws.settings.hold_days * 86400000).toISOString();
    const payoutId = paidBy.get(id) ?? null;
    const status: Accrual["status"] = payoutId ? "PAID" : voided ? "VOID" : new Date(holdUntil).getTime() > now ? "HELD" : "APPROVED";
    return { ...base, creator_id: creator.id, method, amount_cents: amount, status, hold_until: holdUntil, payout_id: payoutId, reason };
  });
}

// ───────── Workspace → Dataset (feeds the analytics tabs) ─────────
const num = (v: string | undefined) => { if (v === undefined || v === "") return null; const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

export function workspaceToDataset(ws: Workspace, label = "Мои CSV · браузер (реальные, введены вами)"): Dataset {
  const d = emptyDataset("IMPORT", label);
  d.products = ws.products.map((p) => ({ id: p.id, title: p.title, price_cents: p.price_cents, cogs_cents: p.cogs_cents }));
  d.creators = ws.creators.map((c) => ({ id: c.id, lead_id: null, type: "PARTNER_HUMAN", display_name: "@" + c.nick, status: c.status, activated_at: c.created_at, promo_code: c.promo_code }));
  const formulaIds = new Map<string, string>();
  const postByKey = new Map<string, Post>();
  for (const l of ws.links) {
    const p: Post = { id: l.code, asset_id: null, creator_id: l.creator_id, platform: l.platform, permalink: l.permalink ?? l.url, posted_at: l.created_at, formula_id: null };
    d.posts.push(p); postByKey.set(l.code.toLowerCase(), p); if (l.permalink) postByKey.set(l.permalink, p);
  }
  ws.post_rows.forEach((r, i) => {
    const key = (r["post_id"] || r["utm_content"] || "").toLowerCase();
    const url = r["post_url"] || r["permalink"] || r["url"] || "";
    let post = postByKey.get(key) ?? postByKey.get(url);
    if (!post) {
      const nick = normalizeNick(r["creator"] || r["handle"] || "");
      const c = ws.creators.find((x) => x.nick === nick);
      if (!c && !url) return;
      let creatorId = c?.id;
      if (!creatorId) { creatorId = `ext_${nick || "unknown"}`; if (!d.creators.some((x) => x.id === creatorId)) d.creators.push({ id: creatorId, lead_id: null, type: "PARTNER_HUMAN", display_name: "@" + (nick || "unknown") + " (нет в списке)", status: "ACTIVE", activated_at: null, promo_code: null }); }
      const plat = (r["platform"] || "IG").toUpperCase();
      post = { id: `csv_${i}`, asset_id: null, creator_id: creatorId, platform: plat.startsWith("T") ? "TT" : plat.startsWith("Y") ? "YT" : "IG", permalink: url, posted_at: r["posted_at"] ? new Date(r["posted_at"]).toISOString() : new Date().toISOString(), formula_id: null };
      d.posts.push(post);
    }
    const f = r["formula"];
    if (f) { if (!formulaIds.has(f)) { const id = `f_${formulaIds.size + 1}`; formulaIds.set(f, id); d.formulas.push({ id, trend_id: null, name: f, cta_keyword: null }); } post.formula_id = formulaIds.get(f)!; }
    const st: PostStats = { post_id: post.id, views: num(r["views"] ?? r["plays"]), likes: num(r["likes"]), comments: num(r["comments"]), shares: num(r["shares"]), saves: num(r["saves"]), keyword_comments: num(r["keyword_comments"]), dm_sent: num(r["dm_sent"]), clicks: num(r["clicks"]), sessions: num(r["sessions"]) };
    d.post_stats = d.post_stats.filter((s) => s.post_id !== post!.id).concat(st);
  });
  const acc = computeAccruals(ws);
  const products = new Map(ws.products.map((p) => [p.id, p]));
  for (const a of acc) {
    const o = a.order;
    const id = `o_${o.external_id}`;
    const order: Order = { id, external_id: o.external_id, ordered_at: o.ordered_at, subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, total_cents: o.total_cents, discount_codes: o.discount_codes, is_sandbox: false };
    d.orders.push(order);
    o.items.forEach((it) => d.order_items.push({ order_id: id, product_id: it.product_id, title: it.title, qty: it.qty, price_cents: it.price_cents, cogs_cents: it.product_id ? products.get(it.product_id)?.cogs_cents ?? null : null } as OrderItem));
    if (o.refunded_cents > 0) d.refunds.push({ order_id: id, amount_cents: o.refunded_cents, created_at: o.ordered_at, type: "REFUND" } as Refund);
    if (!a.creator_id) continue;
    d.conversions.push({ order_id: id, creator_id: a.creator_id, post_id: a.link_code, offer_id: null, method: a.method ?? "MANUAL" } as Conversion);
    d.commissions.push({ id: a.id, conversion_order_id: id, creator_id: a.creator_id, kind: "CPA", amount_cents: a.amount_cents ?? 0, status: a.status ?? "HELD", payout_id: a.payout_id, hold_until: a.hold_until, needs_amount: a.amount_cents === null, note: a.reason } as Commission);
  }
  d.payouts = ws.payouts.map((p) => ({ id: p.id, creator_id: p.creator_id, amount_cents: p.amount_cents, status: "PAID", paid_at: p.paid_at, method: p.note || "—" }));
  const needs = acc.filter((a) => a.creator_id && a.amount_cents === null).length;
  if (needs) d.meta.warnings.push(`${needs} начислений без суммы: ${ws.settings.payout_value === null ? "правило выплаты не задано («задай сумму» в Настройках)" : "не хватает COGS"}.`);
  if (!ws.creators.length && !ws.orders.length) d.meta.warnings.push("Пока пусто. Начните с вкладки «Креаторы» → добавьте креатора, затем «Ссылки» и «Заказы / импорт».");
  d.meta.warnings.push("Найм, тренды и расходы в браузерном режиме не ведутся: эти блоки заполнятся в режиме «База» (Supabase).");
  return d;
}
