// Partner cabinet API — thin wrappers over the partner_* RPCs (see supabase/migrations/20261010120000_partner_cabinet.sql).
import type { SupabaseClient } from "@supabase/supabase-js";

export type PPlatform = "IG" | "TT" | "YT";
export type Profile = { id: string; nick: string; telegram: string | null; handles: Partial<Record<PPlatform, string>>; status: string; email: string | null; created_at: string; rate?: Rate | null };
export type Rate = { rule: string | null; value: number | null; source?: "partner" | "default" };
export type CatalogItem = { product_id: string; title: string; handle: string; pdp_url: string | null; price_cents: number; image_url: string | null; pitch: string | null; payout_rule: string | null; payout_value: number | null };
export type LinkStat = { token: string; label: string | null; platform: PPlatform | null; created_at: string; revoked: boolean; product_title: string | null; clicks: number; orders: number; revenue_cents: number; held_cents: number; approved_cents: number; paid_cents: number };
export type Totals = { clicks: number; orders: number; revenue_cents: number; held_cents: number; approved_cents: number; paid_cents: number };
export type PayoutRow = { period_start: string; period_end: string; amount_cents: number; currency: string; method: string; status: string; paid_at: string | null };
export type Stats = { links: LinkStat[]; totals: Totals; unlinked: { orders: number; revenue_cents: number }; payouts: PayoutRow[]; hold_days: number };
export type NewLink = { token: string; dest_url: string; platform: PPlatform; label: string | null; product_title: string };

async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const getMe = (c: SupabaseClient) => rpc<Profile | null>(c, "partner_me");
export const register = (c: SupabaseClient, nick: string, telegram: string, handles: Partial<Record<PPlatform, string>>) =>
  rpc<Profile>(c, "partner_register", { p_nick: nick, p_telegram: telegram, p_handles: handles });
export const getCatalog = async (c: SupabaseClient) => (await rpc<CatalogItem[] | null>(c, "partner_catalog")) ?? [];
export const createLink = (c: SupabaseClient, productId: string, platform: PPlatform, label: string) =>
  rpc<NewLink>(c, "partner_create_link", { p_product: productId, p_platform: platform, p_label: label || null });
export const getStats = (c: SupabaseClient, from: string | null) => rpc<Stats | null>(c, "partner_stats", { p_from: from });

export const PLATFORM_LABEL: Record<PPlatform, string> = { IG: "Instagram Reels", TT: "TikTok", YT: "YouTube Shorts" };
export const PLATFORM_ICON: Record<PPlatform, string> = { IG: "📸", TT: "🎵", YT: "▶️" };
export const usd = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function payoutText(rule: string | null, value: number | null): string {
  if (value === null || value === undefined) return "ставка уточняется";
  if (rule === "CPA_FIXED") return `$${Number(value).toFixed(2)} за продажу`;
  if (rule === "PCT_REVENUE") return `${Math.round(Number(value) * 1000) / 10}% от суммы заказа`;
  if (rule === "PCT_MARGIN") return `${Math.round(Number(value) * 1000) / 10}% от маржи`;
  return "ставка уточняется";
}

/** «15% с каждого заказа» / «$5.00 с каждой продажи» */
export function rateHeadline(r: Rate | null | undefined): string | null {
  if (!r || r.value === null || r.value === undefined) return null;
  if (r.rule === "PCT_REVENUE") return `${Math.round(Number(r.value) * 1000) / 10}% с каждого заказа`;
  if (r.rule === "CPA_FIXED") return `$${Number(r.value).toFixed(2)} с каждой продажи`;
  if (r.rule === "PCT_MARGIN") return `${Math.round(Number(r.value) * 1000) / 10}% от маржи заказа`;
  return null;
}
/** Commission in cents for one unit at list price (null if unknown). */
export function payoutCents(rule: string | null, value: number | null, priceCents: number): number | null {
  if (value === null || value === undefined) return null;
  if (rule === "CPA_FIXED") return Math.round(Number(value) * 100);
  if (rule === "PCT_REVENUE") return Math.round(priceCents * Number(value));
  return null;
}

