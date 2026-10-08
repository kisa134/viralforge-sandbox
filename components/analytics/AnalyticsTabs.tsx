"use client";

import type { Dataset } from "@/lib/analytics/model";
import {
  RECRUIT_STEPS, creatorHealth, creatorTable, formulaTable, funnel, money, ratio, recruitTable, type Period,
} from "@/lib/analytics/metrics";

export const nf = new Intl.NumberFormat("ru-RU");
export const fmtN = (v: number | null | undefined) => (v === null || v === undefined ? "—" : nf.format(Math.round(v)));
export const fmtUsd = (c: number | null | undefined) =>
  c === null || c === undefined ? "—" : (c < 0 ? "−$" : "$") + new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100);
export const fmtPct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : (v * 100).toFixed(digits) + "%");
export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Asia/Dubai" }) : "—");

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="an-kpi">
      <div className="an-kpi-label">{label}</div>
      <div className="an-kpi-value">{value}</div>
      {sub && <div className="an-kpi-sub">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, label, right }: { value: number; max: number; label: string; right: string }) {
  const w = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="an-bar-row">
      <div className="an-bar-label">{label}</div>
      <div className="an-bar-track"><div className="an-bar-fill" style={{ width: `${w}%` }} /></div>
      <div className="an-bar-right">{right}</div>
    </div>
  );
}

export function DemoTag({ demo }: { demo: boolean }) {
  return demo ? <span className="an-demo-tag">ПРИМЕР</span> : null;
}

export function FunnelTab({ d, demo }: { d: Dataset; demo: boolean }) {
  const steps = funnel(d);
  const m = money(d);
  const top = Math.max(...steps.map((s) => s.value ?? 0));
  return (
    <section>
      <h2>Сквозная воронка <DemoTag demo={demo} /></h2>
      <div className="an-kpis">
        <Kpi label="Заказы атриб. / всего" value={`${fmtN(m.attributed_orders)} / ${fmtN(m.orders)}`} sub={`органика ${fmtPct(ratio(m.orders - m.attributed_orders, m.orders))}`} />
        <Kpi label="Net revenue" value={fmtUsd(m.net_cents)} sub={`возвраты ${fmtUsd(m.refunds_cents)}`} />
        <Kpi label="Маржа" value={fmtUsd(m.margin_cents)} sub={m.margin_cents === null ? "нужен COGS" : "после COGS"} />
        <Kpi label="Profit after creators" value={fmtUsd(m.profit_cents)} sub="маржа − комиссии − контент − найм" />
        <Kpi label="CAC per sale" value={fmtUsd(m.cac_per_sale_cents)} sub="(комиссии + контент + найм) / заказы" />
        <Kpi label="ROMI" value={m.romi === null ? "—" : fmtPct(m.romi, 0)} />
      </div>
      <div className="an-card">
        {steps.map((s, i) => {
          const prev = steps.slice(0, i).reverse().find((p) => p.value !== null && !["accrued", "paid", "refunds"].includes(p.key));
          const conv = s.value !== null && prev && prev.value && !["accrued", "paid", "trends", "formulas", "scenarios", "assets", "views", "kw"].includes(s.key) ? s.value / prev.value : null;
          return (
            <div key={s.key} className="an-funnel-row">
              <div className="an-funnel-label">{s.label}<span className="an-hint">{s.hint}</span></div>
              <div className="an-bar-track"><div className="an-bar-fill" style={{ width: s.value ? `${Math.max(1.5, (Math.log10(s.value + 1) / Math.log10(top + 1)) * 100)}%` : "0%" }} /></div>
              <div className="an-funnel-val">{s.key === "accrued" || s.key === "paid" ? (s.value === null ? "—" : "$" + fmtN(s.value)) : fmtN(s.value)}</div>
              <div className="an-funnel-conv">{conv === null ? "" : fmtPct(conv, conv < 0.01 ? 2 : 1)}</div>
            </div>
          );
        })}
        <div className="an-note">Шкала логарифмическая. Справа — конверсия из предыдущего измеренного шага (для просмотров и комментов см. «Ключевые конверсии»). «—» = шаг не измеряется в этом источнике данных.</div>
      </div>
      <div className="an-grid2">
        <div className="an-card">
          <h3>Ключевые конверсии</h3>
          {(() => {
            const g = (k: string) => steps.find((s) => s.key === k)?.value ?? null;
            const rows: [string, number | null][] = [
              ["Keyword rate (на 1000 просмотров)", (() => { const r = ratio(g("kw"), g("views")); return r === null ? null : r * 1000; })()],
              ["Keyword → DM", ratio(g("dm"), g("kw"))],
              ["DM → клик", ratio(g("clicks"), g("dm"))],
              ["Post CTR (клики / просмотры)", ratio(g("clicks"), g("views"))],
              ["Клик → заказ (CR)", ratio(g("orders"), g("clicks"))],
              ["Refund rate", ratio(g("refunds"), g("orders"))],
            ];
            return <table className="an-table"><tbody>{rows.map(([l, v], i) => <tr key={l}><td>{l}</td><td className="num">{i === 0 ? (v === null ? "—" : v.toFixed(2)) : fmtPct(v, 2)}</td></tr>)}</tbody></table>;
          })()}
        </div>
        <div className="an-card">
          <h3>Методы атрибуции</h3>
          {(() => {
            const by: Record<string, number> = {};
            d.conversions.forEach((c) => { by[c.method] = (by[c.method] ?? 0) + 1; });
            const max = Math.max(1, ...Object.values(by));
            const keys = Object.keys(by);
            return keys.length ? keys.map((k) => <Bar key={k} label={k} value={by[k]} max={max} right={`${fmtN(by[k])} · ${fmtPct(by[k] / d.conversions.length, 0)}`} />) : <div className="an-note">Нет атрибутированных заказов.</div>;
          })()}
          <div className="an-note">Атрибуция только по ссылкам: ref из ссылки креатора (landing_site / атрибуты корзины) → utm_campaign → кодовое слово → вручную; код скидки — лишь запасной вариант, если вдруг есть. Окно 7 дн.</div>
        </div>
      </div>
    </section>
  );
}

