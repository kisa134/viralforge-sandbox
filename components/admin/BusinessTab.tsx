"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adviseRules, bizMetrics, calc, halloweenDaysLeft, nsm, pctChange, PRESETS, reverse, setBizSettings, unitEconomics, updateProductCosts,
  type BizMetrics, type BizProduct, type CalcIn, type Unit,
} from "@/lib/biz";

type Sub = "econ" | "nsm" | "calc" | "advisor";
const $ = (cents: number | null | undefined, digits = 2) =>
  cents === null || cents === undefined || !Number.isFinite(cents) ? "—" : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const n0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("ru-RU") : "∞");
const n1 = (x: number) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toLocaleString("ru-RU") : "∞");
const pct = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const NO_DATA = "данных пока нет";
const shortTitle = (t: string) => t.replace(/ By Likky$/i, "");

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = pctChange(cur, prev);
  if (cur === 0 && prev === 0) return <span className="bz-dim">{NO_DATA}</span>;
  if (d === null) return <span className="bz-up">новое</span>;
  return <span className={d > 0 ? "bz-up" : d < 0 ? "bz-down" : "bz-dim"}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d * 100).toFixed(0)}%</span>;
}

// ───────── Unit economics ─────────
function CostEditor({ c, p, onDone, toast }: { c: SupabaseClient; p: BizProduct; onDone: () => void; toast: (m: string) => void }) {
  const [cogs, setCogs] = useState(p.cogs_cents === null ? "" : (p.cogs_cents / 100).toFixed(2));
  const [ship, setShip] = useState(p.shipping_cost_cents === null ? "" : (p.shipping_cost_cents / 100).toFixed(2));
  const [dmin, setDmin] = useState(p.ship_days_min?.toString() ?? "");
  const [dmax, setDmax] = useState(p.ship_days_max?.toString() ?? "");
  const save = async () => {
    try {
      const toC = (v: string) => (v.trim() === "" ? "" : String(Math.round(Number(v.replace(",", ".")) * 100)));
      if ([cogs, ship].some((v) => v.trim() !== "" && !Number.isFinite(Number(v.replace(",", "."))))) throw new Error("Введите суммы в $");
      await updateProductCosts(c, p.id, { cogs_cents: toC(cogs), shipping_cost_cents: toC(ship), ship_days_min: dmin, ship_days_max: dmax });
      toast(`${shortTitle(p.title)}: себестоимость сохранена`); onDone();
    } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };
  return (
    <div className="bz-edit">
      <label>Товар CJ, $<input className="pt-input sm" inputMode="decimal" value={cogs} onChange={(e) => setCogs(e.target.value)} /></label>
      <label>Доставка в США, $<input className="pt-input sm" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)} /></label>
      <label>Дней от<input className="pt-input sm" inputMode="numeric" value={dmin} onChange={(e) => setDmin(e.target.value)} /></label>
      <label>до<input className="pt-input sm" inputMode="numeric" value={dmax} onChange={(e) => setDmax(e.target.value)} /></label>
      <button className="pt-btn sm primary" onClick={save}>💾</button>
    </div>
  );
}

function SettingsEditor({ c, m, onDone, toast }: { c: SupabaseClient; m: BizMetrics; onDone: () => void; toast: (msg: string) => void }) {
  const s = m.settings;
  const [fee, setFee] = useState(((s.payment_fee_pct ?? 0.029) * 100).toFixed(2));
  const [fix, setFix] = useState(((s.payment_fee_fixed_cents ?? 30) / 100).toFixed(2));
  const [ref, setRef] = useState(((s.refund_rate ?? 0.05) * 100).toFixed(1));
  const [fs, setFs] = useState(s.free_shipping_note ?? "");
  const save = async () => {
    try {
      const num = (v: string) => Number(v.replace(",", "."));
      if (![fee, fix, ref].every((v) => Number.isFinite(num(v)))) throw new Error("Введите числа");
      await setBizSettings(c, { payment_fee_pct: num(fee) / 100, payment_fee_fixed_cents: Math.round(num(fix) * 100), refund_rate: num(ref) / 100, free_shipping_note: fs });
      toast("Настройки экономики сохранены"); onDone();
    } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };
  return (
    <details className="bz-settings">
      <summary>⚙️ Допущения: комиссия {(s.payment_fee_pct * 100).toFixed(1)}% + {$(s.payment_fee_fixed_cents)}, возвраты {(s.refund_rate * 100).toFixed(0)}%, ставка креатора — в «Партнёрах»</summary>
      <div className="bz-edit">
        <label>Комиссия Shopify, %<input className="pt-input sm" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        <label>+ фикс, $<input className="pt-input sm" inputMode="decimal" value={fix} onChange={(e) => setFix(e.target.value)} /></label>
        <label>Возвраты (резерв), %<input className="pt-input sm" inputMode="decimal" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      </div>
      <label className="pt-label">Бесплатная доставка (заметка)<input className="pt-input" value={fs} maxLength={200} onChange={(e) => setFs(e.target.value)} placeholder="напр. «бесплатно от $50» — доставка уже в себестоимости" /></label>
      <button className="pt-btn primary" onClick={save}>Сохранить допущения</button>
    </details>
  );
}