/** English caption + DM templates per product (US audience). */
const COPY: Record<string, { kw: string; hook: string; tags: string }> = {
  "study-room-creative-night-light-resin-ornaments": { kw: "DRAGON", hook: "POV: your room after you turn on the dragon lamp 🐉✨", tags: "#dragonlamp #roomdecor #cozyvibes #giftideas" },
  "luminous-witchs-cauldron-lamp-resin-craft": { kw: "BREW", hook: "This little cauldron makes every night feel like Halloween 🧙‍♀️🔮", tags: "#halloweendecor #witchyvibes #spookyseason #cozydecor" },
  "design-a-resin-lantern-as-a-halloween-gift": { kw: "FIRE", hook: "Lights off… now watch the fire dragon wake up 🔥🐉", tags: "#firedragon #halloweendecor #dragonlamp #spookyseason" },
  "bat-wing-table-lamp-halloween-resin-ornaments": { kw: "BAT", hook: "The bat lamp that stays up all year 🦇🖤", tags: "#batlamp #gothdecor #spookyseason #halloweendecor" },
  "new-baby-halloween-long-sleeved-jumpsuit-pumpkin-letter-halloween-baby-jumpsuits-triangle-rompers": { kw: "BABY", hook: "Baby's first Halloween = tiny bat mode 🦇🍼", tags: "#babyhalloween #babyfirsthalloween #momlife #halloweencostume" },
};
export function captionFor(handle: string, platform: PPlatform) {
  const c = COPY[handle] ?? { kw: "LIKKY", hook: "You need this in your room ✨", tags: "#roomdecor #giftideas" };
  const cta = platform === "YT" ? "Link in my profile 👆" : `Comment ${c.kw} and I'll DM you the link 👇`;
  return {
    keyword: c.kw,
    caption: `${c.hook}\n${cta}\n#ad ${c.tags}`,
    dm: (link: string) => `Hey! Here's the link 💛\n${link}`,
  };
}

// ───────── Login + password (no email) ─────────
/** Internal, never-delivered address used for login-based accounts (see supabase/functions/partner-signup). */
export const PARTNER_EMAIL_DOMAIN = "partners.likky.invalid";
/** Founder's Telegram for support/password recovery — placeholder until the founder sets it. */
export const CONTACT_TG = "@контакт";
export const normLogin = (s: string) => s.trim().toLowerCase().replace(/^@/, "");
/** "mira" → "mira@partners.likky.invalid"; a full email is passed through (legacy email accounts). */
export const loginToEmail = (login: string) => (login.includes("@") ? login.trim().toLowerCase() : `${normLogin(login)}@${PARTNER_EMAIL_DOMAIN}`);
export const isInternalEmail = (email: string | null | undefined) => Boolean(email && email.endsWith("@" + PARTNER_EMAIL_DOMAIN));

export async function signupPartner(supabaseUrl: string, apikey: string, p: { login: string; password: string; telegram: string; handles: Partial<Record<PPlatform, string>>; website: string }) {
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/partner-signup`, { method: "POST", headers: { "Content-Type": "application/json", apikey }, body: JSON.stringify(p) });
  } catch { throw new Error("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || "Не удалось зарегистрироваться. Попробуйте позже.");
  return j as { ok: true; login: string; status: string };
}

// ───────── Admin RPCs ─────────
export type AdminPartner = {
  id: string; login: string; nick: string; telegram: string | null; handles: Partial<Record<PPlatform, string>>; status: string;
  self_signup: boolean; has_account: boolean; created_at: string; payout_rule: string | null; payout_value: number | null; effective?: Rate | null;
  links: number; clicks: number; orders: number; revenue_cents: number; earned_cents: number; paid_cents: number;
};
export type AdminRow = { id: number; login: string | null; email: string | null; created_at: string };
export const adminWhoami = (c: SupabaseClient) => rpc<{ is_admin: boolean; login: string | null; email: string | null }>(c, "admin_whoami");
export const adminPartners = async (c: SupabaseClient) => (await rpc<AdminPartner[] | null>(c, "admin_partners")) ?? [];
export const adminSetStatus = (c: SupabaseClient, id: string, status: string) => rpc<null>(c, "admin_set_partner_status", { p_creator: id, p_status: status });
export const adminSetRate = (c: SupabaseClient, id: string, rule: string | null, value: number | null) => rpc<null>(c, "admin_set_partner_rate", { p_creator: id, p_rule: rule, p_value: value });
export const adminGetDefaultRate = (c: SupabaseClient) => rpc<Rate>(c, "admin_get_default_rate");
export const adminSetDefaultRate = (c: SupabaseClient, rule: string, value: number) => rpc<null>(c, "admin_set_default_rate", { p_rule: rule, p_value: value });
export const adminListAdmins = async (c: SupabaseClient) => (await rpc<AdminRow[] | null>(c, "admin_list_admins")) ?? [];
export const adminAddAdmin = (c: SupabaseClient, login: string) => rpc<null>(c, "admin_add_admin", { p_login: login });
export const adminRemoveAdmin = (c: SupabaseClient, id: number) => rpc<null>(c, "admin_remove_admin", { p_id: id });
export async function adminResetPassword(c: SupabaseClient, creatorId: string, password: string) {
  const { data, error } = await c.functions.invoke("partner-admin", { body: { action: "reset_password", creator_id: creatorId, password } });
  if (error) {
    // supabase-js wraps non-2xx; try to read our JSON error
    const ctx = (error as { context?: Response }).context;
    const j = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(j?.error || error.message);
  }
  if (!data?.ok) throw new Error(data?.error || "Не удалось сменить пароль");
  return data as { ok: true; login: string };
}
