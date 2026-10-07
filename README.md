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
