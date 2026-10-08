# ViralForge · SANDBOX v1 (web chat)

Founder review build. **No Higgsfield / Apify live calls. No real payouts.**

Aligns with `../MVP_LOCK.md` · `../APP_WIREFLOW.md` · `../formula-cards.example.json`.

## URL

```
http://127.0.0.1:3456
```

Also bound on `0.0.0.0:3456` (LAN / port-forward / Cursor Simple Browser).

## How founder opens

1. Open **http://127.0.0.1:3456** in a browser.
2. Top banner must say **SANDBOX v1**.
3. Click through the 5 steps below (or type the same intents).

## Run / restart

```bash
cd /workspace/deliverables/viralforge/app
npm install
npm run dev
```

Dev script: `next dev -H 0.0.0.0 -p 3456`

## 5 clickable steps for founder

1. **Онбординг** — ниша `🏠 Decor/Home` → гео `US` → `@glow.home.us (demo)`  
2. **✅ Claim** — оффер **Sandbox Glow Dragon Lamp** · $29.99 · CPA **$8** · claim-strip *warm glow only / no flame breath*  
3. **🎬 Сделай видосы** — ~8с симуляция → **3 stub-клипа** (keywords **GLOW / BUNDLE / GIFT** из formula-cards)  
4. **🔗 Мои ссылки** — `https://vf.demo/r/demo123`  
5. **Выплаты** — «пока sandbox — выплат нет» · Sheet ledger stub  

Optional: `Запостил #1` → DM-скрипт с той же ссылкой.

## Out of scope (day-1)

- Live Shopify / Wise / USDT / PayPal  
- Higgsfield credit spend  
- Postgres / BullMQ / auth  
- Telegram bot  

## Stack

Next.js 14 App Router · React 18 · TypeScript · CSS

## Analytics cabinet (`/analytics`)

- Live: https://kisa134.github.io/viralforge-sandbox/analytics/ · guide: https://kisa134.github.io/viralforge-sandbox/guide/ (first-visit tours on chat + cabinet, «🧭 Тур» to replay)
- Data source toggle **Демо / Мои CSV / База**: `demo.ts` — generated example (labelled DEMO everywhere) · `workspace.ts` — browser workspace (localStorage): creators, `LIKKY-<NICK>` promo codes, Shopify discount links, Shopify orders CSV import attributed by *Discount Code*, payouts, JSON backup · `supabase.ts` + `manage.ts` — live Supabase (magic-link login, admin-only RLS)
- Supabase project `wdvwinmsdkortvchkgxe`: migrations in `supabase/migrations/`, edge functions `supabase/functions/r` (click redirect `…/functions/v1/r?s=<slug>`) and `supabase/functions/shopify-orders-webhook` (HMAC, `SHOPIFY_WEBHOOK_SECRET`)
- Founder go-live checklist (RU): `docs/GO_LIVE.md` · spec: `docs/ANALYTICS_SYSTEM.md` · schema copy: `db/analytics_schema.sql`
- Build uses repo secrets `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key; safe in the browser because RLS allows only emails in `admins`)
