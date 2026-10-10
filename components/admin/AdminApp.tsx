"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { sb, supabaseConfigured } from "@/lib/analytics/sbClient";
import {
  adminAddAdmin, adminGetDefaultRate, adminListAdmins, adminPartners, adminRemoveAdmin, adminResetPassword, adminSetDefaultRate, adminSetRate, adminSetStatus, adminWhoami,
  loginToEmail, payoutText, PLATFORM_ICON, usd, type AdminPartner, type AdminRow, type PPlatform, type Rate,
} from "@/lib/partner";

type Tab = "requests" | "partners" | "admins";
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "—");
const STATUS: Record<string, string> = { PENDING: "⏳ заявка", ACTIVE: "✅ активен", FROZEN: "⛔ заблокирован", REJECTED: "✖ отклонён", BANNED: "⛔ бан", CHURNED: "удалён" };
const tgUrl = (t: string | null) => (t ? `https://t.me/${t.replace(/^@/, "")}` : null);
function genPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (n) => a[n % a.length]).join("");
}

function Socials({ p }: { p: AdminPartner }) {
  const hs = (["TT", "IG", "YT"] as PPlatform[]).filter((k) => p.handles?.[k]);
  return (
    <div className="ad-meta">
      {p.telegram ? <a href={tgUrl(p.telegram) ?? "#"} target="_blank" rel="noreferrer">✈️ {p.telegram}</a> : <span className="pt-dim">Telegram не указан</span>}
      {hs.map((k) => <span key={k}>{PLATFORM_ICON[k]} {p.handles[k]}</span>)}
    </div>
  );
}

function AdminLogin({ c }: { c: SupabaseClient }) {
  const [login, setLogin] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    const { error } = await c.auth.signInWithPassword({ email: loginToEmail(login), password: pw });
    setBusy(false);
    if (error) setErr("Неверный логин или пароль.");
  };
  return (
    <section className="pt-card pt-login">
      <div className="pt-emoji">🛡</div>
      <h2>Админка Likky</h2>
      <p className="pt-dim">Заявки партнёров, блокировки, ставки, пароли.</p>
      <label className="pt-label">Логин
        <input className="pt-input" name="login" autoCapitalize="none" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="admin" />
      </label>
      <label className="pt-label">Пароль
        <input className="pt-input" name="password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && login && pw) go(); }} />
      </label>
      <button className="pt-btn primary wide" disabled={!login || !pw || busy} onClick={go}>{busy ? "Вхожу…" : "Войти"}</button>
      {err && <div className="pt-err">{err}</div>}
    </section>
  );
}

function DefaultRateEditor({ c, rate, onDone, toast }: { c: SupabaseClient; rate: Rate | null; onDone: () => void; toast: (m: string) => void }) {
  const [rule, setRule] = useState("PCT_REVENUE");
  const [val, setVal] = useState("");
  useEffect(() => {
    if (!rate) return;
    const r = rate.rule === "CPA_FIXED" ? "CPA_FIXED" : "PCT_REVENUE";
    setRule(r);
    setVal(rate.value === null ? "" : String(r === "CPA_FIXED" ? Number(rate.value) : +(Number(rate.value) * 100).toFixed(2)));
  }, [rate]);
  const save = async () => {
    try {
      const n = Number(val.replace(",", "."));
      if (val.trim() === "" || !Number.isFinite(n) || n < 0 || (rule === "PCT_REVENUE" && n > 100)) throw new Error(rule === "PCT_REVENUE" ? "Введите процент от 0 до 100" : "Введите сумму в $");
      const v = rule === "CPA_FIXED" ? n : n / 100;
      await adminSetDefaultRate(c, rule, v);
      toast(`Ставка по умолчанию: ${payoutText(rule, v)}`); onDone();
    } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };
  return (
    <section className="pt-card ad-card">
      <h3>💰 Ставка по умолчанию</h3>
      <p className="pt-dim pt-small">Сейчас: <b>{rate ? payoutText(rate.rule, rate.value) : "…"}</b>. Действует для всех партнёров и товаров, если у партнёра или товара не задана своя. % считается от суммы товаров после скидок, без доставки и налога.</p>
      <div className="ad-rate">
        <select className="pt-input sm" value={rule} onChange={(e) => setRule(e.target.value)}>
          <option value="PCT_REVENUE">% от заказа</option>
          <option value="CPA_FIXED">$ фикс за продажу</option>
        </select>
        <input className="pt-input sm" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder={rule === "CPA_FIXED" ? "напр. 5" : "напр. 15"} />
        <button className="pt-btn primary" onClick={save}>Сохранить</button>
      </div>
    </section>
  );
}