export function ContentTab({ d, demo, hit, setHit }: { d: Dataset; demo: boolean; hit: number; setHit: (n: number) => void }) {
  const rows = formulaTable(d, hit);
  const statsById = new Map(d.post_stats.map((s) => [s.post_id, s]));
  const orderCount = new Map<string, number>();
  d.conversions.forEach((c) => c.post_id && orderCount.set(c.post_id, (orderCount.get(c.post_id) ?? 0) + 1));
  const topPosts = [...d.posts].sort((a, b) => (orderCount.get(b.id) ?? 0) - (orderCount.get(a.id) ?? 0) || (statsById.get(b.id)?.views ?? 0) - (statsById.get(a.id)?.views ?? 0)).slice(0, 10);
  const creatorName = new Map(d.creators.map((c) => [c.id, c.display_name]));
  const formulaName = new Map(d.formulas.map((f) => [f.id, f.name]));
  const bySource = (src: string) => {
    const assetIds = new Set(d.assets.filter((a) => a.source === src).map((a) => a.id));
    const posts = d.posts.filter((p) => p.asset_id && assetIds.has(p.asset_id));
    const views = posts.reduce((a, p) => a + (statsById.get(p.id)?.views ?? 0), 0);
    const orders = posts.reduce((a, p) => a + (orderCount.get(p.id) ?? 0), 0);
    return { assets: assetIds.size, posts: posts.length, views, orders, pass: ratio(d.assets.filter((a) => a.source === src && a.qc_verdict === "PASS").length, assetIds.size) };
  };
  return (
    <section>
      <h2>Ролики и формулы <DemoTag demo={demo} /></h2>
      <div className="an-inline">
        Порог «залетевшего» поста: <input className="an-input sm" type="number" value={hit} onChange={(e) => setHit(Number(e.target.value) || 0)} /> просмотров
      </div>
      <div className="an-card an-scroll">
        <table className="an-table">
          <thead><tr><th>Формула</th><th>Тренд</th><th className="num">Посты</th><th className="num">Просмотры</th><th className="num">Медиана</th><th className="num">Hit rate</th><th className="num">ER</th><th className="num">Keyword /1k</th><th className="num">Заказы</th><th className="num">Выручка</th><th className="num">$ / 1k просм.</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td className="dim">{r.trend ?? "—"}</td><td className="num">{fmtN(r.posts)}</td><td className="num">{fmtN(r.views)}</td><td className="num">{fmtN(r.median_views)}</td><td className="num">{fmtPct(r.hit_rate, 0)}</td><td className="num">{fmtPct(r.er, 1)}</td><td className="num">{r.kw_per_1k === null ? "—" : r.kw_per_1k.toFixed(2)}</td><td className="num">{fmtN(r.orders)}</td><td className="num">{fmtUsd(r.revenue_cents)}</td><td className="num">{r.rev_per_1k_views === null ? "—" : fmtUsd(r.rev_per_1k_views)}</td></tr>
          ))}{!rows.length && <tr><td colSpan={11} className="dim">Нет постов.</td></tr>}</tbody>
        </table>
      </div>
      <div className="an-grid2">
        <div className="an-card">
          <h3>AI (Higgsfield) vs живые креаторы</h3>
          <table className="an-table"><thead><tr><th></th><th className="num">Ролики</th><th className="num">QC pass</th><th className="num">Посты</th><th className="num">Просмотры</th><th className="num">Заказы</th></tr></thead>
            <tbody>{(["AI_HIGGSFIELD", "HUMAN"] as const).map((s) => { const x = bySource(s); return <tr key={s}><td>{s === "HUMAN" ? "Живые" : "AI"}</td><td className="num">{fmtN(x.assets)}</td><td className="num">{fmtPct(x.pass, 0)}</td><td className="num">{fmtN(x.posts)}</td><td className="num">{fmtN(x.views)}</td><td className="num">{fmtN(x.orders)}</td></tr>; })}</tbody></table>
          <div className="an-note">В CSV-режиме ролики не импортируются — блок пустой.</div>
        </div>
        <div className="an-card an-scroll">
          <h3>Топ-10 постов</h3>
          <table className="an-table"><thead><tr><th>Пост</th><th>Креатор</th><th className="num">Просмотры</th><th className="num">Клики</th><th className="num">Заказы</th></tr></thead>
            <tbody>{topPosts.map((p) => <tr key={p.id}><td><a href={p.permalink} target="_blank" rel="noreferrer">{p.platform} · {fmtDate(p.posted_at)}</a><div className="dim">{p.formula_id ? formulaName.get(p.formula_id) : ""}</div></td><td>{creatorName.get(p.creator_id)}</td><td className="num">{fmtN(statsById.get(p.id)?.views)}</td><td className="num">{fmtN(statsById.get(p.id)?.clicks)}</td><td className="num">{fmtN(orderCount.get(p.id) ?? 0)}</td></tr>)}</tbody></table>
        </div>
      </div>
    </section>
  );
}

