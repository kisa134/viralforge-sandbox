// LLM business advisor for /admin «📈 Бизнес». POST {action: "status"} | {action: "analyze", period: "7"|"30"|"all", rules?: string[]}
// verify_jwt = true + admin check (admin_whoami with the caller's token). Sends ONLY aggregated metrics (no logins / emails / Telegram).
// API key: Supabase function secrets (AI_GATEWAY_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY) or Vault (ai_gateway_api_key | openai_api_key | anthropic_api_key).
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
const NEED_KEY = "Нужен ключ ИИ: добавьте AI_GATEWAY_API_KEY, OPENAI_API_KEY или ANTHROPIC_API_KEY в секреты Supabase (Edge Functions → Secrets) или в Vault.";

type Provider = { name: "gateway" | "openai" | "anthropic"; key: string };
async function findKey(): Promise<Provider | null> {
  const env: [Provider["name"], string][] = [["gateway", "AI_GATEWAY_API_KEY"], ["openai", "OPENAI_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"]];
  for (const [name, v] of env) { const k = Deno.env.get(v); if (k) return { name, key: k }; }
  const vault: [Provider["name"], string][] = [["gateway", "ai_gateway_api_key"], ["openai", "openai_api_key"], ["anthropic", "anthropic_api_key"]];
  for (const [name, v] of vault) {
    const { data } = await svc.rpc("get_ai_secret", { p_name: v });
    if (typeof data === "string" && data) return { name, key: data };
  }
  return null;
}

async function callLLM(p: Provider, system: string, user: string): Promise<string> {
  const model = Deno.env.get("AI_MODEL");
  if (p.name === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model || "claude-3-5-haiku-latest", max_tokens: 1500, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
    return (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  }
  const url = p.name === "gateway" ? "https://ai-gateway.vercel.sh/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model || (p.name === "gateway" ? "openai/gpt-4o-mini" : "gpt-4o-mini"), temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j.choices?.[0]?.message?.content ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Только POST" });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { ok: false, error: "Нужен вход" });
  const asCaller = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: who } = await asCaller.rpc("admin_whoami");
  if (!who?.is_admin) return json(403, { ok: false, error: "Только для админа" });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const provider = await findKey();
  if (body.action === "status") return json(200, { ok: true, configured: !!provider, provider: provider?.name ?? null, message: provider ? null : NEED_KEY });
  if (body.action !== "analyze") return json(400, { ok: false, error: "Неизвестное действие" });
  if (!provider) return json(200, { ok: false, need_key: true, error: NEED_KEY });

  const period = String(body.period ?? "30");
  const from = period === "all" ? null : new Date(Date.now() - Number(period || 30) * 86400000).toISOString();
  const { data: m, error } = await asCaller.rpc("admin_biz_metrics", { p_from: from });
  if (error || !m) return json(500, { ok: false, error: "Не удалось собрать метрики" });
  // strip PII: creator logins → C1..C5; drop images/handles
  const agg = {
    period_days: period, today: new Date().toISOString().slice(0, 10), store: "likky.store (Shopify, дропшиппинг CJ, США)",
    settings: m.settings, totals: m.totals, creators: m.creators, wow: m.wow, weeks: m.weeks,
    top_creators: (m.top_creators ?? []).map((t: Record<string, unknown>, i: number) => ({ id: `C${i + 1}`, clicks: t.clicks, orders: t.orders, revenue_cents: t.revenue_cents })),
    products: (m.products ?? []).map((p: Record<string, unknown>) => ({
      title: p.title, price_cents: p.price_cents, cogs_cents: p.cogs_cents, shipping_cost_cents: p.shipping_cost_cents,
      ship_days: [p.ship_days_min, p.ship_days_max], payout_rule: p.payout_rule, payout_value: p.payout_value,
      clicks: p.clicks, orders: p.orders, units: p.units, revenue_cents: p.revenue_cents, note: p.cost_note,
    })),
    rule_engine_actions: Array.isArray(body.rules) ? (body.rules as unknown[]).slice(0, 10).map((x) => String(x).slice(0, 300)) : [],
  };
  const system = "Ты — бизнес-аналитик партнёрской программы интернет-магазина. Креаторы снимают короткие ролики (TikTok/Reels/Shorts) с личными ссылками и получают % с заказа. " +
    "Отвечай по-русски, коротко и конкретно, опираясь ТОЛЬКО на переданные цифры (суммы в центах USD). Если данных мало — так и скажи, не выдумывай. " +
    'Верни JSON: {"summary": "2–4 предложения", "actions": [{"title": "действие", "why": "почему, с цифрами", "priority": 1}]} — 3–7 действий, priority 1 = самое срочное.';
  try {
    const text = await callLLM(provider, system, JSON.stringify(agg));
    let parsed: unknown = null;
    try { parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()); } catch { /* fallthrough */ }
    return json(200, { ok: true, provider: provider.name, result: parsed ?? { summary: text, actions: [] } });
  } catch (e) {
    return json(200, { ok: false, error: "ИИ не ответил: " + (e as Error).message.slice(0, 200) });
  }
});