function EconView({ c, m, units, reload, toast }: { c: SupabaseClient; m: BizMetrics; units: Unit[]; reload: () => void; toast: (x: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <section className="pt-card">
        <h3>🧮 Юнит-экономика (1 заказ = 1 товар)</h3>
        <p className="pt-dim pt-small">Себестоимость = товар CJ + доставка в США. Креатор — эффективная ставка ({m.settings.payout_rule === "PCT_MARGIN" ? `${((m.settings.payout_value ?? 0) * 100).toFixed(0)}% от маржи = (цена − себестоимость) × ${((m.settings.payout_value ?? 0) * 100).toFixed(0)}%` : m.settings.payout_rule === "PCT_REVENUE" ? `${((m.settings.payout_value ?? 0) * 100).toFixed(0)}% от суммы` : "фикс"}). Резерв на возвраты = {(m.settings.refund_rate * 100).toFixed(0)}% цены. <b>Max CPA</b> — сколько максимум можно отдать за заказ (креатору + реклама), чтобы выйти в ноль.</p>
        <div className="bz-tablewrap">
          <table className="bz-table">
            <thead><tr><th>Товар</th><th>Цена</th><th>Себест.</th><th>Креатор</th><th>Комиссия</th><th>Резерв</th><th>Прибыль</th><th>Маржа</th><th>Max CPA</th></tr></thead>
            <tbody>{units.map((u) => (
              <tr key={u.p.id} className={u.flags.some((f) => f.level === "bad") ? "bz-bad" : u.margin < 0.3 ? "bz-warn" : ""}>
                <td><b>{shortTitle(u.p.title)}</b></td><td>{$(u.price)}</td><td>{u.costMissing ? "—" : $(u.landed)}</td><td>{$(u.creator)}</td><td>{$(u.fee)}</td><td>{$(u.reserve)}</td>
                <td><b>{u.costMissing ? "—" : $(u.profit)}</b></td><td>{u.costMissing ? "—" : pct(u.margin, 0)}</td><td>{u.costMissing ? "—" : $(u.maxCpa)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>
      {units.map((u) => (
        <section className="pt-card bz-prod" key={u.p.id}>
          <div className="ad-head"><b>{shortTitle(u.p.title)}</b><span className="bz-big">{u.costMissing ? "—" : $(u.profit)}<small> / заказ</small></span></div>
          <div className="bz-line">
            <span>Цена {$(u.price)}</span><span>CJ {$(u.p.cogs_cents)} + доставка {$(u.p.shipping_cost_cents)} = <b>{$(u.landed)}</b></span>
            <span>Креатор {$(u.creator)}</span><span>Комиссия {$(u.fee)}</span><span>Резерв {$(u.reserve)}</span>
          </div>
          <div className="bz-line bz-dim">
            <span>Маржа <b>{pct(u.margin, 0)}</b></span><span>Max CPA {$(u.maxCpa)} (≈{pct(u.beRate, 0)} цены)</span>
            <span>Доставка {u.p.ship_days_min ?? "?"}–{u.p.ship_days_max ?? "?"} дн.{u.p.ship_method ? ` · ${u.p.ship_method}` : ""}</span>{u.p.cj_spu && <span>CJ {u.p.cj_spu}</span>}
          </div>
          {u.flags.map((f, i) => <div key={i} className={f.level === "bad" ? "pt-err" : "pt-info"}>{f.level === "bad" ? "⛔" : "⚠️"} {f.text}</div>)}
          {editing === u.p.id ? <CostEditor c={c} p={u.p} toast={toast} onDone={() => { setEditing(null); reload(); }} />
            : <button className="pt-linkbtn pt-small" onClick={() => setEditing(u.p.id)}>✏️ Изменить себестоимость / сроки</button>}
        </section>
      ))}
      <SettingsEditor c={c} m={m} onDone={reload} toast={toast} />
    </>
  );
}

// ───────── North Star ─────────
function NsmView({ m, units, periodDays }: { m: BizMetrics; units: Unit[]; periodDays: number | null }) {
  const t = m.totals, s = m.settings;
  const cur = nsm(t, s);
  const wc = nsm(m.wow.cur, s).value, wp = nsm(m.wow.prev, s).value;
  const has = t.clicks > 0 || t.orders > 0;
  const activeCr = m.creators.with_clicks;
  const days = periodDays ?? null;
  const cr = t.clicks ? t.orders / t.clicks : null;
  const aov = t.orders ? t.revenue_cents / t.orders : null;
  const margin = t.revenue_cents ? cur.value / t.revenue_cents : null;
  const ppd = t.posts && activeCr && days ? t.posts / activeCr / days : null;
  const cpp = t.posts ? t.clicks / t.posts : null;
  const maxW = Math.max(1, ...m.weeks.map((w) => Math.abs(nsm(w, s).value)));
  const planMargin = units.filter((u) => !u.costMissing).reduce((a, u, _, arr) => a + u.margin / arr.length, 0);
  const tree: [string, string, string][] = [
    ["👥 Активные креаторы", activeCr ? `${activeCr} из ${m.creators.active}` : m.creators.active ? `0 из ${m.creators.active} (кликов нет)` : NO_DATA, "с кликами за период"],
    ["🎬 Роликов на креатора в день", ppd !== null ? n1(ppd) : NO_DATA, t.posts ? `${t.posts} роликов` : "ролики пока не учитываются в базе"],
    ["👆 Кликов на ролик", cpp !== null ? n1(cpp) : t.clicks ? `${t.clicks} кликов (роликов нет)` : NO_DATA, `ссылок: ${t.links_total}`],
    ["🛒 Конверсия клик → заказ", cr !== null ? pct(cr, 2) : NO_DATA, t.clicks ? `${t.orders} из ${t.clicks}` : ""],
    ["💵 Средний чек (AOV)", aov !== null ? $(aov) : NO_DATA, ""],
    ["📊 Маржа после креаторов", margin !== null ? pct(margin, 0) : NO_DATA, `план по юнит-экономике ≈ ${pct(planMargin, 0)} (расчёт)`],
  ];
  return (
    <>
      <section className="pt-card bz-nsm">
        <div className="bz-kicker">⭐ North Star Metric</div>
        <h3>Валовая прибыль после выплат креаторам за неделю</h3>
        <div className="bz-nsm-row">
          <div><div className="bz-big">{has || wc || wp ? $(wc, 0) : NO_DATA}</div><div className="bz-dim pt-small">последние 7 дней</div></div>
          <div><div className="bz-mid">{$(wp, 0)}</div><div className="bz-dim pt-small">прошлые 7 дней</div></div>
          <div><div className="bz-mid"><Delta cur={wc} prev={wp} /></div><div className="bz-dim pt-small">неделя к неделе</div></div>
        </div>
        <p className="pt-dim pt-small">= выручка (без доставки и налога) − себестоимость с доставкой − выплаты креаторам − комиссия платёжки. Только заказы по ссылкам креаторов, без отмен.</p>
        <div className="bz-bars">{m.weeks.map((w) => { const v = nsm(w, s).value; return (
          <div key={w.week_start} className="bz-bar" title={`${w.week_start}: ${$(v, 0)}`}>
            <div className={`bz-bar-fill ${v < 0 ? "neg" : ""}`} style={{ height: `${Math.max(2, (Math.abs(v) / maxW) * 100)}%` }} />
            <span>{new Date(w.week_start).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })}</span>
          </div>); })}</div>
      </section>
      <section className="pt-card">
        <h3>🌳 Из чего складывается (за период)</h3>
        <p className="pt-dim pt-small">NSM = креаторы × ролики/день × клики/ролик × конверсия × средний чек × маржа</p>
        <div className="bz-tree">{tree.map(([k, v, h]) => (
          <div key={k} className="bz-node"><span>{k}</span><b className={v === NO_DATA ? "bz-dim" : ""}>{v}</b>{h && <small className="bz-dim">{h}</small>}</div>
        ))}</div>
      </section>
      <section className="pt-card">
        <h3>📋 Итоги за период</h3>
        {!has ? <p className="bz-dim">{NO_DATA} — кликов и заказов по ссылкам за этот период не было.</p> : (
          <div className="bz-kpis">
            <div><span>Клики</span><b>{n0(t.clicks)}</b><Delta cur={m.wow.cur.clicks} prev={m.wow.prev.clicks} /></div>
            <div><span>Заказы</span><b>{n0(t.orders)}</b><Delta cur={m.wow.cur.orders} prev={m.wow.prev.orders} /></div>
            <div><span>Выручка</span><b>{$(t.revenue_cents, 0)}</b><Delta cur={m.wow.cur.revenue_cents} prev={m.wow.prev.revenue_cents} /></div>
            <div><span>Себестоимость</span><b>{$(t.landed_cents, 0)}</b></div>
            <div><span>Креаторам</span><b>{$(t.commission_cents, 0)}</b></div>
            <div><span>Комиссия</span><b>{$(cur.fees, 0)}</b></div>
            <div><span>Прибыль после креаторов</span><b>{$(cur.value, 0)}</b></div>
            <div><span>Все заказы магазина</span><b>{n0(t.store_orders)}</b><small className="bz-dim">{$(t.store_revenue_cents, 0)}</small></div>
          </div>)}
        {m.top_creators.length > 0 && (
          <>
            <h4>Топ креаторов</h4>
            <table className="bz-table"><thead><tr><th>Креатор</th><th>Клики</th><th>Заказы</th><th>Выручка</th></tr></thead>
              <tbody>{m.top_creators.map((x) => <tr key={x.login}><td>@{x.login}</td><td>{x.clicks}</td><td>{x.orders}</td><td>{$(x.revenue_cents, 0)}</td></tr>)}</tbody></table>
          </>)}
        {m.products.some((p) => p.clicks || p.orders) && (
          <>
            <h4>По товарам</h4>
            <table className="bz-table"><thead><tr><th>Товар</th><th>Клики</th><th>Заказы</th><th>CR</th><th>Прибыль/клик</th></tr></thead>
              <tbody>{units.filter((u) => u.p.clicks || u.p.orders).map((u) => <tr key={u.p.id}><td>{shortTitle(u.p.title)}</td><td>{u.p.clicks}</td><td>{u.p.orders}</td>
                <td>{u.p.clicks ? pct(u.p.orders / u.p.clicks, 1) : "—"}</td><td>{u.p.clicks ? $((u.p.orders * u.profit) / u.p.clicks) : "—"}</td></tr>)}</tbody></table>
          </>)}
      </section>
    </>
  );
}

// ───────── Calculator ─────────
function Inp({ label, v, set, hint }: { label: string; v: string; set: (s: string) => void; hint?: string }) {
  return <label className="bz-in">{label}<input className="pt-input sm" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} />{hint && <small className="bz-dim">{hint}</small>}</label>;
}
type PeriodKind = "day" | "week" | "month" | "halloween" | "custom";
function CalcView({ m, units }: { m: BizMetrics; units: Unit[] }) {
  const live = useMemo(() => {
    const t = m.totals;
    return {
      cr: t.clicks >= 50 && t.orders > 0 ? (100 * t.orders) / t.clicks : null,
      cpp: t.posts > 0 && t.clicks > 0 ? t.clicks / t.posts : null,
      creators: m.creators.active || null,
      mix: t.orders > 0 ? Object.fromEntries(m.products.map((p) => [p.id, p.units])) : null,
    };
  }, [m]);
  const eqMix = useMemo(() => Object.fromEntries(units.map((u) => [u.p.id, 1])), [units]);
  const [preset, setPreset] = useState<keyof typeof PRESETS>("base");
  const [creators, setCreators] = useState(String(Math.max(10, live.creators ?? 0)));
  const [ppd, setPpd] = useState(String(PRESETS.base.postsPerDay));
  const [mode, setMode] = useState<"clicks" | "views">("clicks");
  const [cpp, setCpp] = useState(String(live.cpp ? Math.round(live.cpp) : PRESETS.base.clicksPerPost));
  const [views, setViews] = useState("3000");
  const [ctr, setCtr] = useState("1.5");
  const [crp, setCrp] = useState(String(live.cr ? +live.cr.toFixed(2) : PRESETS.base.crPct));
  const [mix, setMix] = useState<Record<string, number>>(live.mix ?? eqMix);
  const [period, setPeriod] = useState<PeriodKind>("halloween");
  const today = new Date().toISOString().slice(0, 10);
  const [d1, setD1] = useState(today);
  const [d2, setD2] = useState(today.slice(0, 4) + "-12-24");
  const [target, setTarget] = useState("5000");
  useEffect(() => { setMix((x) => (Object.keys(x).length ? x : live.mix ?? eqMix)); }, [eqMix, live.mix]);

  const applyPreset = (k: keyof typeof PRESETS) => { setPreset(k); setPpd(String(PRESETS[k].postsPerDay)); setCpp(String(PRESETS[k].clicksPerPost)); setCrp(String(PRESETS[k].crPct)); setMode("clicks"); };
  const hd = Math.max(0, halloweenDaysLeft());
  const days = period === "day" ? 1 : period === "week" ? 7 : period === "month" ? 30 : period === "halloween" ? hd
    : Math.max(0, Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000) + 1);
  const num = (v: string) => { const x = Number(v.replace(",", ".")); return Number.isFinite(x) && x >= 0 ? x : 0; };
  const input: CalcIn = { creators: num(creators), postsPerDay: num(ppd), clicksPerPost: mode === "clicks" ? num(cpp) : (num(views) * num(ctr)) / 100, crPct: num(crp), days, mix };
  const usable = units.filter((u) => !u.costMissing);
  const out = calc(input, usable);
  const rev = reverse(num(target) * 100, input, usable);
  return (
    <>
      <section className="pt-card">
        <h3>🧮 Калькулятор заработка</h3>
        <div className="pt-info">Это <b>допущения, а не факты</b>. Пресеты — примерные ориентиры для коротких роликов{live.cr || live.cpp ? "; поля с пометкой «из базы» заполнены живыми данными" : "; живых данных пока мало, поэтому стоят ориентиры"}.</div>
        <div className="pt-seg">{(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => <button key={k} className={preset === k ? "on" : ""} onClick={() => applyPreset(k)}>{PRESETS[k].label}</button>)}</div>
        <p className="pt-dim pt-small">Пресет «{PRESETS[preset].label}»: {PRESETS[preset].postsPerDay} ролика/день, {PRESETS[preset].clicksPerPost} кликов/ролик, конверсия {PRESETS[preset].crPct}% — допущения.</p>
        <div className="bz-grid">
          <Inp label="Креаторов" v={creators} set={setCreators} hint={live.creators ? `сейчас активных: ${live.creators}` : undefined} />
          <Inp label="Роликов на креатора в день" v={ppd} set={setPpd} />
          <label className="bz-in">Считать от<select className="pt-input sm" value={mode} onChange={(e) => setMode(e.target.value as "clicks" | "views")}><option value="clicks">кликов на ролик</option><option value="views">просмотров × CTR</option></select></label>
          {mode === "clicks" ? <Inp label="Кликов на ролик" v={cpp} set={setCpp} hint={live.cpp ? "из базы" : "допущение"} />
            : <><Inp label="Просмотров на ролик" v={views} set={setViews} /><Inp label="CTR в ссылку, %" v={ctr} set={setCtr} hint="допущение" /></>}
          <Inp label="Конверсия клик→заказ, %" v={crp} set={setCrp} hint={live.cr ? "из базы" : "допущение"} />
          <label className="bz-in">Период<select className="pt-input sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKind)}>
            <option value="day">день</option><option value="week">неделя</option><option value="month">месяц (30 дн.)</option>
            <option value="halloween">до Хэллоуина ({hd} дн.)</option><option value="custom">свои даты</option></select></label>
          {period === "custom" && <><label className="bz-in">С<input className="pt-input sm" type="date" value={d1} onChange={(e) => setD1(e.target.value)} /></label>
            <label className="bz-in">По<input className="pt-input sm" type="date" value={d2} onChange={(e) => setD2(e.target.value)} /></label></>}
        </div>
        <details className="bz-settings"><summary>🛍 Микс товаров (доля заказов){live.mix ? " — из базы" : " — поровну"} · средний чек {$(out.aov)}</summary>
          <div className="bz-grid">{units.map((u) => (
            <label className="bz-in" key={u.p.id}>{shortTitle(u.p.title)} {u.costMissing && "(нет себест.)"}<input className="pt-input sm" inputMode="decimal" value={String(mix[u.p.id] ?? 0)} onChange={(e) => setMix({ ...mix, [u.p.id]: num(e.target.value) })} /></label>))}</div>
          <p className="pt-dim pt-small">Себестоимость, ставка креатора, комиссия и резерв — из «Юнит-экономики».</p>
        </details>
      </section>
      <section className="pt-card bz-out">
        <h3>Результат за {days} {days === 1 ? "день" : "дн."}</h3>
        {days === 0 ? <p className="bz-dim">Период закончился — выбери другой.</p> : (
          <div className="bz-kpis">
            <div><span>Роликов</span><b>{n0(out.posts)}</b></div><div><span>Кликов</span><b>{n0(out.clicks)}</b></div>
            <div><span>Заказов</span><b>{n1(out.orders)}</b></div><div><span>Выручка</span><b>{$(out.revenue * 1, 0)}</b></div>
            <div><span>Себестоимость</span><b>{$(out.cogs, 0)}</b></div><div><span>Креаторам</span><b>{$(out.payouts, 0)}</b></div>
            <div><span>Комиссия + резерв</span><b>{$(out.fees + out.reserve, 0)}</b></div>
            <div className="bz-hi"><span>Чистая прибыль</span><b>{$(out.profit, 0)}</b></div>
            <div><span>Прибыль на креатора</span><b>{$(out.perCreator, 0)}</b></div><div><span>Прибыль с заказа</span><b>{$(out.profitPerOrder)}</b></div>
            <div><span>Креатор зарабатывает</span><b>{$(input.creators ? out.payouts / input.creators : 0, 0)}</b></div>
          </div>)}
      </section>
      <section className="pt-card">
        <h3>🎯 Обратный расчёт: хочу заработать</h3>
        <div className="bz-grid"><Inp label={`Чистая прибыль за ${days} дн., $`} v={target} set={setTarget} /></div>
        {!rev || days === 0 ? <p className="bz-dim">Нужны период &gt; 0 и прибыльный микс товаров.</p> : (
          <ul className="bz-rev">
            <li>Нужно <b>{n0(Math.ceil(rev.orders))}</b> заказов ({$(out.profitPerOrder)} прибыли с каждого)</li>
            <li>= <b>{n0(rev.clicks)}</b> кликов при конверсии {input.crPct}%</li>
            <li>= <b>{n0(rev.posts)}</b> роликов при {n1(input.clicksPerPost)} кликах на ролик</li>
            <li>= <b>{n0(Math.ceil(rev.creators))}</b> креаторов при {input.postsPerDay} ролика/день — или по <b>{n1(rev.postsPerCreatorDay)}</b> ролика/день у твоих {input.creators}</li>
          </ul>)}
      </section>
    </>
  );
}

// ───────── Advisor ─────────
type AiResult = { summary?: string; actions?: { title: string; why?: string; priority?: number }[] };
function AdvisorView({ c, m, units, period, periodDays }: { c: SupabaseClient; m: BizMetrics; units: Unit[]; period: string; periodDays: number | null }) {
  const rules = useMemo(() => adviseRules(m, units, periodDays), [m, units, periodDays]);
  const [ai, setAi] = useState<{ configured: boolean; message?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiResult | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    c.functions.invoke("advisor", { body: { action: "status" } }).then(({ data }) => setAi({ configured: !!data?.configured, message: data?.message })).catch(() => setAi({ configured: false }));
  }, [c]);
  const ask = async () => {
    setBusy(true); setErr(""); setRes(null);
    const { data, error } = await c.functions.invoke("advisor", { body: { action: "analyze", period, rules: rules.map((r) => r.title) } });
    if (error || !data?.ok) setErr(data?.error || error?.message || "Ошибка"); else setRes(data.result);
    setBusy(false);
  };
  return (
    <>
      <section className="pt-card">
        <h3>🧭 Советник — что делать сейчас</h3>
        <p className="pt-dim pt-small">Правила по живым данным ({period === "all" ? "всё время" : `${period} дн.`}), по приоритету. Обновляется при каждом открытии.</p>
        <ol className="bz-adv">{rules.map((r, i) => (
          <li key={i} className={`p${r.prio}`}><div className="bz-adv-t">{r.icon} <b>{r.title}</b>{r.prio === 1 && <span className="bz-tag">срочно</span>}</div><div className="bz-dim pt-small">{r.why}</div></li>
        ))}</ol>
      </section>
      <section className="pt-card">
        <h3>🤖 Разбор от ИИ</h3>
        {ai === null ? <p className="bz-dim">Проверяю…</p> : !ai.configured ? (
          <p className="bz-dim pt-small">ИИ-разбор пока выключен: нужен ключ ИИ (подключит команда). Правила выше работают без него.</p>
        ) : (
          <>
            <p className="pt-dim pt-small">Отправляются только агрегированные цифры (без логинов и контактов).</p>
            <button className="pt-btn primary wide" disabled={busy} onClick={ask}>{busy ? "Думаю…" : "🤖 Разобрать метрики"}</button>
          </>)}
        {err && <div className="pt-err">{err}</div>}
        {res && (
          <div className="bz-ai">
            {res.summary && <p>{res.summary}</p>}
            <ol className="bz-adv">{(res.actions ?? []).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).map((a, i) => <li key={i}><b>{a.title}</b>{a.why && <div className="bz-dim pt-small">{a.why}</div>}</li>)}</ol>
          </div>)}
      </section>
    </>
  );
}

