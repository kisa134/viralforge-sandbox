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
/** Short tracked link (База mode only) served by the `r` edge function (logs the click, then 302 to the product page with ?ref=). */
export const shortLink = (token: string) => (supabaseConfigured ? `${SUPABASE_URL}/functions/v1/r?s=${encodeURIComponent(token)}` : null);
