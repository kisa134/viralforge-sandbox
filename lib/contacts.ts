// Team contacts (public.team_contacts): public read of active rows via anon REST; admins manage via authenticated client.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/analytics/sbClient";

export type ContactKind = "telegram" | "whatsapp" | "email" | "phone" | "instagram" | "other";
export type TeamContact = { id: number; kind: ContactKind; label: string | null; value: string; url: string | null; sort: number; is_primary: boolean; active: boolean };

export const KIND_LABEL: Record<ContactKind, string> = { telegram: "Telegram", whatsapp: "WhatsApp", email: "Почта", phone: "Телефон", instagram: "Instagram", other: "Другое" };
export const KIND_ICON: Record<ContactKind, string> = { telegram: "✈️", whatsapp: "💬", email: "✉️", phone: "📞", instagram: "📸", other: "🔗" };
export const NO_CONTACTS = "контакты скоро появятся";
const COLS = "id,kind,label,value,url,sort,is_primary,active";

let cache: Promise<TeamContact[]> | null = null;
/** Active contacts, primary first. Uses the anon key directly (no session) — contacts are public. */
export function fetchPublicContacts(force = false): Promise<TeamContact[]> {
  if (!supabaseConfigured) return Promise.resolve([]);
  if (!cache || force) {
    cache = fetch(`${SUPABASE_URL}/rest/v1/team_contacts?select=${COLS}&active=eq.true&order=is_primary.desc,sort.asc,id.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, cache: "no-store",
    }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  }
  return cache;
}

export const contactText = (c: TeamContact) => (c.kind === "telegram" || c.kind === "instagram") && !c.value.startsWith("@") && !/^https?:/i.test(c.value) ? `@${c.value}` : c.value;

// ── admin CRUD (RLS: admins only) ──
const unwrap = <T,>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };
export const adminListContacts = async (c: SupabaseClient) =>
  unwrap(await c.from("team_contacts").select(COLS).order("is_primary", { ascending: false }).order("sort").order("id")) as TeamContact[];
export const adminSaveContact = async (c: SupabaseClient, row: Partial<TeamContact> & { kind: ContactKind; value: string }) => {
  const { id, ...rest } = row;
  const payload = { kind: rest.kind, label: rest.label ?? null, value: rest.value, url: rest.url ?? null, sort: rest.sort ?? 0, is_primary: !!rest.is_primary, active: rest.active ?? true };
  if (id) unwrap(await c.from("team_contacts").update(payload).eq("id", id).select("id"));
  else unwrap(await c.from("team_contacts").insert(payload).select("id"));
};
export const adminPatchContact = async (c: SupabaseClient, id: number, patch: Partial<TeamContact>) => { unwrap(await c.from("team_contacts").update(patch).eq("id", id).select("id")); };
export const adminDeleteContact = async (c: SupabaseClient, id: number) => { unwrap(await c.from("team_contacts").delete().eq("id", id).select("id")); };