export function CreatorsTab({ d, demo, period }: { d: Dataset; demo: boolean; period: Period }) {
  const rows = creatorTable(d, period);
  const h = creatorHealth(d, rows);
  return (
    <section>
      <h2>Лидерборд креаторов <DemoTag demo={demo} /></h2>
      <div className="an-kpis">
        <Kpi label="Креаторов" value={fmtN(h.total)} />
        <Kpi label="Активных (пост за 7 дн)" value={fmtN(h.active)} />
        <Kpi label="% зарабатывающих" value={fmtPct(h.pct_earning, 0)} />
        <Kpi label="Activation rate" value={fmtPct(h.activation_rate, 0)} sub="живые с ≥1 постом / онбординг" />
      </div>
      <div className="an-card an-scroll">
        <table className="an-table">
          <thead><tr><th>#</th><th>Креатор</th><th>Источник</th><th className="num">Посты</th><th className="num">Постов/день</th><th className="num">Просмотры</th><th className="num">Клики</th><th className="num">Заказы</th><th className="num">CR</th><th className="num">Выручка</th><th className="num">Заработал</th><th className="num">EPC</th><th className="num">Возвраты</th><th>Посл. пост</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.id}><td className="dim">{i + 1}</td><td>{r.name}{r.type === "INTERNAL_AI" && <span className="an-pill">AI</span>}</td><td className="dim">{r.source ?? "—"}</td><td className="num">{fmtN(r.posts)}</td><td className="num">{r.posts_per_day === null ? "—" : r.posts_per_day.toFixed(1)}</td><td className="num">{fmtN(r.views)}</td><td className="num">{fmtN(r.clicks)}</td><td className="num">{fmtN(r.orders)}</td><td className="num">{fmtPct(r.cr, 1)}</td><td className="num">{fmtUsd(r.revenue_cents)}</td><td className="num strong">{fmtUsd(r.earned_cents)}</td><td className="num">{r.epc_cents === null ? "—" : fmtUsd(r.epc_cents)}</td><td className="num">{fmtPct(r.refund_rate, 0)}</td><td className="dim">{fmtDate(r.last_post)}</td></tr>
          ))}{!rows.length && <tr><td colSpan={14} className="dim">Нет креаторов.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

export const COST_LABEL: Record<string, string> = { HIGGSFIELD: "Higgsfield кредиты", APIFY: "Apify", ADS: "Реклама", SAMPLES: "Сэмплы товара", RECRUIT_AD: "Объявления найма", TOOLS: "Сервисы", FEES: "Комиссии", OTHER: "Прочее" };

export function RecruitTab({ d, demo }: { d: Dataset; demo: boolean }) {
  const rows = recruitTable(d);
  const totals = RECRUIT_STEPS.map((_, i) => rows.reduce((a, r) => a + r.counts[i], 0));
  const max = Math.max(1, totals[0]);
  return (
    <section>
      <h2>Найм креаторов по источникам <DemoTag demo={demo} /></h2>
      <div className="an-card">
        <h3>Общая воронка</h3>
        {RECRUIT_STEPS.map((s, i) => <Bar key={s.key} label={s.label} value={totals[i]} max={max} right={`${fmtN(totals[i])}${i ? " · " + fmtPct(ratio(totals[i], totals[i - 1]), 0) : ""}`} />)}
      </div>
      <div className="an-card an-scroll">
        <table className="an-table">
          <thead><tr><th>Источник (чат)</th><th className="num">Объявл.</th>{RECRUIT_STEPS.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Лид → продажа</th><th className="num">Расход</th><th className="num">Выручка креаторов</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td className="num">{r.ads}</td>{r.counts.map((c, i) => <td key={i} className="num">{fmtN(c)}</td>)}<td className="num">{fmtPct(ratio(r.counts[6], r.counts[0]), 0)}</td><td className="num">{fmtUsd(r.cost_cents)}</td><td className="num">{fmtUsd(r.revenue_cents)}</td></tr>
          ))}{!rows.length && <tr><td colSpan={12} className="dim">Нет данных по найму (в CSV-режиме не импортируется).</td></tr>}</tbody>
        </table>
        <div className="an-note">Стадии лида: NEW → REPLIED → SAMPLES_SENT → APPROVED → ONBOARDED → FIRST_POST → FIRST_SALE. Источник лида = уникальное стартовое слово в объявлении.</div>
      </div>
    </section>
  );
}

