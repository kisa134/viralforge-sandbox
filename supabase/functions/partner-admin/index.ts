// Admin actions for partners. POST JSON {action: "reset_password", creator_id, password}
// verify_jwt = true: caller must be signed in; we additionally check the caller is in public.admins (via RLS on admins).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const svc = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Только POST" });
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { ok: false, error: "Нужен вход" });

  // Who is calling? Validate the JWT with Auth, then check admin rights with the caller's own token (RLS on admins).
  const { data: u, error: uErr } = await svc.auth.getUser(jwt);
  if (uErr || !u?.user) return json(401, { ok: false, error: "Сессия устарела — войдите заново" });
  const asCaller = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: adm } = await asCaller.from("admins").select("id").limit(1);
  if (!adm?.length) return json(403, { ok: false, error: "Только для админа" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "Неверный запрос" }); }

  if (body.action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 8 || password.length > 72) return json(400, { ok: false, error: "Пароль: 8–72 символа" });
    const { data: c } = await svc.from("creator").select("id, auth_user_id, login, display_name").eq("id", String(body.creator_id ?? "")).maybeSingle();
    if (!c) return json(404, { ok: false, error: "Креатор не найден" });
    if (!c.auth_user_id) return json(400, { ok: false, error: "У этого креатора нет аккаунта для входа (заведён вручную)" });
    const { error } = await svc.auth.admin.updateUserById(c.auth_user_id, { password });
    if (error) return json(500, { ok: false, error: "Не удалось сменить пароль: " + error.message });
    await svc.from("events").insert({ event_id: crypto.randomUUID(), name: "partner_password_reset", occurred_at: new Date().toISOString(), source: "edge:partner-admin", props: { creator_id: c.id, by: u.user.id } });
    return json(200, { ok: true, login: c.login ?? c.display_name });
  }
  return json(400, { ok: false, error: "Неизвестное действие" });
});
