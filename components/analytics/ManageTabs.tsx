"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Dataset, Platform } from "@/lib/analytics/model";
import { money } from "@/lib/analytics/metrics";
import { ORDERS_TEMPLATE, POSTS_TEMPLATE, parseCsv } from "@/lib/analytics/csv";
import { LocalManageStore, type ManageStore } from "@/lib/analytics/manage";
import { shortLink } from "@/lib/analytics/sbClient";
import {
  RULE_LABEL, buildDiscountLink, computeAccruals, loadWorkspace, nextPostCode, normalizeNick, promoCodeFor,
  type PayoutRule, type WsCreator, type WsLink, type WsSettings, type Workspace,
} from "@/lib/analytics/workspace";
import { COST_LABEL, DemoTag, Kpi, fmtDate, fmtN, fmtUsd } from "./AnalyticsTabs";

export type Act = (fn: () => Promise<unknown> | unknown, okMsg?: string) => Promise<void>;
const PLAT: Platform[] = ["IG", "TT", "YT"];
const PLAT_LABEL: Record<Platform, string> = { IG: "Instagram", TT: "TikTok", YT: "YouTube" };

export function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
  return Promise.resolve();
}
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch { /* ignore */ } ta.remove();
}
function CopyBtn({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn sm copy-btn" onClick={() => { copyText(text); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? "✓ Скопировано" : label}</button>;
}
const download = (name: string, body: string, type = "text/csv") => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click();
};
const ruleText = (rule: PayoutRule, value: number | null) =>
  value === null || value === undefined ? `${RULE_LABEL[rule]}: задай сумму` : rule === "CPA_FIXED" ? `$${value} за продажу` : `${+(value * 100).toFixed(2)}% ${rule === "PCT_REVENUE" ? "от заказа" : "от маржи"}`;

export function MineOnlyNote({ isDemo, onSwitch }: { isDemo: boolean; onSwitch: () => void }) {
  if (!isDemo) return null;
  return <div className="an-warn">Эта вкладка работает с <b>вашими</b> данными, а сверху выбран DEMO. Действия сохранятся в «Мои CSV» (этот браузер). <button className="btn sm" onClick={onSwitch}>Переключиться на «Мои CSV»</button></div>;
}

// ───────────────────────── Креаторы ─────────────────────────
interface CForm { id: string | null; nick: string; contact: string; IG: string; TT: string; YT: string; rule: "" | PayoutRule; value: string; status: "ACTIVE" | "PAUSED" }
const EMPTY: CForm = { id: null, nick: "", contact: "", IG: "", TT: "", YT: "", rule: "", value: "", status: "ACTIVE" };

