// ManageStore: where creators / links / settings / payouts are written.
// LOCAL = this browser's localStorage. SUPABASE = live tables (admin session + RLS).
import type { Dataset } from "./model";
import type { Row } from "./csv";
import {
  DEFAULT_PRODUCTS, defaultWorkspace, importOrderRows, loadWorkspace, normalize, saveWorkspace, uid, workspaceToDataset,
  type WsCreator, type WsLink, type WsProduct, type WsSettings, type Workspace,
} from "./workspace";
import { sb, shortLink } from "./sbClient";
import { SupabaseDataSource, table } from "./supabase";

export interface ManageStore {
  mode: "LOCAL" | "SUPABASE";
  newId(prefix: string): string;
  load(): Promise<Workspace>;
  dataset(): Promise<Dataset>;
  saveCreator(c: WsCreator): Promise<void>;
  deleteCreator(id: string): Promise<void>;
  saveLink(l: WsLink): Promise<void>;
  deleteLink(code: string): Promise<void>;
  saveSettings(s: WsSettings): Promise<void>;
  saveProduct(p: WsProduct): Promise<void>;
  markPaid(creatorId: string, commissionIds: string[], amountCents: number, note: string): Promise<void>;
  undoPayout(payoutId: string): Promise<void>;
}

export class LocalManageStore implements ManageStore {
  mode = "LOCAL" as const;
  newId(prefix: string) { return uid(prefix); }
  private mut(fn: (ws: Workspace) => void) { const ws = loadWorkspace(); fn(ws); saveWorkspace(ws); }
  async load() { return loadWorkspace(); }
  async dataset() { return workspaceToDataset(loadWorkspace()); }
  async saveCreator(c: WsCreator) {
    this.mut((ws) => {
      if (ws.creators.some((x) => x.id !== c.id && (x.nick === c.nick || x.promo_code === c.promo_code))) throw new Error(`Ник/промокод ${c.promo_code} уже занят`);
      const i = ws.creators.findIndex((x) => x.id === c.id); if (i >= 0) ws.creators[i] = c; else ws.creators.push(c);
    });
  }
  async deleteCreator(id: string) { this.mut((ws) => { ws.creators = ws.creators.filter((c) => c.id !== id); ws.links = ws.links.filter((l) => l.creator_id !== id); }); }
  async saveLink(l: WsLink) { this.mut((ws) => { const i = ws.links.findIndex((x) => x.code === l.code); if (i >= 0) ws.links[i] = l; else ws.links.push(l); }); }
  async deleteLink(code: string) { this.mut((ws) => { ws.links = ws.links.filter((l) => l.code !== code); }); }
  async saveSettings(s: WsSettings) { this.mut((ws) => { ws.settings = s; }); }
  async saveProduct(p: WsProduct) { this.mut((ws) => { const i = ws.products.findIndex((x) => x.id === p.id); if (i >= 0) ws.products[i] = p; }); }
  async markPaid(creatorId: string, ids: string[], amount: number, note: string) {
    this.mut((ws) => { ws.payouts.push({ id: uid("py"), creator_id: creatorId, commission_ids: ids, amount_cents: amount, paid_at: new Date().toISOString(), note }); });
  }
  async undoPayout(id: string) { this.mut((ws) => { ws.payouts = ws.payouts.filter((p) => p.id !== id); }); }
  // local-only helpers
  importOrders(rows: Row[]) { let res = { added: 0, updated: 0, skipped: 0 }; this.mut((ws) => { res = importOrderRows(ws, rows); }); return res; }
  importPosts(rows: Row[]) { this.mut((ws) => { ws.post_rows = rows; }); }
  clearOrders() { this.mut((ws) => { ws.orders = []; ws.payouts = []; }); }
  clearPosts() { this.mut((ws) => { ws.post_rows = []; }); }
  exportJson(): string { return JSON.stringify(loadWorkspace(), null, 2); }
  importJson(text: string) { saveWorkspace(normalize(JSON.parse(text))); }
  reset() { saveWorkspace(defaultWorkspace()); }
}

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const unwrap = async <T,>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

