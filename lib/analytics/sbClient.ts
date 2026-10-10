// Supabase browser client — only created when both public env vars are present at build time.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient | null {
  if (!supabaseConfigured || typeof window === "undefined") return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return client;
}
/** Public base for short creator links: https://go.likky.store/<slug> (GitHub Pages repo kisa134/likky-go → forwards to the `r` edge function). */
export const SHORT_LINK_BASE = (process.env.NEXT_PUBLIC_SHORT_LINK_BASE ?? "https://go.likky.store").replace(/\/+$/, "");
/** Short tracked link (База mode only): go.likky.store/<slug> → `r` edge function (logs the click, then 302 to the product page with ?ref=).
 *  Old links …/functions/v1/r?s=<slug> keep working. */
export const shortLink = (token: string) => (supabaseConfigured ? `${SHORT_LINK_BASE}/${encodeURIComponent(token)}` : null);