function RateEditor({ c, p, onDone, toast }: { c: SupabaseClient; p: AdminPartner; onDone: () => void; toast: (m: string) => void }) {
  const [rule, setRule] = useState(p.payout_rule ?? "");
  const [val, setVal] = useState(p.payout_value === null ? "" : String(p.payout_rule === "CPA_FIXED" ? p.payout_value : +(Number(p.payout_value) * 100).toFixed(2)));
  const save = async () => {
    try {
      const n = val.trim() === "" ? null : Number(val.replace(",", "."));
      if (rule && (n === null || !Number.isFinite(n) || n < 0)) throw new Error("Введите число");
      await adminSetRate(c, p.id, rule || null, rule ? (rule === "CPA_FIXED" ? n : (n as number) / 100) : null);
      toast(`Ставка @${p.login}: ${rule ? payoutText(rule, rule === "CPA_FIXED" ? n : (n as number) / 100) : "по умолчанию"}`); onDone();
    } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };
  return (
    <div className="ad-rate">
      <select className="pt-input sm" value={rule} onChange={(e) => setRule(e.target.value)}>
        <option value="">Ставка: по умолчанию</option>
        <option value="CPA_FIXED">$ за продажу</option>
        <option value="PCT_REVENUE">% от суммы заказа</option>
      </select>
      {rule && <input className="pt-input sm" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder={rule === "CPA_FIXED" ? "напр. 5" : "напр. 10"} />}
      <button className="pt-btn" onClick={save}>Сохранить</button>
    </div>
  );
}

