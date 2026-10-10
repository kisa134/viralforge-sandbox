// Shopify webhooks → orders / refunds / attribution / commissions.
// POST /functions/v1/shopify-orders-webhook   (verify_jwt = false; authenticity = X-Shopify-Hmac-Sha256)
// Attribution is link-only (ref from landing_site / note_attributes); Shopify discount codes are NOT required.
// Topics: orders/create, orders/paid, orders/updated, orders/cancelled, refunds/create.
// Signing key: env SHOPIFY_WEBHOOK_SECRET, else Supabase Vault "shopify_webhook_secret" (via service-role-only RPC get_app_secret).
// Until one of them is set, EVERY request is rejected with 401.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type R = Record<string, any>;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
// Secrets: env first, then Vault (cached per isolate). Values are never logged.
const secretCache = new Map<string, string | null>();
async function appSecret(envName: string, vaultName: string): Promise<string | null> {
  const env = Deno.env.get(envName);
  if (env) return env;
  if (secretCache.has(vaultName)) return secretCache.get(vaultName)!;
  const { data, error } = await db.rpc("get_app_secret", { p_name: vaultName });
  if (error) { console.error("secret lookup failed", vaultName); return null; }
  const v = typeof data === "string" && data ? data : null;
  secretCache.set(vaultName, v);
  return v;
}
let SALT = "vf";

