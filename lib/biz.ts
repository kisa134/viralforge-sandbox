// «📈 Бизнес»: unit economics, North Star Metric, calculator and rule-based advisor (pure functions, no I/O except RPC wrappers).
import type { SupabaseClient } from "@supabase/supabase-js";

export type BizSettings = { payout_rule: string; payout_value: number | null; payment_fee_pct: number; payment_fee_fixed_cents: number; refund_rate: number; free_shipping_note: string; hold_days: number };
export type BizProduct = {
  id: string; title: string; handle: string; price_cents: number; cogs_cents: number | null; shipping_cost_cents: number | null; cj_spu: string | null;
  ship_days_min: number | null; ship_days_max: number | null; ship_method: string | null; cost_note: string | null; image_url: string | null;
  payout_rule: string | null; payout_value: number | null; clicks: number; orders: number; units: number; revenue_cents: number; links: number;
};
export type Flow = { clicks: number; orders: number; revenue_cents: number; total_cents: number; landed_cents: number; commission_cents: number; active_creators?: number };
export type BizMetrics = {
  generated_at: string; from: string | null; settings: BizSettings;
  totals: Flow & { commissions_needs_review?: number; orders_cost_missing: number; store_orders: number; store_revenue_cents: number; refunded_orders: number; posts: number; links_created: number; links_total: number; last_click_at: string | null; last_order_at: string | null };
  creators: { active: number; pending: number; blocked: number; with_links: number; with_clicks: number; with_orders: number; inactive_7d: number };
  top_creators: { login: string; clicks: number; orders: number; revenue_cents: number }[];
  products: BizProduct[]; weeks: (Flow & { week_start: string })[]; wow: { cur: Flow; prev: Flow };
};

export const bizMetrics = async (c: SupabaseClient, from: string | null) => {
  const { data, error } = await c.rpc("admin_biz_metrics", { p_from: from });
  if (error) throw new Error(error.message);
  return data as BizMetrics;
};
export const updateProductCosts = async (c: SupabaseClient, id: string, p: Record<string, unknown>) => {
  const { error } = await c.rpc("admin_update_product_costs", { p_product: id, p });
  if (error) throw new Error(error.message);
};
export const addProduct = async (c: SupabaseClient, p: Record<string, unknown>) => {
  const { data, error } = await c.rpc("admin_add_product", { p });
  if (error) throw new Error(error.message);
  return data as string;
};

/** Recommended creator payout: ~15% of gross margin (price − landed COGS), range 10–20%. Final payout is whatever admins enter. */
export const MIN_PROFIT_CENTS = 1000, MIN_MARGIN = 0.25;
export function recommendPayout(priceC: number, landedC: number, s: Pick<BizSettings, "payment_fee_pct" | "payment_fee_fixed_cents" | "refund_rate">) {
  const gross = Math.max(0, priceC - landedC);
  const fee = Math.round(priceC * (s.payment_fee_pct ?? 0.029)) + (s.payment_fee_fixed_cents ?? 30);
  const reserve = Math.round(priceC * (s.refund_rate ?? 0.05));
  const maxCpa = priceC - landedC - fee - reserve;
  const at = (pct: number) => Math.round(gross * pct);
  return { gross, fee, reserve, maxCpa, rec: at(0.15), lo: at(0.1), hi: at(0.2) };
}
export function profitAfter(priceC: number, maxCpa: number, payoutC: number) {
  const profit = maxCpa - payoutC;
  return { profit, margin: priceC ? profit / priceC : 0, lowProfit: profit < MIN_PROFIT_CENTS, lowMargin: priceC ? profit / priceC < MIN_MARGIN : true };
}

export const setBizSettings = async (c: SupabaseClient, p: Record<string, unknown>) => {
  const { error } = await c.rpc("admin_set_biz_settings", { p });
  if (error) throw new Error(error.message);
};

