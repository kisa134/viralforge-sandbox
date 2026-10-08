// In-browser CSV import (orders + posts). Raw rows live in localStorage; nothing leaves the browser.
import type { Commission, Conversion, Dataset, Order, OrderItem, Platform, PostStats, Refund } from "./model";
import { emptyDataset } from "./model";

export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  const src = text.replace(/^\uFEFF/, "");
  const delim = (src.split("\n")[0].match(/;/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((c) => c.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c.trim() !== "")) rows.push(cur);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const get = (row: Row, ...keys: string[]) => {
  for (const k of keys) { const v = row[k.toLowerCase()]; if (v !== undefined && v !== "") return v; }
  return "";
};
const num = (v: string): number | null => {
  if (!v) return null;
  const n = Number(v.replace(/\s/g, "").replace(/[$₽€]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const cents = (v: string) => { const n = num(v); return n === null ? null : Math.round(n * 100); };
const date = (v: string) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); };
const slug = (s: string) => s.toLowerCase().replace(/^@/, "").replace(/^likky-/, "").replace(/[^a-z0-9а-я_.]+/gi, "");

export interface ImportSettings {
  payout_rule: "PCT_MARGIN" | "PCT_REVENUE" | "CPA_FIXED";
  payout_value: number; // 0.15 for 15%, or USD for CPA_FIXED
  hold_days: number;
}
export const DEFAULT_SETTINGS: ImportSettings = { payout_rule: "PCT_MARGIN", payout_value: 0.15, hold_days: 14 };

export const ORDERS_TEMPLATE =
  "order_id,ordered_at,subtotal,discount,total,discount_code,creator,post_url,refunded,cogs,product\n" +
  "#1001,2026-10-08 14:20,49.95,5.00,44.95,LIKKY-MIRA,mira,https://instagram.com/reel/XXXX,0,[COGS],Dragon Night Lamp\n";
export const POSTS_TEMPLATE =
  "post_url,platform,creator,posted_at,views,likes,comments,shares,saves,keyword_comments,dm_sent,clicks,formula\n" +
  "https://instagram.com/reel/XXXX,IG,mira,2026-10-07,12000,600,80,40,,25,20,14,Maker don't-scroll\n";

/** Builds a Dataset from imported CSV rows. Supports our template and the standard Shopify orders export. */
export function buildImportDataset(orderRows: Row[], postRows: Row[], s: ImportSettings, now = Date.now()): Dataset {
  const d = emptyDataset("IMPORT", "Мои данные · импорт CSV (реальные, из вашего файла)");
  const creatorIds = new Map<string, string>();
  const creator = (raw: string) => {
    const key = slug(raw);
    if (!key) return null;
    if (!creatorIds.has(key)) {
      const id = `c_${key}`;
      creatorIds.set(key, id);
      d.creators.push({ id, lead_id: null, type: "PARTNER_HUMAN", display_name: "@" + key, status: "ACTIVE", activated_at: null, promo_code: `LIKKY-${key.toUpperCase()}` });
    }
    return creatorIds.get(key)!;
  };
  const formulaIds = new Map<string, string>();
  const postByUrl = new Map<string, string>();

  postRows.forEach((r, i) => {
    const url = get(r, "post_url", "permalink", "url", "link");
    const cId = creator(get(r, "creator", "handle", "account", "креатор"));
    if (!url || !cId) return;
    const fname = get(r, "formula", "формула", "pattern");
    let fId: string | null = null;
    if (fname) {
      if (!formulaIds.has(fname)) { const id = `f_${formulaIds.size + 1}`; formulaIds.set(fname, id); d.formulas.push({ id, trend_id: null, name: fname, cta_keyword: null }); }
      fId = formulaIds.get(fname)!;
    }
    const id = `p_${i + 1}`;
    postByUrl.set(url, id);
    const plat = get(r, "platform", "платформа").toUpperCase();
    const platform: Platform = plat.startsWith("T") ? "TT" : plat.startsWith("Y") ? "YT" : "IG";
    d.posts.push({ id, asset_id: null, creator_id: cId, platform, permalink: url, posted_at: date(get(r, "posted_at", "date", "дата")), formula_id: fId });
    const n = (k: string, ...alt: string[]) => num(get(r, k, ...alt));
    const st: PostStats = { post_id: id, views: n("views", "plays", "просмотры"), likes: n("likes"), comments: n("comments"), shares: n("shares"), saves: n("saves"), keyword_comments: n("keyword_comments"), dm_sent: n("dm_sent", "dm"), clicks: n("clicks", "клики"), sessions: n("sessions") };
    d.post_stats.push(st);
  });

  // Group order rows (Shopify export = one row per line item; first row carries totals)
  const groups = new Map<string, Row[]>();
  for (const r of orderRows) {
    const id = get(r, "order_id", "name", "id", "заказ");
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  let missingCogs = 0, unattributed = 0;
  groups.forEach((rows, ext) => {
    const h = rows[0];
    const id = `o_${ext.replace(/[^a-z0-9]/gi, "")}`;
    const items: OrderItem[] = rows.map((r) => {
      const qty = num(get(r, "lineitem quantity", "qty", "quantity")) ?? 1;
      return { order_id: id, product_id: null, title: get(r, "lineitem name", "product", "товар") || null, qty, price_cents: cents(get(r, "lineitem price", "price")) ?? 0, cogs_cents: null };
    });
    const subtotal = cents(get(h, "subtotal", "сумма")) ?? items.reduce((a, it) => a + it.price_cents * it.qty, 0);
    const discount = cents(get(h, "discount amount", "discount", "скидка")) ?? 0;
    const total = cents(get(h, "total", "итого")) ?? subtotal - discount;
    const code = get(h, "discount code", "discount_code", "promo", "промокод");
    const order: Order = { id, external_id: ext, ordered_at: date(get(h, "ordered_at", "paid at", "created at", "date", "дата")), subtotal_cents: subtotal, discount_cents: discount, total_cents: total, discount_codes: code ? [code] : [], is_sandbox: false };
    // order-level COGS (template column) — spread onto first item
    const cogs = cents(get(h, "cogs", "себестоимость"));
    if (cogs !== null) items[0].cogs_cents = Math.round(cogs / (items[0].qty || 1));
    else missingCogs++;
    d.orders.push(order);
    d.order_items.push(...items);
    const refunded = cents(get(h, "refunded amount", "refunded", "возврат")) ?? 0;
    if (refunded > 0) d.refunds.push({ order_id: id, amount_cents: refunded, created_at: order.ordered_at, type: "REFUND" } as Refund);

    const postUrl = get(h, "post_url", "permalink");
    const creatorRaw = get(h, "creator", "креатор") || (code ? code : "");
    const cId = creatorRaw ? creator(creatorRaw) : null;
    if (!cId) { unattributed++; return; }
    const postId = postUrl ? postByUrl.get(postUrl) ?? null : null;
    const conv: Conversion = { order_id: id, creator_id: cId, post_id: postId, offer_id: null, method: code ? "PROMO" : postUrl ? "LINK" : "MANUAL" };
    d.conversions.push(conv);
    const net = total - refunded;
    let amount: number | null;
    if (s.payout_rule === "CPA_FIXED") amount = refunded >= total ? 0 : Math.round(s.payout_value * 100);
    else if (s.payout_rule === "PCT_REVENUE") amount = Math.round(Math.max(0, net) * s.payout_value);
    else amount = cogs === null ? null : Math.round(Math.max(0, net - cogs) * s.payout_value);
    if (amount === null) return; // margin unknown → no commission computed
    const age = (now - new Date(order.ordered_at).getTime()) / 86400000;
    const cm: Commission = { id: `cm_${id}`, conversion_order_id: id, creator_id: cId, kind: "CPA", amount_cents: amount, status: refunded >= total ? "VOID" : age < s.hold_days ? "HELD" : "APPROVED", payout_id: null };
    d.commissions.push(cm);
  });
  if (orderRows.length && missingCogs) d.meta.warnings.push(`У ${missingCogs} заказов нет колонки cogs: маржа и начисления «от маржи» по ним не считаются.`);
  if (unattributed) d.meta.warnings.push(`${unattributed} заказов без креатора/промокода — считаются органикой.`);
  if (!orderRows.length && !postRows.length) d.meta.warnings.push("Пока ничего не импортировано. Загрузите CSV заказов и/или постов ниже.");
  d.meta.warnings.push("Найм, тренды, расходы и выплаты в CSV-режиме не импортируются (только заказы и посты) — эти блоки пустые.");
  return d;
}

const LS = { orders: "vf_an_orders_rows", posts: "vf_an_posts_rows", settings: "vf_an_settings" };
export const store = {
  loadRows(kind: "orders" | "posts"): Row[] {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(LS[kind]) || "[]"); } catch { return []; }
  },
  saveRows(kind: "orders" | "posts", rows: Row[]) { localStorage.setItem(LS[kind], JSON.stringify(rows)); },
  clear(kind: "orders" | "posts") { localStorage.removeItem(LS[kind]); },
  loadSettings(): ImportSettings {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS.settings) || "{}") }; } catch { return DEFAULT_SETTINGS; }
  },
  saveSettings(s: ImportSettings) { localStorage.setItem(LS.settings, JSON.stringify(s)); },
};

export class CsvImportDataSource {
  id = "IMPORT" as const;
  label = "Мои CSV";
  isDemo = false;
  async load() { return buildImportDataset(store.loadRows("orders"), store.loadRows("posts"), store.loadSettings()); }
}