export function CreatorsManage({ store, ws, mine, act }: { store: ManageStore; ws: Workspace; mine: Dataset | null; act: Act }) {
  const [f, setF] = useState<CForm>(EMPTY);
  const [open, setOpen] = useState(ws.creators.length === 0);
  const nick = normalizeNick(f.nick);
  const existing = f.id ? ws.creators.find((c) => c.id === f.id) : undefined;
  const promo = existing?.promo_code || (nick ? promoCodeFor(nick) : "LIKKY-…");
  const stats = useMemo(() => {
    const m = new Map<string, { orders: number; earned: number }>();
    mine?.conversions.forEach((c) => { const x = m.get(c.creator_id) ?? { orders: 0, earned: 0 }; x.orders++; m.set(c.creator_id, x); });
    mine?.commissions.forEach((c) => { if (c.status === "VOID") return; const x = m.get(c.creator_id) ?? { orders: 0, earned: 0 }; x.earned += c.amount_cents; m.set(c.creator_id, x); });
    return m;
  }, [mine]);

  const save = () => act(async () => {
    if (!nick) throw new Error("Укажите ник (латиница/кириллица, цифры)");
    const value = f.value.trim() === "" ? null : Number(f.value.replace(",", "."));
    if (value !== null && !Number.isFinite(value)) throw new Error("Сумма/процент — число");
    const c: WsCreator = {
      id: f.id ?? store.newId("c"), nick: existing?.nick ?? nick, contact: f.contact.trim(),
      handles: { IG: f.IG.trim(), TT: f.TT.trim(), YT: f.YT.trim() }, promo_code: promo,
      payout_rule: f.rule || null, payout_value: f.rule && value !== null ? (f.rule === "CPA_FIXED" ? value : value / 100) : null,
      status: f.status, created_at: existing?.created_at ?? new Date().toISOString(),
    };
    await store.saveCreator(c);
    setF(EMPTY); setOpen(false);
  }, `Креатор сохранён. Промокод ${promo} — создайте такой же код скидки в Shopify.`);

  const edit = (c: WsCreator) => {
    setOpen(true);
    setF({ id: c.id, nick: c.nick, contact: c.contact, IG: c.handles.IG, TT: c.handles.TT, YT: c.handles.YT, rule: c.payout_rule ?? "", value: c.payout_value === null ? "" : String(c.payout_rule === "CPA_FIXED" ? c.payout_value : +(c.payout_value * 100).toFixed(4)), status: c.status });
  };

  return (
    <section className="manage-creators">
      <h2>Мои креаторы <span className="an-real-tag">ВАШИ ДАННЫЕ</span></h2>
      <div className="an-card">
        {!open ? <button className="btn primary add-creator-btn" onClick={() => { setF(EMPTY); setOpen(true); }}>＋ Добавить креатора</button> : (
          <div className="cform">
            <h3>{f.id ? "Редактировать креатора" : "Новый креатор"}</h3>
            <div className="form-grid">
              <label>Ник*<input className="an-input" name="nick" value={f.nick} disabled={!!f.id} onChange={(e) => setF({ ...f, nick: e.target.value })} placeholder="mira" /></label>
              <label>Контакт (Telegram / телефон)<input className="an-input" name="contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="@mira_tg" /></label>
              <label>Instagram<input className="an-input" value={f.IG} onChange={(e) => setF({ ...f, IG: e.target.value })} placeholder="@mira.glow" /></label>
              <label>TikTok<input className="an-input" value={f.TT} onChange={(e) => setF({ ...f, TT: e.target.value })} placeholder="@mira" /></label>
              <label>YouTube<input className="an-input" value={f.YT} onChange={(e) => setF({ ...f, YT: e.target.value })} placeholder="@mira" /></label>
              <label>Правило выплаты
                <select className="an-input" value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value as CForm["rule"] })}>
                  <option value="">как в Настройках ({ruleText(ws.settings.payout_rule, ws.settings.payout_value)})</option>
                  <option value="CPA_FIXED">фикс $ за продажу</option>
                  <option value="PCT_REVENUE">% от суммы заказа</option>
                  <option value="PCT_MARGIN">% от маржи</option>
                </select>
              </label>
              {f.rule && <label>{f.rule === "CPA_FIXED" ? "Сумма, $" : "Процент, %"}<input className="an-input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="задай сумму" /></label>}
              <label>Статус<select className="an-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CForm["status"] })}><option value="ACTIVE">активен</option><option value="PAUSED">на паузе</option></select></label>
            </div>
            <div className="promo-preview">Промокод: <code className="promo-code">{promo}</code> {!f.id && <span className="dim">— создаётся автоматически из ника, потом не меняется. Создайте такой же код скидки в Shopify.</span>}</div>
            <div className="btn-row">
              <button className="btn primary save-creator-btn" onClick={save}>Сохранить</button>
              <button className="btn" onClick={() => { setF(EMPTY); setOpen(false); }}>Отмена</button>
            </div>
          </div>
        )}
      </div>
      <div className="an-card an-scroll">
        <table className="an-table creators-table">
          <thead><tr><th>Ник</th><th>Промокод</th><th>Контакт</th><th>Соцсети</th><th>Правило выплаты</th><th className="num">Ссылок</th><th className="num">Заказов</th><th className="num">Начислено</th><th></th></tr></thead>
          <tbody>
            {ws.creators.map((c) => {
              const st = stats.get(c.id);
              return (
                <tr key={c.id} className={c.status === "PAUSED" ? "dimrow" : ""}>
                  <td>@{c.nick}{c.status === "PAUSED" && <span className="an-pill">пауза</span>}</td>
                  <td><code>{c.promo_code}</code> <CopyBtn text={c.promo_code} label="⧉" /></td>
                  <td className="dim">{c.contact || "—"}</td>
                  <td className="dim">{(["IG", "TT", "YT"] as const).filter((p) => c.handles[p]).map((p) => `${p} ${c.handles[p]}`).join(" · ") || "—"}</td>
                  <td>{c.payout_rule ? ruleText(c.payout_rule, c.payout_value) : <span className="dim">как в Настройках</span>}</td>
                  <td className="num">{ws.links.filter((l) => l.creator_id === c.id).length}</td>
                  <td className="num">{fmtN(st?.orders ?? 0)}</td>
                  <td className="num">{fmtUsd(st?.earned ?? 0)}</td>
                  <td className="nowrap"><button className="btn sm" onClick={() => edit(c)}>✏️</button> <button className="btn sm" onClick={() => { if (confirm(`Удалить @${c.nick} и его ссылки?`)) act(() => store.deleteCreator(c.id), "Удалено"); }}>🗑</button></td>
                </tr>
              );
            })}
            {!ws.creators.length && <tr><td colSpan={9} className="dim">Пока нет креаторов. Нажмите «Добавить креатора».</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ───────────────────────── Ссылки ─────────────────────────
export function LinksTab({ store, ws, mine, act }: { store: ManageStore; ws: Workspace; mine: Dataset | null; act: Act }) {
  const active = ws.creators.filter((c) => c.status === "ACTIVE");
  const [creatorId, setCreatorId] = useState(active[0]?.id ?? "");
  const [productId, setProductId] = useState(ws.products[0]?.id ?? "");
  const [platform, setPlatform] = useState<Platform>("IG");
  const creator = ws.creators.find((c) => c.id === creatorId);
  const product = ws.products.find((p) => p.id === productId);
  const [keyword, setKeyword] = useState(product?.keyword ?? "");
  const [code, setCode] = useState("");
  const [last, setLast] = useState<WsLink | null>(null);
  const [qr, setQr] = useState("");
  useEffect(() => { if (!creatorId && active[0]) setCreatorId(active[0].id); }, [active, creatorId]);
  useEffect(() => { setKeyword(product?.keyword ?? ""); }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCode(creator ? nextPostCode(ws, creator) : ""); }, [creatorId, ws.links.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (last) QRCode.toDataURL(last.short_url ?? last.url, { margin: 1, width: 220 }).then(setQr).catch(() => setQr("")); }, [last]);
  const orders = useMemo(() => { const m = new Map<string, number>(); mine?.conversions.forEach((c) => c.post_id && m.set(c.post_id, (m.get(c.post_id) ?? 0) + 1)); return m; }, [mine]);

  const generate = () => act(async () => {
    if (!creator || !product) throw new Error("Сначала добавьте креатора на вкладке «Креаторы»");
    const c = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!c) throw new Error("Код поста пустой");
    if (ws.links.some((l) => l.code === c)) throw new Error(`Код поста ${c} уже есть — поменяйте`);
    const link: WsLink = {
      code: c, creator_id: creator.id, product_id: product.id, platform, keyword: keyword.trim().toUpperCase() || product.keyword,
      url: buildDiscountLink(ws.settings.store_domain, creator.promo_code, product.handle, platform, creator.nick, c),
      short_url: store.mode === "SUPABASE" ? shortLink(c) : null, permalink: null, created_at: new Date().toISOString(),
    };
    await store.saveLink(link);
    setLast(link);
  }, "Ссылка создана");

  const dm = (l: WsLink) => {
    const c = ws.creators.find((x) => x.id === l.creator_id); const p = ws.products.find((x) => x.id === l.product_id);
    return `Привет! Держи ссылку на ${p?.title ?? "товар"} 👉 ${l.short_url ?? l.url}\nПромокод ${c?.promo_code ?? ""} применится сам. #ad`;
  };

  return (
    <section>
      <h2>Генератор ссылок на посты <span className="an-real-tag">ВАШИ ДАННЫЕ</span></h2>
      {!ws.creators.length ? <div className="an-warn">Сначала добавьте креатора на вкладке «Креаторы».</div> : (
        <div className="an-grid2">
          <div className="an-card link-form">
            <h3>Новая ссылка</h3>
            <div className="form-grid">
              <label>Креатор<select className="an-input" name="creator" value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>{ws.creators.map((c) => <option key={c.id} value={c.id}>@{c.nick} · {c.promo_code}</option>)}</select></label>
              <label>Товар<select className="an-input" name="product" value={productId} onChange={(e) => setProductId(e.target.value)}>{ws.products.map((p) => <option key={p.id} value={p.id}>{p.title} · {fmtUsd(p.price_cents)}</option>)}</select></label>
              <label>Платформа<select className="an-input" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>{PLAT.map((p) => <option key={p} value={p}>{PLAT_LABEL[p]}</option>)}</select></label>
              <label>Кодовое слово<input className="an-input" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></label>
              <label>Код поста (utm_content)<input className="an-input" name="postcode" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            </div>
            <button className="btn primary gen-link-btn" onClick={generate}>🔗 Сгенерировать ссылку</button>
            <div className="an-note">Ссылка = Shopify discount link: применяет промокод креатора и открывает товар. Работает, только если такой код скидки создан в Shopify.</div>
          </div>
          <div className="an-card link-result">
            <h3>Результат</h3>
            {!last ? <div className="dim">Здесь появится ссылка, QR и текст для DM.</div> : (
              <>
                <div className="link-box"><code className="gen-url">{last.url}</code><CopyBtn text={last.url} /></div>
                {last.short_url && <div className="link-box"><span className="dim">Короткая (считает клики):</span> <code>{last.short_url}</code><CopyBtn text={last.short_url} /></div>}
                <div className="link-meta">Кодовое слово: <b>{last.keyword}</b> · подпись: «Пиши {last.keyword} в комментах — пришлю ссылку»</div>
                <div className="link-qr">{qr && <img src={qr} alt="QR-код ссылки" width={150} height={150} />}
                  <div style={{ flex: 1 }}><div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>Текст для DM:</div><pre className="guide-pre">{dm(last)}</pre><CopyBtn text={dm(last)} label="Копировать DM" /></div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="an-card an-scroll">
        <h3>Посты и ссылки ({ws.links.length})</h3>
        <table className="an-table links-table">
          <thead><tr><th>Код поста</th><th>Креатор</th><th>Товар</th><th>Платф.</th><th>Слово</th><th>Ссылка</th><th>Пост опубликован (URL)</th><th className="num">Заказов</th><th></th></tr></thead>
          <tbody>
            {[...ws.links].reverse().map((l) => (
              <tr key={l.code}>
                <td><code>{l.code}</code></td>
                <td>@{ws.creators.find((c) => c.id === l.creator_id)?.nick ?? "?"}</td>
                <td className="dim">{ws.products.find((p) => p.id === l.product_id)?.title ?? "?"}</td>
                <td>{l.platform}</td>
                <td><b>{l.keyword}</b></td>
                <td className="nowrap"><CopyBtn text={l.short_url ?? l.url} label="⧉ ссылка" /> <CopyBtn text={dm(l)} label="⧉ DM" /></td>
                <td>{store.mode === "LOCAL" ? <input className="an-input" style={{ width: 210 }} defaultValue={l.permalink ?? ""} placeholder="https://instagram.com/reel/…" onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== l.permalink) act(() => store.saveLink({ ...l, permalink: v }), "Ссылка на пост сохранена"); }} /> : <span className="dim">—</span>}</td>
                <td className="num">{fmtN(orders.get(l.code) ?? 0)}</td>
                <td><button className="btn sm" onClick={() => { if (confirm(`Удалить ссылку ${l.code}?`)) act(() => store.deleteLink(l.code), "Удалено"); }}>🗑</button></td>
              </tr>
            ))}
            {!ws.links.length && <tr><td colSpan={9} className="dim">Ссылок пока нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ───────────────────────── Выплаты ─────────────────────────
export function PayoutsTab({ d, demo, store, act }: { d: Dataset; demo: boolean; store: ManageStore; act: Act }) {
  const m = money(d);
  const [note, setNote] = useState("");
  const name = new Map(d.creators.map((c) => [c.id, c.display_name]));
  const orderName = new Map(d.orders.map((o) => [o.id, o]));
  const rows = d.creators.map((c) => {
    const cs = d.commissions.filter((x) => x.creator_id === c.id);
    const approved = cs.filter((x) => x.status === "APPROVED" && !x.needs_amount);
    const held = cs.filter((x) => x.status === "HELD" && !x.needs_amount);
    const next = held.map((x) => x.hold_until).filter(Boolean).sort()[0] ?? null;
    return {
      id: c.id, name: c.display_name, promo: c.promo_code, orders: cs.length,
      approved: approved.reduce((a, x) => a + x.amount_cents, 0), approvedIds: approved.map((x) => x.id),
      held: held.reduce((a, x) => a + x.amount_cents, 0), next, needs: cs.filter((x) => x.needs_amount && x.status !== "VOID").length,
      paid: cs.filter((x) => x.status === "PAID").reduce((a, x) => a + x.amount_cents, 0),
    };
  }).filter((r) => r.orders > 0).sort((a, b) => b.approved - a.approved || b.held - a.held);
  const toPay = rows.reduce((a, r) => a + r.approved, 0);
  const needs = rows.reduce((a, r) => a + r.needs, 0);
  const pnl: [string, number | null, boolean?][] = [
    ["Выручка (gross)", m.gross_cents], ["− Возвраты", -m.refunds_cents], ["= Net revenue", m.net_cents, true],
    ["− COGS", m.cogs_cents === null ? null : -m.cogs_cents], ["= Маржа", m.margin_cents, true], ["− Комиссии креаторам", -m.commission_cents],
    ...Object.entries(m.costs_by_category).map(([k, v]) => ["− " + (COST_LABEL[k] ?? k), -v] as [string, number]),
    ["= Profit after creators", m.profit_cents, true],
  ];
  return (
    <section>
      <h2>Выплаты креаторам <DemoTag demo={demo} />{!demo && <span className="an-real-tag">ВАШИ ДАННЫЕ</span>}</h2>
      <div className="an-kpis">
        <Kpi label="К выплате сейчас" value={fmtUsd(toPay)} sub="удержание прошло" />
        <Kpi label="На удержании" value={fmtUsd(m.commission_by_status.HELD)} sub="ждут окончания удержания" />
        <Kpi label="Без суммы" value={fmtN(needs)} sub={needs ? "задай правило / COGS в Настройках" : "всё посчитано"} />
        <Kpi label="Выплачено" value={fmtUsd(m.paid_out_cents)} />
        <Kpi label="Аннулировано" value={fmtUsd(m.commission_by_status.VOID)} sub="возвраты" />
      </div>
      <div className="an-card an-scroll">
        <div className="an-inline"><span>Комментарий к выплате (способ, № перевода):</span><input className="an-input" style={{ width: 280 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="карта / USDT TRC20 …" disabled={demo} /></div>
        <table className="an-table payouts-table">
          <thead><tr><th>Креатор</th><th>Промокод</th><th className="num">Заказов</th><th className="num">К выплате</th><th className="num">На удержании</th><th>Освободится</th><th className="num">Без суммы</th><th className="num">Выплачено</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td><code>{r.promo ?? "—"}</code></td><td className="num">{r.orders}</td>
                <td className="num strong">{fmtUsd(r.approved)}</td><td className="num">{fmtUsd(r.held)}</td><td className="dim">{fmtDate(r.next)}</td>
                <td className="num">{r.needs || ""}</td><td className="num">{fmtUsd(r.paid)}</td>
                <td><button className="btn sm primary mark-paid-btn" disabled={demo || r.approved <= 0} title={demo ? "В DEMO недоступно" : ""} onClick={() => act(() => store.markPaid(r.id, r.approvedIds, r.approved, note), `Отмечено: выплачено ${fmtUsd(r.approved)}`)}>Отметить выплачено</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="dim">Начислений пока нет. Импортируйте заказы Shopify на вкладке «Импорт».</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="an-grid2">
        <div className="an-card an-scroll">
          <h3>История выплат</h3>
          <table className="an-table"><thead><tr><th>Креатор</th><th>Дата</th><th>Комментарий</th><th className="num">Сумма</th><th></th></tr></thead>
            <tbody>{d.payouts.map((p) => <tr key={p.id}><td>{name.get(p.creator_id) ?? p.creator_id}</td><td className="dim">{fmtDate(p.paid_at)}</td><td className="dim">{p.method}</td><td className="num">{fmtUsd(p.amount_cents)}</td><td>{!demo && <button className="btn sm" onClick={() => act(() => store.undoPayout(p.id), "Выплата отменена")}>Отменить</button>}</td></tr>)}
              {!d.payouts.length && <tr><td colSpan={5} className="dim">Выплат нет.</td></tr>}</tbody></table>
        </div>
        <div className="an-card">
          <h3>P&amp;L за период</h3>
          <table className="an-table"><tbody>{pnl.map(([l, v, strong]) => <tr key={l} className={strong ? "strong" : ""}><td>{l}</td><td className="num">{fmtUsd(v)}</td></tr>)}</tbody></table>
          {m.cogs_cents === null && <div className="an-note">Маржа не считается: задайте COGS по всем SKU в Настройках.</div>}
        </div>
      </div>
      <div className="an-card an-scroll">
        <h3>Начисления по заказам</h3>
        <table className="an-table accruals-table"><thead><tr><th>Заказ</th><th>Дата</th><th>Креатор</th><th>Как привязан</th><th className="num">Сумма заказа</th><th className="num">Начисление</th><th>Статус</th><th>Удержание до</th></tr></thead>
          <tbody>{d.commissions.slice().sort((a, b) => (orderName.get(b.conversion_order_id ?? "")?.ordered_at ?? "").localeCompare(orderName.get(a.conversion_order_id ?? "")?.ordered_at ?? "")).slice(0, 200).map((c) => {
            const o = orderName.get(c.conversion_order_id ?? "");
            const conv = d.conversions.find((x) => x.order_id === c.conversion_order_id);
            return <tr key={c.id}><td>{o?.external_id ?? "—"}</td><td className="dim">{fmtDate(o?.ordered_at ?? null)}</td><td>{name.get(c.creator_id)}</td><td className="dim">{conv?.method === "PROMO" ? `промокод ${o?.discount_codes.join(", ")}` : conv?.method === "LINK" ? `ссылка ${conv.post_id ?? ""}` : conv?.method ?? "—"}</td><td className="num">{fmtUsd(o?.total_cents)}</td><td className="num">{c.needs_amount ? <span className="warn-text">{c.note ?? "задай сумму"}</span> : fmtUsd(c.amount_cents)}</td><td><span className={`st st-${c.status}`}>{({ HELD: "удержание", APPROVED: "к выплате", PAID: "выплачено", VOID: "аннулировано" } as Record<string, string>)[c.status]}</span></td><td className="dim">{fmtDate(c.hold_until ?? null)}</td></tr>;
          })}{!d.commissions.length && <tr><td colSpan={8} className="dim">Нет начислений.</td></tr>}</tbody></table>
      </div>
    </section>
  );
}

// ───────────────────────── Импорт ─────────────────────────
export function ImportTab({ store, ws, act }: { store: ManageStore; ws: Workspace; act: Act }) {
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState("");
  if (!(store instanceof LocalManageStore)) {
    return <section><h2>Импорт</h2><div className="an-card">В режиме «База» заказы приходят автоматически вебхуком Shopify → функция <code>shopify-orders-webhook</code> (после настройки по <code>docs/GO_LIVE.md</code>). Загрузка CSV и бэкап — в режиме «Мои CSV».</div></section>;
  }
  const local = store;
  const ingestOrders = (text: string) => act(() => {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV не прочитан: нужна строка заголовков и хотя бы одна строка");
    const r = local.importOrders(rows);
    const acc = computeAccruals(loadWorkspace());
    const attributed = acc.filter((a) => a.creator_id).length;
    setResult(`Заказы: новых ${r.added}, обновлено ${r.updated}${r.skipped ? `, пропущено ${r.skipped} (нет даты)` : ""}. Всего в базе ${acc.length}, из них привязано к креаторам по промокоду/ссылке: ${attributed}, органика: ${acc.length - attributed}.`);
  }, "Заказы импортированы");
  const ingestPosts = (text: string) => act(() => {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV не прочитан");
    local.importPosts(rows);
    setResult(`Посты: загружено строк ${rows.length}. Метрики привяжутся к ссылкам по post_id (код поста) или URL поста.`);
  }, "Посты импортированы");
  const onFile = (fn: (t: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) f.text().then(fn); e.target.value = ""; };
  const acc = computeAccruals(ws).slice().sort((a, b) => b.order.ordered_at.localeCompare(a.order.ordered_at)).slice(0, 15);
  const nick = new Map(ws.creators.map((c) => [c.id, c.nick]));
  return (
    <section>
      <h2>Импорт данных <span className="an-real-tag">ВАШИ ДАННЫЕ</span></h2>
      <div className="an-note big">Файлы читаются в браузере и сохраняются только на этом устройстве (localStorage). На сервер ничего не уходит.</div>
      <div className="an-grid2">
        <div className="an-card">
          <h3>Заказы Shopify (CSV) — в базе {ws.orders.length}</h3>
          <p className="dim">Shopify Admin → Orders → Export → CSV. Привязка к креатору — по колонке <code>Discount Code</code> (= промокод креатора) или по <code>utm_content</code>/<code>ref</code> из Landing Site, если есть. Повторный импорт обновляет заказы, дублей не будет.</p>
          <input type="file" accept=".csv,text/csv" className="orders-file" onChange={onFile(ingestOrders)} />
          <div className="btn-row">
            <button className="btn" onClick={() => download("shopify_orders_template.csv", ORDERS_TEMPLATE)}>Шаблон</button>
            <button className="btn" onClick={() => { if (confirm("Удалить все импортированные заказы и отметки выплат?")) act(() => local.clearOrders(), "Заказы удалены"); }}>Очистить заказы</button>
          </div>
        </div>
        <div className="an-card">
          <h3>Метрики постов (CSV) — строк {ws.post_rows.length}</h3>
          <p className="dim">Колонки: <code>post_id, post_url, platform, creator, posted_at, views, likes, comments, shares, saves, keyword_comments, dm_sent, clicks, formula</code>. Пустая ячейка = «нет данных».</p>
          <input type="file" accept=".csv,text/csv" onChange={onFile(ingestPosts)} />
          <div className="btn-row">
            <button className="btn" onClick={() => download("posts_template.csv", POSTS_TEMPLATE)}>Шаблон</button>
            <button className="btn" onClick={() => act(() => local.clearPosts(), "Метрики постов удалены")}>Очистить</button>
          </div>
        </div>
      </div>
      <div className="an-card">
        <h3>Или вставить CSV текстом</h3>
        <textarea className="an-textarea" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Вставьте CSV с заголовками…" />
        <div className="btn-row">
          <button className="btn primary paste-orders-btn" onClick={() => ingestOrders(paste)}>Это заказы Shopify</button>
          <button className="btn primary" onClick={() => ingestPosts(paste)}>Это метрики постов</button>
        </div>
      </div>
      {result && <div className="an-warn import-result">{result}</div>}
      <div className="an-card an-scroll">
        <h3>Последние заказы и привязка</h3>
        <table className="an-table recent-orders"><thead><tr><th>Заказ</th><th>Дата</th><th className="num">Сумма</th><th>Промокод</th><th>Креатор</th><th className="num">Начисление</th></tr></thead>
          <tbody>{acc.map((a) => <tr key={a.id}><td>{a.order.external_id}</td><td className="dim">{fmtDate(a.order.ordered_at)}</td><td className="num">{fmtUsd(a.order.total_cents)}</td><td><code>{a.order.discount_codes.join(", ") || "—"}</code></td><td>{a.creator_id ? `@${nick.get(a.creator_id)} (${a.method === "PROMO" ? "промокод" : "ссылка"})` : <span className="dim">органика</span>}</td><td className="num">{a.creator_id ? (a.amount_cents === null ? <span className="warn-text">{a.reason}</span> : fmtUsd(a.amount_cents)) : "—"}</td></tr>)}
            {!acc.length && <tr><td colSpan={6} className="dim">Заказов нет.</td></tr>}</tbody></table>
      </div>
      <div className="an-card">
        <h3>Бэкап</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => download(`viralforge-backup-${new Date().toISOString().slice(0, 10)}.json`, local.exportJson(), "application/json")}>⬇ Скачать бэкап JSON</button>
          <label className="btn">⬆ Загрузить бэкап<input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onFile((t) => act(() => local.importJson(t), "Бэкап загружен"))} /></label>
          <button className="btn" onClick={() => { if (confirm("Стереть ВСЕ ваши данные в этом браузере? Сначала скачайте бэкап.")) act(() => local.reset(), "Всё стёрто"); }}>Стереть всё</button>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── Настройки ─────────────────────────
export function SettingsTab({ store, ws, act }: { store: ManageStore; ws: Workspace; act: Act }) {
  const s = ws.settings;
  const [rule, setRule] = useState<PayoutRule>(s.payout_rule);
  const [value, setValue] = useState(s.payout_value === null ? "" : String(s.payout_rule === "CPA_FIXED" ? s.payout_value : +(s.payout_value * 100).toFixed(4)));
  const [hold, setHold] = useState(String(s.hold_days));
  const [win, setWin] = useState(String(s.attribution_window_days));
  const [domain, setDomain] = useState(s.store_domain);
  const save = () => act(async () => {
    const v = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (v !== null && !Number.isFinite(v)) throw new Error("Сумма/процент — число");
    const next: WsSettings = { payout_rule: rule, payout_value: v === null ? null : rule === "CPA_FIXED" ? v : v / 100, hold_days: Math.max(0, Number(hold) || 0), attribution_window_days: Math.max(1, Number(win) || 7), store_domain: domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") || "likky.store" };
    await store.saveSettings(next);
  }, "Настройки сохранены");
  return (
    <section>
      <h2>Настройки <span className="an-real-tag">ВАШИ ДАННЫЕ</span></h2>
      <div className="an-card settings-form">
        <h3>Правило выплаты (по умолчанию для всех креаторов)</h3>
        <div className="form-grid">
          <label>Правило<select className="an-input" name="rule" value={rule} onChange={(e) => setRule(e.target.value as PayoutRule)}>
            <option value="CPA_FIXED">фикс $ за продажу</option><option value="PCT_REVENUE">% от суммы заказа</option><option value="PCT_MARGIN">% от маржи</option></select></label>
          <label>{rule === "CPA_FIXED" ? "Сумма за продажу, $" : "Процент, %"}<input className={`an-input ${value.trim() === "" ? "need" : ""}`} name="value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="задай сумму" /></label>
          <label>Удержание, дней<input className="an-input" value={hold} onChange={(e) => setHold(e.target.value)} /></label>
          <label>Окно атрибуции, дней<input className="an-input" value={win} onChange={(e) => setWin(e.target.value)} /></label>
          <label>Домен магазина<input className="an-input" value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
        </div>
        {value.trim() === "" && <div className="an-warn">Сумма не задана — начисления показываются как «задай сумму». Цифру решаете вы; в спеке она открытый вопрос.</div>}
        <div className="an-note">Окно атрибуции применяется в режиме «База» к кликам по коротким ссылкам. В режиме «Мои CSV» заказ привязывается по промокоду/метке прямо в заказе — это прямое доказательство, окно не нужно. Креатору можно задать своё правило на вкладке «Креаторы».</div>
        <div className="btn-row"><button className="btn primary save-settings-btn" onClick={save}>Сохранить настройки</button></div>
      </div>
      <div className="an-card an-scroll">
        <h3>Себестоимость (COGS) по SKU</h3>
        <table className="an-table cogs-table"><thead><tr><th>Товар</th><th>Handle</th><th className="num">Цена</th><th className="num">COGS, $</th><th className="num">Маржа / шт</th><th>Слово</th></tr></thead>
          <tbody>{ws.products.map((p) => (
            <tr key={p.id}><td>{p.title}</td><td className="dim"><a href={`https://${ws.settings.store_domain}/products/${p.handle}`} target="_blank" rel="noreferrer">{p.handle.length > 34 ? p.handle.slice(0, 34) + "…" : p.handle}</a></td>
              <td className="num">{fmtUsd(p.price_cents)}</td>
              <td className="num"><input className="an-input sm" defaultValue={p.cogs_cents === null ? "" : (p.cogs_cents / 100).toFixed(2)} placeholder="[COGS]" onBlur={(e) => { const v = e.target.value.trim(); const c = v === "" ? null : Math.round(Number(v.replace(",", ".")) * 100); if (c !== null && !Number.isFinite(c)) return; if (c !== p.cogs_cents) act(() => store.saveProduct({ ...p, cogs_cents: c }), "COGS сохранён"); }} /></td>
              <td className="num">{p.cogs_cents === null ? "—" : fmtUsd(p.price_cents - p.cogs_cents)}</td><td><b>{p.keyword}</b></td></tr>
          ))}</tbody></table>
        <div className="an-note">Цены — публичные с likky.store. COGS вводите сами (закупка + доставка до клиента + комиссия платёжки), иначе маржа и выплаты «% от маржи» не считаются.</div>
      </div>
    </section>
  );
}