// ── Unit economics (per 1 order of 1 unit at list price; free shipping for the buyer) ──
export type Unit = {
  p: BizProduct; price: number; landed: number; creator: number; fee: number; reserve: number; profit: number; margin: number;
  maxCpa: number; beRate: number; costMissing: boolean; flags: { level: "warn" | "bad"; text: string }[];
};
export const THIN_MARGIN = 0.3;
export function creatorCents(rule: string | null, value: number | null, priceCents: number, landedCents = 0) {
  if (value === null || value === undefined) return 0;
  if (rule === "CPA_FIXED") return Math.round(Number(value) * 100);
  if (rule === "PCT_REVENUE") return Math.round(priceCents * Number(value));
  if (rule === "PCT_MARGIN") return Math.round(Math.max(0, priceCents - landedCents) * Number(value));   // margin = price − landed COGS
  return 0;
}
export function unitEconomics(p: BizProduct, s: BizSettings): Unit {
  const price = p.price_cents;
  const landed = (p.cogs_cents ?? 0) + (p.shipping_cost_cents ?? 0);
  const creator = creatorCents(p.payout_rule, p.payout_value, price, landed);
  const fee = Math.round(price * (s.payment_fee_pct ?? 0.029)) + (s.payment_fee_fixed_cents ?? 30);
  const reserve = Math.round(price * (s.refund_rate ?? 0.05));
  const maxCpa = price - landed - fee - reserve;
  const profit = maxCpa - creator;
  const flags: Unit["flags"] = [];
  const costMissing = p.cogs_cents === null;
  if (costMissing) flags.push({ level: "bad", text: "Нет себестоимости — впиши цену CJ" });
  if (p.payout_value === null || p.payout_value === undefined) flags.push({ level: "bad", text: "Не задана выплата креатору — партнёры видят «ставка уточняется», продажи уходят «на проверку»" });
  const margin = price ? profit / price : 0;
  if (!costMissing && profit <= 0) flags.push({ level: "bad", text: "Убыточен на каждом заказе" });
  else if (!costMissing && margin < THIN_MARGIN) flags.push({ level: "warn", text: `Тонкая маржа ${(margin * 100).toFixed(0)}% — поднять цену, взять меньший размер или поторговаться с CJ` });
  if ((p.ship_days_max ?? 0) >= 15) flags.push({ level: "warn", text: `Доставка ${p.ship_days_min}–${p.ship_days_max} дн. — риск возвратов и чарджбэков, укажи сроки на странице` });
  if (p.cost_note) flags.push({ level: "warn", text: p.cost_note });
  return { p, price, landed, creator, fee, reserve, profit, margin, maxCpa, beRate: price ? maxCpa / price : 0, costMissing, flags };
}

// ── North Star: gross profit after creator payouts (revenue − landed COGS − creator payouts − payment fees) ──
export function nsm(f: Flow, s: BizSettings) {
  const fees = Math.round(f.total_cents * (s.payment_fee_pct ?? 0.029)) + f.orders * (s.payment_fee_fixed_cents ?? 30);
  return { value: f.revenue_cents - f.landed_cents - f.commission_cents - fees, fees };
}
export const pctChange = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : (cur - prev) / Math.abs(prev));

// ── Calculator ──
export type CalcIn = { creators: number; postsPerDay: number; clicksPerPost: number; crPct: number; days: number; mix: Record<string, number> };
export type CalcOut = { posts: number; clicks: number; orders: number; revenue: number; cogs: number; payouts: number; fees: number; reserve: number; profit: number; perCreator: number; profitPerOrder: number; aov: number };
export function mixUnit(units: Unit[], mix: Record<string, number>) {
  const w = units.map((u) => Math.max(0, mix[u.p.id] ?? 0));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const avg = (k: keyof Pick<Unit, "price" | "landed" | "creator" | "fee" | "reserve" | "profit">) => units.reduce((a, u, i) => a + u[k] * (w[i] / sum), 0);
  return { price: avg("price"), landed: avg("landed"), creator: avg("creator"), fee: avg("fee"), reserve: avg("reserve"), profit: avg("profit") };
}
export function calc(i: CalcIn, units: Unit[]): CalcOut {
  const m = mixUnit(units, i.mix);
  const posts = i.creators * i.postsPerDay * i.days;
  const clicks = posts * i.clicksPerPost;
  const orders = clicks * (i.crPct / 100);
  return {
    posts, clicks, orders, revenue: orders * m.price, cogs: orders * m.landed, payouts: orders * m.creator, fees: orders * m.fee, reserve: orders * m.reserve,
    profit: orders * m.profit, perCreator: i.creators ? (orders * m.profit) / i.creators : 0, profitPerOrder: m.profit, aov: m.price,
  };
}
/** Reverse: target profit (cents) → required orders / clicks / posts / creators (given other inputs). */
export function reverse(targetCents: number, i: CalcIn, units: Unit[]) {
  const m = mixUnit(units, i.mix);
  if (m.profit <= 0) return null;
  const orders = targetCents / m.profit;
  const clicks = i.crPct > 0 ? orders / (i.crPct / 100) : Infinity;
  const posts = i.clicksPerPost > 0 ? clicks / i.clicksPerPost : Infinity;
  const creators = i.postsPerDay > 0 && i.days > 0 ? posts / (i.postsPerDay * i.days) : Infinity;
  return { orders, clicks, posts, creators, postsPerCreatorDay: i.creators > 0 && i.days > 0 ? posts / (i.creators * i.days) : Infinity };
}
export const PRESETS = {
  pess: { label: "😟 Пессимистично", postsPerDay: 1, clicksPerPost: 15, crPct: 0.5 },
  base: { label: "🙂 База", postsPerDay: 1.5, clicksPerPost: 50, crPct: 1.2 },
  opt: { label: "🚀 Оптимистично", postsPerDay: 2, clicksPerPost: 150, crPct: 2 },
} as const;

