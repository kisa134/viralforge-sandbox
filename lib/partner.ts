// Partner cabinet API — thin wrappers over the partner_* RPCs (see supabase/migrations/20261010120000_partner_cabinet.sql).
import type { SupabaseClient } from "@supabase/supabase-js";

export type PPlatform = "IG" | "TT" | "YT";
export type Profile = { id: string; nick: string; telegram: string | null; handles: Partial<Record<PPlatform, string>>; status: string; email: string | null; created_at: string };
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
