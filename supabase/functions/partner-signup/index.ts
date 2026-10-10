// Partner self-signup with LOGIN + PASSWORD (no email). POST JSON {login, password, telegram, handles?, website?(honeypot)}
// Public (verify_jwt = false). Uses the service role to create a confirmed auth user with an internal, never-delivered
// address <login>@partners.likky.invalid (app_metadata.login = login) and the creator row. Never sends email.
// Abuse protection: honeypot field, per-IP limits (5 successful signups / hour, 20 attempts / hour).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

export const PARTNER_EMAIL_DOMAIN = "partners.likky.invalid";
const LOGIN_RE = /^[a-z0-9_]{3,24}$/;
const MAX_OK_PER_HOUR = 5, MAX_TRIES_PER_HOUR = 20;
const RESERVED = new Set(["admin", "root", "likky", "support", "help", "system", "test_admin", "moderator"]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const fail = (status: number, error: string) => json(status, { ok: false, error });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "Только POST");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "Неверный запрос"); }

  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256((Deno.env.get("HASH_SALT") ?? "vf") + "signup:" + ip);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent, error: rErr } = await db.from("signup_attempt").select("ok").eq("ip_hash", ipHash).gte("created_at", since).limit(200);
  if (rErr) { console.error("throttle", rErr.message); return fail(500, "Сервис временно недоступен, попробуйте позже"); }
  const okCount = (recent ?? []).filter((r) => r.ok).length;
  if (okCount >= MAX_OK_PER_HOUR || (recent ?? []).length >= MAX_TRIES_PER_HOUR) {
    return fail(429, "Слишком много регистраций с этого устройства. Попробуйте через час.");
  }

  const login = clean(body.login, 40).toLowerCase().replace(/^@/, "");
  const record = async (ok: boolean) => { await db.from("signup_attempt").insert({ ip_hash: ipHash, ok, login: login.slice(0, 24) || null }); };

  // Honeypot: bots fill hidden fields. Pretend success-ish without creating anything.
  if (clean(body.website, 200)) { await record(false); return fail(400, "Не получилось. Обновите страницу и попробуйте снова."); }

  const password = String(body.password ?? "");
  const telegramRaw = clean(body.telegram, 40).replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  const handlesIn = (body.handles && typeof body.handles === "object" ? body.handles : {}) as Record<string, unknown>;

  if (!LOGIN_RE.test(login)) { await record(false); return fail(400, "Логин: 3–24 символа — латиница, цифры или _"); }
  if (RESERVED.has(login)) { await record(false); return fail(400, "Этот логин занят — выберите другой"); }
  if (password.length < 8) { await record(false); return fail(400, "Пароль: минимум 8 символов"); }
  if (password.length > 72) { await record(false); return fail(400, "Пароль слишком длинный (максимум 72 символа)"); }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(telegramRaw)) { await record(false); return fail(400, "Укажите Telegram, например @username"); }
  const handles: Record<string, string> = {};
  for (const k of ["IG", "TT", "YT"]) { const v = clean(handlesIn[k], 60); if (v) handles[k] = v; }

  // Uniqueness (login is also the creator nickname used in every link)
  const { data: taken } = await db.from("creator").select("id").or(`login.eq.${login},display_name.eq.${login}`).limit(1);
  if (taken?.length) { await record(false); return fail(409, "Этот логин уже занят — выберите другой"); }

  const email = `${login}@${PARTNER_EMAIL_DOMAIN}`;
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { login }, app_metadata: { login, role: "partner" },
  });
  if (cErr || !created?.user) {
    await record(false);
    const m = cErr?.message ?? "";
    if (/already|exists|registered/i.test(m)) return fail(409, "Этот логин уже занят — выберите другой");
    if (/password/i.test(m)) return fail(400, "Пароль слишком простой — добавьте цифры и буквы");
    console.error("createUser", m);
    return fail(500, "Не удалось создать аккаунт. Попробуйте позже.");
  }

  const { error: iErr } = await db.from("creator").insert({
    type: "PARTNER_HUMAN", display_name: login, login, telegram: "@" + telegramRaw, contact: "@" + telegramRaw,
    handles, status: "PENDING", self_signup: true, auth_user_id: created.user.id, // admin approves in /admin/
  });
  if (iErr) {
    await db.auth.admin.deleteUser(created.user.id);
    await record(false);
    if (/duplicate|unique/i.test(iErr.message)) return fail(409, "Этот логин уже занят — выберите другой");
    console.error("creator insert", iErr.message);
    return fail(500, "Не удалось создать профиль. Попробуйте позже.");
  }
  await record(true);
  return json(200, { ok: true, login, status: "PENDING" });
});