export class SupabaseManageStore implements ManageStore {
  mode = "SUPABASE" as const;
  private offerByProduct = new Map<string, string>();
  newId() { return crypto.randomUUID(); }
  private c() { const c = sb(); if (!c) throw new Error("Supabase не настроен"); return c; }
  async dataset() { return new SupabaseDataSource().load(); }
  async load(): Promise<Workspace> {
    const ws = defaultWorkspace();
    const [products, offers, creators, promos, links, settings, payouts] = await Promise.all([
      table("product"), table("offer"), table("creator"), table("promo_code"), table("tracked_link"), table("app_settings"), table("payout"),
    ]);
    this.offerByProduct = new Map(offers.map((o: R) => [o.product_id, o.id]));
    const g = settings.find((s: R) => s.key === "global");
    if (g) ws.settings = { ...ws.settings, ...g.value };
    ws.products = products.map((p: R) => ({ id: p.id, title: p.title, handle: p.handle, price_cents: p.price_cents, cogs_cents: p.cogs_cents, keyword: DEFAULT_PRODUCTS.find((d) => d.handle === p.handle)?.keyword ?? "LIKKY" }));
    ws.creators = creators.map((c: R) => ({ id: c.id, nick: c.display_name, contact: c.contact ?? "", handles: { IG: "", TT: "", YT: "", ...(c.handles ?? {}) }, promo_code: promos.find((p: R) => p.creator_id === c.id)?.code ?? "", payout_rule: c.payout_rule, payout_value: c.payout_value === null ? null : Number(c.payout_value), status: c.status === "ACTIVE" ? "ACTIVE" : "PAUSED", created_at: c.created_at }));
    const productByOffer = new Map(offers.map((o: R) => [o.id, o.product_id]));
    ws.links = links.filter((l: R) => !l.revoked_at).map((l: R) => ({ code: l.token, creator_id: l.creator_id, product_id: productByOffer.get(l.offer_id) ?? "", platform: l.platform ?? "IG", keyword: l.keyword ?? "", url: l.dest_url, short_url: shortLink(l.token), permalink: null, created_at: l.created_at }));
    ws.payouts = payouts.map((p: R) => ({ id: p.id, creator_id: p.creator_id, commission_ids: [], amount_cents: p.amount_cents, paid_at: p.paid_at, note: p.proof_ref ?? "" }));
    return ws;
  }
  async saveCreator(cr: WsCreator) {
    const c = this.c();
    await unwrap(c.from("creator").upsert({ id: cr.id, type: "PARTNER_HUMAN", display_name: cr.nick, contact: cr.contact, handles: cr.handles, payout_rule: cr.payout_rule, payout_value: cr.payout_value, status: cr.status === "ACTIVE" ? "ACTIVE" : "FROZEN", activated_at: cr.created_at }));
    await unwrap(c.from("promo_code").upsert({ code: cr.promo_code, creator_id: cr.id, status: "ACTIVE" }));
  }
  async deleteCreator(id: string) {
    const c = this.c();
    await unwrap(c.from("creator").update({ status: "CHURNED" }).eq("id", id));
    await unwrap(c.from("promo_code").update({ status: "DISABLED" }).eq("creator_id", id));
  }
  async saveLink(l: WsLink) {
    const offer = this.offerByProduct.get(l.product_id);
    if (!offer) throw new Error("Нет оффера для товара — примените миграцию seed");
    const u = new URL(l.url);
    await unwrap(this.c().from("tracked_link").upsert({
      token: l.code, creator_id: l.creator_id, offer_id: offer, sub_id: l.code, platform: l.platform, keyword: l.keyword,
      promo_code: decodeURIComponent(u.pathname.split("/").pop() ?? ""), dest_url: l.url,
      utm_source: u.searchParams.get("utm_source"), utm_medium: "creator", utm_campaign: u.searchParams.get("utm_campaign"), utm_content: l.code, revoked_at: null,
    }));
  }
  async deleteLink(code: string) { await unwrap(this.c().from("tracked_link").update({ revoked_at: new Date().toISOString() }).eq("token", code)); }
  async saveSettings(s: WsSettings) { await unwrap(this.c().from("app_settings").upsert({ key: "global", value: s, updated_at: new Date().toISOString() })); }
  async saveProduct(p: WsProduct) { await unwrap(this.c().from("product").update({ cogs_cents: p.cogs_cents, price_cents: p.price_cents }).eq("id", p.id)); }
  async markPaid(creatorId: string, ids: string[], amount: number, note: string) {
    const c = this.c();
    const today = new Date().toISOString().slice(0, 10);
    const rows = await unwrap(c.from("payout").insert({ creator_id: creatorId, period_start: today, period_end: today, amount_cents: amount, currency: "USD", method: "OTHER", status: "PAID", paid_at: new Date().toISOString(), proof_ref: note }).select("id"));
    const pid = (rows as R[])[0].id;
    await unwrap(c.from("commission").update({ status: "PAID", payout_id: pid }).in("id", ids));
  }
  async undoPayout(id: string) {
    const c = this.c();
    await unwrap(c.from("commission").update({ status: "APPROVED", payout_id: null }).eq("payout_id", id));
    await unwrap(c.from("payout").delete().eq("id", id));
  }
}