export function AdminApp() {
  const [c, setC] = useState<SupabaseClient | null>(null);
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [who, setWho] = useState<{ is_admin: boolean; login: string | null } | null>(null);
  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [tab, setTab] = useState<Tab>("requests");
  const [msg, setMsg] = useState("");
  const [newPw, setNewPw] = useState<{ login: string; pw: string } | null>(null);
  const [newAdmin, setNewAdmin] = useState("");
  const [q, setQ] = useState("");
  const [defRate, setDefRate] = useState<Rate | null>(null);

  useEffect(() => { setC(sb()); setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    if (!c) { setReady(true); return; }
    c.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [c, mounted]);
  const uid = session?.user.id;
  useEffect(() => { if (c && uid) adminWhoami(c).then(setWho).catch(() => setWho({ is_admin: false, login: null })); else setWho(null); }, [c, uid]);

  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? "" : x)), 4000); };
  const reload = useCallback(async () => {
    if (!c || !who?.is_admin) return;
    try { const [p, a, d] = await Promise.all([adminPartners(c), adminListAdmins(c), adminGetDefaultRate(c)]); setPartners(p); setAdmins(a); setDefRate(d); } catch (e) { toast("Ошибка: " + (e as Error).message); }
  }, [c, who]);
  useEffect(() => { reload(); }, [reload]);

  const setStatus = async (p: AdminPartner, st: string, label: string) => {
    if (!c) return;
    try { await adminSetStatus(c, p.id, st); toast(`@${p.login}: ${label}`); reload(); } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };
  const resetPw = async (p: AdminPartner) => {
    if (!c || !confirm(`Сменить пароль @${p.login}? Старый перестанет работать.`)) return;
    const pw = genPassword();
    try { await adminResetPassword(c, p.id, pw); setNewPw({ login: p.login, pw }); } catch (e) { toast("Ошибка: " + (e as Error).message); }
  };

  const pending = partners.filter((p) => p.status === "PENDING");
  const others = partners.filter((p) => p.status !== "PENDING" && (!q || p.login.includes(q.toLowerCase()) || (p.telegram ?? "").toLowerCase().includes(q.toLowerCase())));

  let body: React.ReactNode;
  if (!mounted || !ready) body = <div className="pt-loading">Загрузка…</div>;
  else if (!supabaseConfigured || !c) body = <section className="pt-card"><p>База не подключена.</p></section>;
  else if (!session) body = <AdminLogin c={c} />;
  else if (!who) body = <div className="pt-loading">Проверяю права…</div>;
  else if (!who.is_admin) body = (
    <section className="pt-card pt-login"><div className="pt-emoji">🚫</div><h2>Нет прав админа</h2>
      <p>Этот аккаунт не в списке админов.</p><button className="pt-btn wide" onClick={() => c.auth.signOut()}>Выйти</button></section>
  );
  else body = (
    <>
      <nav className="pt-tabs">
        <button className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>📝 Заявки{pending.length ? ` (${pending.length})` : ""}</button>
        <button className={tab === "partners" ? "on" : ""} onClick={() => setTab("partners")}>👥 Партнёры</button>
        <button className={tab === "admins" ? "on" : ""} onClick={() => setTab("admins")}>🛡 Админы</button>
      </nav>
      {newPw && (
        <section className="pt-card ad-newpw">
          <h3>Новый пароль для @{newPw.login}</h3>
          <div className="pt-linkbox">{newPw.pw}</div>
          <p className="pt-dim pt-small">Отправьте партнёру в Telegram. Больше он здесь не покажется.</p>
          <div className="pt-row">
            <button className="pt-btn primary" onClick={() => navigator.clipboard?.writeText(`Логин: ${newPw.login}\nНовый пароль: ${newPw.pw}\nВход: ${window.location.origin}${window.location.pathname.replace(/admin\/?$/, "partner/")}`)}>📋 Копировать для отправки</button>
            <button className="pt-btn" onClick={() => setNewPw(null)}>Готово</button>
          </div>
        </section>
      )}

      {tab === "requests" && (
        !pending.length ? <section className="pt-card"><p className="pt-dim">Новых заявок нет 🎉</p></section> : pending.map((p) => (
          <section className="pt-card ad-card" key={p.id}>
            <div className="ad-head"><b>@{p.login}</b><span className="pt-dim pt-small">{fmtDate(p.created_at)}</span></div>
            <Socials p={p} />
            <div className="pt-row ad-actions">
              <button className="pt-btn primary" onClick={() => setStatus(p, "ACTIVE", "одобрен ✅")}>✅ Одобрить</button>
              <button className="pt-btn" onClick={() => { if (confirm(`Отклонить заявку @${p.login}?`)) setStatus(p, "REJECTED", "отклонён"); }}>✖ Отклонить</button>
            </div>
          </section>
        ))
      )}

      {tab === "partners" && (
        <>
          <DefaultRateEditor c={c} rate={defRate} onDone={reload} toast={toast} />
          <input className="pt-input" style={{ marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Поиск по логину или Telegram" />
          {!others.length && <section className="pt-card"><p className="pt-dim">Пока никого.</p></section>}
          {others.map((p) => (
            <section className={`pt-card ad-card ${p.status !== "ACTIVE" ? "ad-off" : ""}`} key={p.id}>
              <div className="ad-head"><b>@{p.login}</b><span className={`ad-st st-${p.status}`}>{STATUS[p.status] ?? p.status}</span></div>
              <Socials p={p} />
              <div className="ad-stats">
                <span>🔗 {p.links}</span><span>👆 {p.clicks}</span><span>🛒 {p.orders}</span><span>💵 {usd(p.revenue_cents)}</span>
                <span>💰 {usd(p.earned_cents)}</span><span>💸 {usd(p.paid_cents)}</span>
              </div>
              <div className="pt-dim pt-small">Ставка: <b>{p.effective ? payoutText(p.effective.rule, p.effective.value) : p.payout_rule ? payoutText(p.payout_rule, p.payout_value) : "по умолчанию"}</b> ({p.payout_rule ? "индивидуальная" : "по умолчанию"}) · с {fmtDate(p.created_at)}</div>
              <RateEditor c={c} p={p} onDone={reload} toast={toast} />
              <div className="pt-row ad-actions">
                {p.status === "ACTIVE"
                  ? <button className="pt-btn" onClick={() => { if (confirm(`Заблокировать @${p.login}? Его ссылки перестанут засчитываться.`)) setStatus(p, "FROZEN", "заблокирован"); }}>⛔ Заблокировать</button>
                  : <button className="pt-btn primary" onClick={() => setStatus(p, "ACTIVE", "активен")}>✅ {p.status === "REJECTED" ? "Одобрить" : "Разблокировать"}</button>}
                {p.has_account && <button className="pt-btn" onClick={() => resetPw(p)}>🔑 Новый пароль</button>}
              </div>
            </section>
          ))}
          <p className="pt-note">💵 сумма заказов · 💰 начислено · 💸 выплачено. Подробная аналитика и выплаты — в <Link href="/analytics">/analytics</Link> (режим «База»).</p>
        </>
      )}

      {tab === "admins" && (
        <section className="pt-card">
          <h3>Админы</h3>
          <div className="pt-links">
            {admins.map((a) => (
              <div className="pt-link ad-admin" key={a.id}>
                <span><b>{a.login ? "@" + a.login : a.email}</b> <span className="pt-dim pt-small">с {fmtDate(a.created_at)}</span></span>
                <button className="pt-btn" onClick={async () => { if (!confirm("Убрать из админов?")) return; try { await adminRemoveAdmin(c, a.id); toast("Убран"); reload(); } catch (e) { toast("Ошибка: " + (e as Error).message); } }}>Убрать</button>
              </div>
            ))}
          </div>
          <label className="pt-label">Добавить админа по логину
            <input className="pt-input" autoCapitalize="none" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder="логин" />
            <span className="pt-hint">Человек сначала регистрируется на /partner/ (Регистрация), потом вы добавляете его логин здесь.</span>
          </label>
          <button className="pt-btn primary wide" disabled={!newAdmin.trim()} onClick={async () => { try { await adminAddAdmin(c, newAdmin); toast(`@${newAdmin} теперь админ`); setNewAdmin(""); reload(); } catch (e) { toast("Ошибка: " + (e as Error).message); } }}>Добавить</button>
        </section>
      )}
    </>
  );

  return (
    <div className="pt-shell">
      <header className="pt-top">
        <div className="logo-dot" aria-hidden />
        <div className="pt-top-t"><b>Likky · админка</b>{who?.login && <span>@{who.login}</span>}</div>
        {session && <button className="pt-linkbtn" onClick={() => c?.auth.signOut()}>Выйти</button>}
      </header>
      <main className="pt-main">
        {msg && <div className="ad-toast">{msg}</div>}
        {body}
      </main>
      <footer className="pt-foot"><Link href="/analytics">📊 Аналитика</Link> · <Link href="/partner/">Кабинет партнёра</Link></footer>
    </div>
  );
}