// ── Dates ──
export function halloweenDaysLeft(now = new Date()) {
  const y = now.getFullYear();
  const end = new Date(`${y}-10-31T23:59:59+04:00`);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

// ── Rule-based advisor ──
export type Advice = { prio: number; icon: string; title: string; why: string };
const usdS = (c: number) => `$${(c / 100).toFixed(2)}`;
export function adviseRules(m: BizMetrics, units: Unit[], periodDays: number | null, now = new Date()): Advice[] {
  const out: Advice[] = [];
  const t = m.totals, cr = m.creators;
  const hd = halloweenDaysLeft(now);
  const valid = units.filter((u) => !u.costMissing);

  if (cr.pending > 0) out.push({ prio: 1, icon: "📝", title: `Одобри ${cr.pending} ${plural(cr.pending, "заявку", "заявки", "заявок")} креаторов`, why: "Каждый день ожидания — потерянные ролики. Вкладка «Заявки»." });

  if (hd > 0) {
    const late = units.filter((u) => (u.p.ship_days_max ?? 0) > 0 && (u.p.ship_days_max ?? 0) >= hd);
    out.push({ prio: hd <= 10 ? 1 : 2, icon: "🎃", title: `До Хэллоуина ${hd} ${plural(hd, "день", "дня", "дней")} — максимум роликов сейчас`,
      why: `Хэллоуин-спрос сгорает 31 окт.${late.length ? ` ${late.map((u) => u.p.title).join(", ")} уже не успевает доехать (доставка до ${Math.max(...late.map((u) => u.p.ship_days_max ?? 0))} дн.) — не продвигай к празднику.` : ""} С ~25 окт. готовь рождественские SKU.` });
  } else {
    out.push({ prio: 1, icon: "🎄", title: "Хэллоуин прошёл — переключай креаторов на рождественские товары", why: "Хэллоуин-SKU после 31 окт. почти не продаются. Добавь Christmas-товары в каталог и раздай новые ТЗ." });
  }

  for (const u of units.filter((x) => (x.p.ship_days_max ?? 0) >= 15))
    out.push({ prio: 2, icon: "🐢", title: `${u.p.title}: доставка ${u.p.ship_days_min}–${u.p.ship_days_max} дн.`, why: "Долгая доставка = возвраты и чарджбэки. Пиши срок на странице товара, ищи склад в США или снизь приоритет в роликах." });
  for (const u of valid.filter((x) => x.margin < THIN_MARGIN))
    out.push({ prio: 2, icon: "⚠️", title: `${u.p.title}: прибыль ${usdS(u.profit)} с заказа (${(u.margin * 100).toFixed(0)}%)`, why: `Себестоимость с доставкой ${usdS(u.landed)} из ${usdS(u.price)}. Подними цену, возьми размер дешевле у CJ или не делай его основным.` });
  if ((t.commissions_needs_review ?? 0) > 0)
    out.push({ prio: 1, icon: "🧾", title: `${t.commissions_needs_review} начислений ждут проверки`, why: "У товара в заказе не задана выплата креатору. Задай «Выплата за продажу, $» в «Юнит-экономике», затем пересчитай заказ в /analytics (ручная привязка)." });
  const noPay = units.filter((u) => u.p.payout_value === null || u.p.payout_value === undefined);
  if (noPay.length) out.push({ prio: 1, icon: "💵", title: `Задай выплату креатору: ${noPay.map((u) => u.p.title).join(", ")}`, why: "Без суммы партнёры видят «ставка уточняется» и не продвигают товар." });
  for (const u of valid.filter((x) => x.p.payout_value !== null && x.profit < MIN_PROFIT_CENTS))
    out.push({ prio: 2, icon: "💸", title: `${u.p.title}: наша прибыль ${usdS(u.profit)} с заказа — меньше $10`, why: `Выплата креатору ${usdS(u.creator)}. Проверь цену и выплату.` });
  if (t.orders_cost_missing > 0 || units.some((u) => u.costMissing))
    out.push({ prio: 2, icon: "🧾", title: "Впиши себестоимость всех товаров", why: "Без неё прибыль и советы неточны." });

  // product with best profit per click (live) or best unit profit (plan)
  const withClicks = valid.filter((u) => u.p.clicks >= 30);
  if (withClicks.length) {
    const best = withClicks.map((u) => ({ u, ppc: (u.p.orders * u.profit) / u.p.clicks })).sort((a, b) => b.ppc - a.ppc)[0];
    if (best.ppc > 0) out.push({ prio: 2, icon: "🏆", title: `Толкай «${best.u.p.title}» — ${usdS(best.ppc)} прибыли на клик`, why: `${best.u.p.orders} заказ(ов) из ${best.u.p.clicks} кликов. Попроси креаторов делать больше роликов с ним.` });
  } else if (valid.length) {
    const best = [...valid].sort((a, b) => b.profit - a.profit)[0];
    out.push({ prio: 3, icon: "🏆", title: `Ставь в приоритет «${best.p.title}» — ${usdS(best.profit)} прибыли с заказа`, why: "Пока кликов мало, выбираем по юнит-экономике (это расчёт, не факт продаж). Пересмотрим, когда будет ≥30 кликов на товар." });
  }

  if (t.clicks >= 100 && t.orders === 0) out.push({ prio: 1, icon: "🚨", title: `${t.clicks} кликов и ни одного заказа`, why: "Проверь страницу товара на телефоне: скорость, цена, отзывы, доставка, оформление заказа. Проверь, что ссылки ведут на нужный товар." });
  else if (t.clicks >= 100 && t.orders / t.clicks < 0.008) out.push({ prio: 1, icon: "📉", title: `Конверсия ${(100 * t.orders / t.clicks).toFixed(2)}% — ниже 0,8%`, why: "Посетители не покупают: проверь цену, фото, отзывы, сроки доставки и соответствие ролика товару." });

  const top = m.top_creators[0];
  if (top && t.revenue_cents > 0 && t.orders >= 3 && top.revenue_cents / t.revenue_cents >= 0.5)
    out.push({ prio: 2, icon: "🧬", title: `Один креатор даёт ${Math.round(100 * top.revenue_cents / t.revenue_cents)}% выручки — копируй формулу`, why: `@${top.login}: ${top.orders} заказ(ов). Разбери его ролики (хук, длина, товар) и раздай как ТЗ остальным.` });

  if (cr.inactive_7d > 0) out.push({ prio: 2, icon: "😴", title: `${cr.inactive_7d} ${plural(cr.inactive_7d, "креатор", "креатора", "креаторов")} без кликов 7+ дней`, why: "Напиши им: нужна ли помощь, дай свежие ТЗ. Если молчат — освободи место для новых." });
  const noLinks = cr.active - cr.with_links;
  if (noLinks > 0) out.push({ prio: 2, icon: "🔗", title: `${noLinks} ${plural(noLinks, "одобренный креатор", "одобренных креатора", "одобренных креаторов")} ещё не сделали ссылку`, why: "Без ссылки продажи не засчитаются. Напомни зайти в кабинет и взять ссылку." });
  if (cr.active < 10) out.push({ prio: cr.active === 0 ? 1 : 3, icon: "📣", title: `Активных креаторов: ${cr.active} — набери хотя бы 10`, why: "Продажи растут от числа роликов. Скинь ссылку на /guide/creator в чатах креаторов." });

  const nCur = nsm(m.wow.cur, m.settings).value, nPrev = nsm(m.wow.prev, m.settings).value;
  if (nPrev > 0 && nCur < nPrev * 0.7) out.push({ prio: 1, icon: "📉", title: `Прибыль за 7 дней упала на ${Math.round(100 * (1 - nCur / nPrev))}%`, why: "Смотри, кто из креаторов перестал постить и какой товар просел." });
  if (t.refunded_orders > 0 && t.orders + t.refunded_orders > 0) {
    const rr = t.refunded_orders / (t.orders + t.refunded_orders);
    if (rr > (m.settings.refund_rate ?? 0.05)) out.push({ prio: 2, icon: "↩️", title: `Возвраты ${(rr * 100).toFixed(0)}% — выше допущения ${((m.settings.refund_rate ?? 0.05) * 100).toFixed(0)}%`, why: "Обнови допущение в настройках и разберись с причинами (сроки, качество, ожидания из ролика)." });
  }
  if (t.clicks === 0 && t.orders === 0)
    out.push({ prio: 3, icon: "🎯", title: "Данных пока нет — первая цель: 100 кликов и первый заказ", why: periodDays ? `За выбранные ${periodDays} дн. кликов не было.` : "Кликов по ссылкам ещё не было." });

  return out.sort((a, b) => a.prio - b.prio).slice(0, 7);
}
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
