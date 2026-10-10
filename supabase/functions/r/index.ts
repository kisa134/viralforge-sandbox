// Click redirect: GET /functions/v1/r?s=<slug>  →  log click + event  →  302 to the product page (dest_url, +ref=<slug>)
// Public (verify_jwt = false). Uses the service role internally; never exposes data.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FALLBACK = "https://likky.store/";
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|whatsapp|telegrambot|discord|headless|curl|wget|python|httpclient/i;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

function slugFrom(req: Request): string {
  const u = new URL(req.url);
  const q = u.searchParams.get("s") || u.searchParams.get("t");
  if (q) return q.trim();
  const parts = u.pathname.split("/").filter(Boolean); // .../r/<slug>
  const i = parts.lastIndexOf("r");
  return i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : "";
}

Deno.serve(async (req) => {
  const slug = slugFrom(req);
  if (!slug || slug.length > 64 || !/^[A-Za-z0-9_-]+$/.test(slug)) return redirect(FALLBACK);

  const { data: link, error } = await db
    .from("tracked_link")
    .select("token, creator_id, offer_id, post_id, platform, dest_url, revoked_at, utm_source, utm_campaign, utm_content")
    .eq("token", slug)
    .maybeSingle();
  if (error) console.error("lookup", error.message);
  if (!link || link.revoked_at) return redirect(FALLBACK);

  let dest: URL;
  try { dest = new URL(link.dest_url); } catch { return redirect(FALLBACK); }

  // Only ACTIVE creators get attribution: for pending/blocked partners send the buyer to the plain product page (no ref/utm, no click log).
  const { data: cr } = await db.from("creator").select("status").eq("id", link.creator_id).maybeSingle();
  if (cr?.status !== "ACTIVE") return redirect(`${dest.origin}${dest.pathname}`);
  if (!dest.searchParams.has("ref")) dest.searchParams.set("ref", slug);

  const ua = req.headers.get("user-agent") ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const salt = Deno.env.get("HASH_SALT") ?? "vf";
  const country = (req.headers.get("cf-ipcountry") ?? req.headers.get("x-country") ?? "").slice(0, 2).toUpperCase() || null;
  const isBot = BOT_RE.test(ua) || req.method === "HEAD";
  const now = new Date().toISOString();

  const log = (async () => {
    const [ipHash, uaHash] = await Promise.all([ip ? sha256(salt + ip) : null, ua ? sha256(salt + ua) : null]);
    const { data: click, error: e1 } = await db.from("click").insert({
      token: slug, clicked_at: now, ip_hash: ipHash, ua_hash: uaHash,
      referer: req.headers.get("referer"), country, is_bot: isBot,
    }).select("id").single();
    if (e1) console.error("click", e1.message);
    const { error: e2 } = await db.from("events").insert({
      event_id: crypto.randomUUID(), name: "link_clicked", occurred_at: now, source: "edge:r",
      props: {
        token: slug, click_id: click?.id ?? null, creator_id: link.creator_id, offer_id: link.offer_id,
        post_id: link.post_id, platform: link.platform, utm_source: link.utm_source,
        utm_campaign: link.utm_campaign, utm_content: link.utm_content, is_bot: isBot,
      },
    });
    if (e2) console.error("event", e2.message);
  })();
  // Keep the redirect fast; finish logging in the background when supported.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(log); else await log;

  return redirect(dest.toString());
});