const json = (status: number, body: R) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function hmacBase64(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cents = (v: unknown) => Math.round(parseFloat(String(v ?? "0")) * 100) || 0;

function unwrap<T>(r: { data: T; error: { message: string } | null }, ctx: string): T {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
}

function mapStatus(o: R): string {
  const fs = String(o.financial_status ?? "").toLowerCase();
  if (fs === "paid") return o.cancelled_at ? "VOIDED" : "PAID";
  if (fs === "partially_refunded") return "PARTIALLY_REFUNDED";
  if (fs === "refunded") return "REFUNDED";
  if (fs === "voided") return "VOIDED";
  return o.cancelled_at ? "VOIDED" : "PENDING";
}

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
function paramsOf(url: string | null | undefined): URLSearchParams[] {
  if (!url) return [];
  try {
    const u = new URL(url, "https://likky.store");
    const out = [u.searchParams];
    const redir = u.searchParams.get("redirect"); // legacy /discount/CODE?redirect=/products/x?ref=...
    if (redir) out.push(new URL(redir, "https://likky.store").searchParams);
    return out;
  } catch { return []; }
}
/** Collects ref / utm signals from every place Shopify may keep them. */
function attributionSignals(o: R) {
  const refs: string[] = [], utmContents: string[] = [];
  let campaign: string | null = null;
  const add = (arr: string[], v: unknown) => { const t = String(v ?? "").trim(); if (t && SLUG_RE.test(t) && !arr.includes(t)) arr.push(t); };
  for (const src of [o.landing_site, o.referring_site]) {
    for (const p of paramsOf(src)) { add(refs, p.get("ref")); add(utmContents, p.get("utm_content")); campaign = campaign ?? p.get("utm_campaign"); }
  }
  add(refs, o.landing_site_ref);
  const notes: R[] = Array.isArray(o.note_attributes) ? o.note_attributes : [];
  const note = (...names: string[]) => notes.find((n) => names.includes(String(n.name ?? "").toLowerCase()))?.value ?? null;
  add(refs, note("ref", "vf_ref", "_vf_ref"));
  add(utmContents, note("utm_content", "_vf_utm_content"));
  campaign = campaign ?? note("utm_campaign", "_vf_utm_campaign");
  return {
    refs, utmContents,
    campaign: campaign && SLUG_RE.test(campaign) ? campaign : null,
    keyword: (() => { const k = String(note("keyword", "_vf_keyword") ?? "").trim(); return k && SLUG_RE.test(k) ? k : null; })(),
    creator: (() => { const c = String(note("creator", "_vf_creator") ?? "").trim().replace(/^@/, ""); return c && SLUG_RE.test(c) ? c : null; })(),
  };
}

async function settings(): Promise<R> {
  const r = await db.from("app_settings").select("value").eq("key", "global").maybeSingle();
  return { payout_rule: "CPA_FIXED", payout_value: null, hold_days: 14, attribution_window_days: 7, store_domain: "likky.store", ...(r.data?.value ?? {}) };
}

async function logEvent(name: string, props: R) {
  const { error } = await db.from("events").insert({ event_id: crypto.randomUUID(), name, occurred_at: new Date().toISOString(), source: "shopify:webhook", props });
  if (error) console.error("event", error.message);
}

async function voidOrClawback(orderId: string, externalId: string, refundId: string | null, reason: string) {
  const cms = unwrap(await db.from("commission").select("*").eq("idempotency_key", `cpa:${externalId}`), "commission lookup") as R[];
  for (const c of cms) {
    if (c.status === "HELD" || c.status === "APPROVED" || c.status === "NEEDS_REVIEW") {
      unwrap(await db.from("commission").update({ status: "VOID" }).eq("id", c.id), "void");
    } else if (c.status === "PAID") {
      unwrap(await db.from("commission").upsert({
        conversion_id: c.conversion_id, refund_id: refundId, creator_id: c.creator_id, kind: "CLAWBACK",
        basis_cents: c.basis_cents, rate: c.rate, amount_cents: -Math.abs(c.amount_cents), currency: c.currency,
        status: "APPROVED", idempotency_key: `clawback:${externalId}`,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true }), "clawback");
    }
  }
  await logEvent("commission_reversed", { order_id: orderId, external_id: externalId, reason });
}

async function handleOrder(o: R, topic: string) {
  const s = await settings();
  const brand = unwrap(await db.from("brand").select("id").eq("domain", s.store_domain).maybeSingle(), "brand") as R | null
    ?? unwrap(await db.from("brand").select("id").limit(1).maybeSingle(), "brand any") as R | null;
  if (!brand) throw new Error("no brand row");

  const externalId = String(o.id);
  const email = (o.email ?? o.customer?.email ?? "").toLowerCase().trim();
  const customerHash = email ? await sha256(SALT + email) : o.customer?.id ? await sha256(SALT + "cust:" + o.customer.id) : null;
  const codes: string[] = (o.discount_codes ?? []).map((d: R) => String(d.code ?? "").toUpperCase()).filter(Boolean);
  const status = mapStatus(o);
  const orderedAt = o.created_at ?? new Date().toISOString();

  const row = {
    external_id: externalId, name: o.name ?? null, brand_id: brand.id, ordered_at: orderedAt,
    currency: o.currency ?? "USD", subtotal_cents: cents(o.subtotal_price ?? o.total_line_items_price),
    discount_cents: cents(o.total_discounts), shipping_cents: cents(o.total_shipping_price_set?.shop_money?.amount),
    tax_cents: cents(o.total_tax), total_cents: cents(o.total_price), financial_status: status,
    customer_hash: customerHash, landing_site: o.landing_site ?? null, landing_site_ref: o.landing_site_ref ?? null, referring_site: o.referring_site ?? null,
    discount_codes: codes, note_attributes: o.note_attributes ?? null,
  };
  const saved = unwrap(await db.from("order").upsert(row, { onConflict: "external_id" }).select("id, is_first_order").single(), "order upsert") as R;
  const orderId = saved.id as string;

  if (saved.is_first_order === null && customerHash) {
    const prev = unwrap(await db.from("order").select("id", { count: "exact", head: false }).eq("customer_hash", customerHash).lt("ordered_at", orderedAt).limit(1), "prev") as R[];
    await db.from("order").update({ is_first_order: prev.length === 0 }).eq("id", orderId);
  }

  // Line items (replace)
  const products = unwrap(await db.from("product").select("id, title, handle, shopify_product_id, shopify_variant_id, cogs_cents, shipping_cost_cents"), "products") as R[];
  const items: R[] = [];
  for (const li of (o.line_items ?? []) as R[]) {
    const pid = li.product_id ? String(li.product_id) : null, vid = li.variant_id ? String(li.variant_id) : null;
    const title = String(li.title ?? li.name ?? "").toLowerCase();
    const p = products.find((x) => vid && x.shopify_variant_id === vid) ?? products.find((x) => pid && x.shopify_product_id === pid)
      ?? products.find((x) => title && (title.includes(String(x.title).toLowerCase()) || String(x.title).toLowerCase().includes(title)));
    if (p && pid && !p.shopify_product_id) { await db.from("product").update({ shopify_product_id: pid }).eq("id", p.id); p.shopify_product_id = pid; }
    const lineDisc = ((li.discount_allocations ?? []) as R[]).reduce((a, d) => a + cents(d.amount), 0);
    items.push({ order_id: orderId, product_id: p?.id ?? null, variant_id: vid, qty: Math.max(1, Number(li.quantity) || 1), price_cents: cents(li.price), cogs_cents: p && p.cogs_cents !== null ? Number(p.cogs_cents) + Number(p.shipping_cost_cents ?? 0) : null, discount_cents: lineDisc }); // landed unit cost snapshot
  }
  unwrap(await db.from("order_item").delete().eq("order_id", orderId), "items delete");
  if (items.length) unwrap(await db.from("order_item").insert(items), "items insert");

  if (status === "REFUNDED" || status === "VOIDED") await voidOrClawback(orderId, externalId, null, `status ${status}`);

  // Attribution: once per order (conversion.order_id unique)
  const existing = unwrap(await db.from("conversion").select("id").eq("order_id", orderId).maybeSingle(), "conv lookup");
  if (existing) return { orderId, attributed: "already" };

  // Link-only attribution. Priority: ref/utm_content (landing_site, landing_site_ref, note/cart attributes, referring_site)
  // → tracked link → creator; then utm_campaign (creator nick); then keyword / creator note attribute; discount code only as optional fallback.
  let method: "LINK" | "KEYWORD" | "MANUAL" | "PROMO" | null = null;
  let creatorId: string | null = null, offerId: string | null = null, token: string | null = null, postId: string | null = null;
  const sig = attributionSignals(o);
  for (const tok of [...sig.refs, ...sig.utmContents]) {
    let link = unwrap(await db.from("tracked_link").select("*").eq("token", tok).maybeSingle(), "link by ref") as R | null;
    if (!link) link = unwrap(await db.from("tracked_link").select("*").eq("utm_content", tok).limit(1).maybeSingle(), "link by utm") as R | null;
    if (link) { method = "LINK"; creatorId = link.creator_id; offerId = link.offer_id; token = link.token; postId = link.post_id; break; }
  }
  if (!method && sig.campaign) {
    const c = unwrap(await db.from("creator").select("id").eq("display_name", sig.campaign.toLowerCase()).limit(1).maybeSingle(), "creator by utm_campaign") as R | null;
    if (c) { method = "LINK"; creatorId = c.id; }
  }
  if (!method && sig.keyword) {
    const ls = unwrap(await db.from("tracked_link").select("creator_id, offer_id, token").eq("keyword", sig.keyword.toUpperCase()).is("revoked_at", null).limit(5), "link by keyword") as R[];
    const creators = new Set(ls.map((l) => l.creator_id));
    if (creators.size === 1) { method = "KEYWORD"; creatorId = ls[0].creator_id; offerId = ls[0].offer_id; }
  }
  if (!method && sig.creator) {
    const c = unwrap(await db.from("creator").select("id").eq("display_name", sig.creator.toLowerCase()).limit(1).maybeSingle(), "creator by note") as R | null;
    if (c) { method = "MANUAL"; creatorId = c.id; }
  }
  if (!method && codes.length) {
    const promos = unwrap(await db.from("promo_code").select("code, creator_id, offer_id, status").in("code", codes), "promo") as R[];
    const p = promos.find((x) => x.status === "ACTIVE") ?? promos[0];
    if (p) { method = "PROMO"; creatorId = p.creator_id; offerId = p.offer_id; }
  }
  await db.from("order").update({ ref: token ?? sig.refs[0] ?? null }).eq("id", orderId);
  if (!method || !creatorId) { await logEvent("order_unattributed", { order_id: orderId, external_id: externalId, topic, landing_site: o.landing_site ?? null, signals: sig }); return { orderId, attributed: false }; } // founder assigns manually in the cabinet

  if (!offerId) {
    const pid = items.find((i) => i.product_id)?.product_id;
    if (pid) offerId = (unwrap(await db.from("offer").select("id").eq("product_id", pid).limit(1).maybeSingle(), "offer") as R | null)?.id ?? null;
  }

  const touch = unwrap(await db.from("attribution_touch").insert({
    type: method === "LINK" ? "LINK_CLICK" : method, creator_id: creatorId, offer_id: offerId, post_id: postId, token,
    order_id: orderId, occurred_at: orderedAt, raw: { codes, landing_site: o.landing_site ?? null, landing_site_ref: o.landing_site_ref ?? null, referring_site: o.referring_site ?? null, signals: sig, topic },
  }).select("id").single(), "touch") as R;
  const conv = unwrap(await db.from("conversion").upsert({
    order_id: orderId, touch_id: touch.id, creator_id: creatorId, offer_id: offerId, post_id: postId,
    method, window_days: Number(s.attribution_window_days) || 7,
  }, { onConflict: "order_id", ignoreDuplicates: true }).select("id").maybeSingle(), "conversion") as R | null;
  if (!conv) return { orderId, attributed: "race" };

  if (status === "REFUNDED" || status === "VOIDED") return { orderId, attributed: method, commission: "skipped (refunded/voided)" };

  // Commission
  // Payout precedence: creator override → offer payout (when set) → global settings
  const creator = unwrap(await db.from("creator").select("payout_rule, payout_value").eq("id", creatorId).single(), "creator") as R;
  const offer = offerId ? unwrap(await db.from("offer").select("payout_rule, payout_value").eq("id", offerId).maybeSingle(), "offer payout") as R | null : null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rule: string = creator.payout_rule ?? (offer && offer.payout_value !== null ? offer.payout_rule : s.payout_rule);
  const value: number | null = creator.payout_rule ? num(creator.payout_value) : offer && offer.payout_value !== null ? num(offer.payout_value) : num(s.payout_value);
  const net = row.subtotal_cents; // Shopify subtotal_price is already after discounts
  let amount: number | null = null, basis: number | null = null;
  if (value !== null) {
    if (rule === "CPA_FIXED") amount = Math.round(value * 100);
    else if (rule === "PCT_REVENUE") { basis = net; amount = Math.round(net * value); }
    else if (rule === "PCT_MARGIN") {
      // margin = subtotal after discounts (no shipping/tax) − Σ landed cost (CJ product + shipping) × qty, floor 0
      if (items.length && items.every((i) => i.cogs_cents !== null)) {
        basis = Math.max(0, net - items.reduce((a, i) => a + i.cogs_cents * i.qty, 0));
        amount = Math.round(basis * value);
      }
    }
  }
  if (amount === null && value !== null && rule === "PCT_MARGIN") {
    // COGS missing for some item → never pay on a wrong base: park the commission for admin review
    unwrap(await db.from("commission").upsert({
      conversion_id: conv.id, creator_id: creatorId, kind: "CPA", basis_cents: null, rate: value, amount_cents: 0,
      status: "NEEDS_REVIEW", hold_until: null, idempotency_key: `cpa:${externalId}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true }), "commission needs_review");
    await logEvent("commission_needs_amount", { order_id: orderId, creator_id: creatorId, rule, reason: "missing COGS" });
    return { orderId, attributed: method, commission: "needs_review" };
  }
  if (amount === null) {
    await logEvent("commission_needs_amount", { order_id: orderId, creator_id: creatorId, rule, reason: value === null ? "payout_value not set" : "missing COGS" });
    return { orderId, attributed: method, commission: "needs_amount" };
  }
  const holdUntil = new Date(new Date(orderedAt).getTime() + (Number(s.hold_days) || 0) * 86400000).toISOString();
  unwrap(await db.from("commission").upsert({
    conversion_id: conv.id, creator_id: creatorId, kind: "CPA", basis_cents: basis, rate: value, amount_cents: amount,
    status: "HELD", hold_until: holdUntil, idempotency_key: `cpa:${externalId}`,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }), "commission");
  return { orderId, attributed: method, commission: amount };
}

async function handleRefund(r: R, type: "REFUND" | "CANCEL") {
  const externalOrder = String(type === "REFUND" ? r.order_id : r.id);
  const order = unwrap(await db.from("order").select("id, total_cents").eq("external_id", externalOrder).maybeSingle(), "order for refund") as R | null;
  if (!order) return { skipped: "unknown order" };
  let amount = 0;
  if (type === "REFUND") amount = ((r.transactions ?? []) as R[]).filter((t) => (t.kind ?? "refund") === "refund" && (t.status ?? "success") === "success").reduce((a, t) => a + cents(t.amount), 0);
  else amount = order.total_cents;
  const extRefund = type === "REFUND" ? String(r.id) : `cancel:${externalOrder}`;
  const ref = unwrap(await db.from("refund").upsert({
    order_id: order.id, external_id: extRefund, type, amount_cents: amount, reason: r.note ?? r.cancel_reason ?? null,
    created_at: r.created_at ?? r.cancelled_at ?? new Date().toISOString(),
  }, { onConflict: "external_id" }).select("id").single(), "refund") as R;
  const refunds = unwrap(await db.from("refund").select("amount_cents").eq("order_id", order.id), "refunds") as R[];
  const total = refunds.reduce((a, x) => a + x.amount_cents, 0);
  const full = type === "CANCEL" || total >= order.total_cents;
  await db.from("order").update({ financial_status: type === "CANCEL" ? "VOIDED" : full ? "REFUNDED" : "PARTIALLY_REFUNDED" }).eq("id", order.id);
  if (full) await voidOrClawback(order.id, externalOrder, ref.id, type);
  else await logEvent("partial_refund_review", { order_id: order.id, refunded_cents: total });
  return { refund: ref.id, full };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  const secret = await appSecret("SHOPIFY_WEBHOOK_SECRET", "shopify_webhook_secret");
  if (!secret) return json(401, { error: "webhook secret not configured" });
  SALT = (await appSecret("HASH_SALT", "hash_salt")) ?? "vf";

  const raw = await req.arrayBuffer();
  const given = req.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!given || !safeEqual(await hmacBase64(secret, raw), given)) return json(401, { error: "invalid signature" });

  const topic = (req.headers.get("x-shopify-topic") ?? "").toLowerCase();
  let payload: R;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "bad json" }); }

  try {
    let result: R = { ignored: topic };
    if (["orders/create", "orders/paid", "orders/updated"].includes(topic)) result = await handleOrder(payload, topic);
    else if (topic === "orders/cancelled") { await handleOrder(payload, topic); result = await handleRefund(payload, "CANCEL"); }
    else if (topic === "refunds/create") result = await handleRefund(payload, "REFUND");
    await logEvent("shopify_webhook", { topic, webhook_id: req.headers.get("x-shopify-webhook-id"), shop: req.headers.get("x-shopify-shop-domain"), result });
    return json(200, { ok: true, ...result });
  } catch (e) {
    console.error(topic, (e as Error).message);
    return json(500, { error: "processing failed" }); // Shopify retries on non-2xx
  }
});