export function BusinessTab({ c, toast }: { c: SupabaseClient; toast: (m: string) => void }) {
  const [sub, setSub] = useState<Sub>("econ");
  const [period, setPeriod] = useState("30");
  const [m, setM] = useState<BizMetrics | null>(null);
  const [err, setErr] = useState("");
  const toastRef = useRef(toast); toastRef.current = toast;
  const periodDays = period === "all" ? null : Number(period);
  const load = useCallback(async () => {
    setErr("");
    try { setM(await bizMetrics(c, period === "all" ? null : new Date(Date.now() - Number(period) * 86400000).toISOString())); }
    catch (e) { setErr((e as Error).message); }
  }, [c, period]);
  useEffect(() => { load(); }, [load]);
  const units = useMemo(() => (m ? m.products.map((p) => unitEconomics(p, m.settings)) : []), [m]);
  return (
    <div className="bz">
      <nav className="pt-seg bz-sub">
        {([["econ", "🧮 Юнит-экономика"], ["nsm", "⭐ NSM"], ["calc", "💰 Калькулятор"], ["advisor", "🧭 Советник"]] as [Sub, string][]).map(([k, l]) =>
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>)}
      </nav>
      {(sub === "nsm" || sub === "advisor") && (
        <div className="pt-seg">{[["7", "7 дней"], ["30", "30 дней"], ["all", "Всё время"]].map(([k, l]) => <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}
          <button onClick={load} title="Обновить">🔄</button></div>)}
      {err && <div className="pt-err">{err}</div>}
      {!m ? <div className="pt-loading">Загрузка…</div> : sub === "econ" ? <EconView c={c} m={m} units={units} reload={load} toast={(x) => toastRef.current(x)} />
        : sub === "nsm" ? <NsmView m={m} units={units} periodDays={periodDays} />
        : sub === "calc" ? <CalcView m={m} units={units} />
        : <AdvisorView c={c} m={m} units={units} period={period} periodDays={periodDays} />}
    </div>
  );
}
