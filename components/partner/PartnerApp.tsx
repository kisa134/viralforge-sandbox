"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, EmailOtpType } from "@supabase/supabase-js";
import { sb, shortLink, supabaseConfigured } from "@/lib/analytics/sbClient";
import {
  captionFor, createLink, getCatalog, getMe, getStats, payoutText, PLATFORM_ICON, PLATFORM_LABEL, register, usd,
  type CatalogItem, type NewLink, type PPlatform, type Profile, type Stats,
} from "@/lib/partner";

type Tab = "links" | "stats" | "profile";
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Dubai" }) : "—");

async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  }
}
function CopyBtn({ text, label = "Копировать", big = false }: { text: string; label?: string; big?: boolean }) {
  const [ok, setOk] = useState(false);
  return <button className={`pt-btn ${big ? "primary" : ""}`} onClick={async () => { if (await copyText(text)) { setOk(true); setTimeout(() => setOk(false), 1500); } }}>{ok ? "✓ Скопировано" : label}</button>;
}
function Qr({ value, size = 180 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc("")); }, [value, size]);
  return src ? <img className="pt-qr" src={src} width={size} height={size} alt="QR-код ссылки" /> : null;
}

// ───────────────────────── Login ─────────────────────────
function LoginView({ c, initialError }: { c: SupabaseClient; initialError: string }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError);
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pwMode, setPwMode] = useState(false);
  const [pw, setPw] = useState("");
  const loginPw = async () => {
    setBusy(true); setErr("");
    const { error } = await c.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    setBusy(false);
    if (error) setErr("Неверный email или пароль.");
  };

  const send = async () => {
    setBusy(true); setErr("");
    const { error } = await c.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + window.location.pathname } });
    setBusy(false);
    if (error) setErr(/rate|limit|seconds/i.test(error.message) ? "Слишком много писем подряд. Подождите минуту и попробуйте снова." : error.message);
    else setStep("code");
  };
  const verifyCode = async () => {
    setBusy(true); setErr("");
    const { error } = await c.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr("Код не подошёл или устарел. Запросите новый.");
  };
  const verifyLink = async () => {
    setErr("");
    try {
      const u = new URL(pasted.trim());
      const token = u.searchParams.get("token") ?? u.searchParams.get("token_hash");
      const type = (u.searchParams.get("type") ?? "magiclink") as EmailOtpType;
      if (!token) throw new Error("no token");
      setBusy(true);
      const { error } = await c.auth.verifyOtp({ token_hash: token, type });
      setBusy(false);
      if (error) setErr("Ссылка устарела или уже использована. Запросите новое письмо.");
    } catch { setBusy(false); setErr("Это не похоже на ссылку из письма. Скопируйте ссылку кнопки «Войти» целиком."); }
  };

  return (
    <section className="pt-card pt-login">
      <div className="pt-emoji">👋</div>
      <h2>Кабинет партнёра Likky</h2>
      <p className="pt-dim">Твои ссылки, клики, продажи и выплаты — в одном месте.</p>
      {step === "email" ? (
        <>
          <label className="pt-label">Твой email
            <input className="pt-input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" onKeyDown={(e) => { if (e.key === "Enter" && email.includes("@")) send(); }} />
          </label>
          {pwMode ? (
            <>
              <label className="pt-label">Пароль (если мы выдали его тебе)
                <input className="pt-input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && pw) loginPw(); }} />
              </label>
              <button className="pt-btn primary wide" disabled={!email.includes("@") || !pw || busy} onClick={loginPw}>{busy ? "Вхожу…" : "Войти"}</button>
              <p className="pt-note"><button className="pt-linkbtn" onClick={() => setPwMode(false)}>← Войти по коду из письма</button></p>
            </>
          ) : (
            <>
              <button className="pt-btn primary wide" disabled={!email.includes("@") || busy} onClick={send}>{busy ? "Отправляю…" : "Получить код на почту"}</button>
              <p className="pt-note">Пароль не нужен. Первый вход = регистрация. <button className="pt-linkbtn" onClick={() => setPwMode(true)}>Есть пароль от нас?</button></p>
            </>
          )}
        </>
      ) : (
        <>
          <p>Письмо отправлено на <b>{email}</b>. Проверь «Входящие» и «Спам».</p>
          <label className="pt-label">Код из письма
            <input className="pt-input pt-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" onKeyDown={(e) => { if (e.key === "Enter" && code.length >= 6) verifyCode(); }} />
          </label>
          <button className="pt-btn primary wide" disabled={code.length < 6 || busy} onClick={verifyCode}>{busy ? "Проверяю…" : "Войти"}</button>
          <p className="pt-note">В письме только кнопка-ссылка? Нажми её в этом же браузере. Если она открывает пустую страницу — <button className="pt-linkbtn" onClick={() => setShowPaste((v) => !v)}>вставь ссылку сюда</button>.</p>
          {showPaste && (
            <div className="pt-paste">
              <input className="pt-input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://…supabase.co/auth/v1/verify?token=…" />
              <button className="pt-btn" disabled={!pasted || busy} onClick={verifyLink}>Войти по ссылке</button>
            </div>
          )}
          <button className="pt-linkbtn" onClick={() => { setStep("email"); setCode(""); setErr(""); }}>← Другой email / отправить ещё раз</button>
        </>
      )}
      {err && <div className="pt-err">{err}</div>}
      <p className="pt-note"><Link href="/guide/creator">📋 Как это работает — инструкция и FAQ</Link></p>
    </section>
  );
}

// ───────────────────────── Profile form ─────────────────────────
function ProfileForm({ c, me, email, onSaved }: { c: SupabaseClient; me: Profile | null; email: string; onSaved: (p: Profile) => void }) {
  const [nick, setNick] = useState(me?.nick ?? "");
  const [tg, setTg] = useState(me?.telegram ?? "");
  const [h, setH] = useState<Partial<Record<PPlatform, string>>>(me?.handles ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const nickOk = /^[a-z0-9_]{2,24}$/.test(nick);
  const save = async () => {
    setBusy(true); setErr(""); setOk(false);
    try { const p = await register(c, nick, tg, h); setOk(true); onSaved(p); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="pt-card">
      <h2>{me ? "Профиль" : "Давай знакомиться 🙌"}</h2>
      {!me && <p className="pt-dim">Один раз — и можно брать ссылки.</p>}
      <label className="pt-label">Ник (будет в твоих ссылках)
        <input className="pt-input" value={nick} disabled={Boolean(me)} onChange={(e) => setNick(e.target.value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, ""))} placeholder="mira_glow" maxLength={24} />
        <span className="pt-hint">{me ? "Ник менять нельзя — он уже в ссылках." : "Латиница, цифры, _ · 2–24 символа"}</span>
      </label>
      <label className="pt-label">Telegram (чтобы мы могли написать)
        <input className="pt-input" value={tg} onChange={(e) => setTg(e.target.value)} placeholder="@username" />
      </label>
      {(["TT", "IG", "YT"] as PPlatform[]).map((p) => (
        <label className="pt-label" key={p}>{PLATFORM_ICON[p]} {PLATFORM_LABEL[p]} — аккаунт
          <input className="pt-input" value={h[p] ?? ""} onChange={(e) => setH({ ...h, [p]: e.target.value })} placeholder="@account (если есть)" />
        </label>
      ))}
      <div className="pt-dim pt-small">Email: {email}</div>
      <button className="pt-btn primary wide" disabled={!nickOk || busy} onClick={save}>{busy ? "Сохраняю…" : me ? "Сохранить" : "Готово — в кабинет"}</button>
      {ok && me && <div className="pt-ok">Сохранено ✓</div>}
      {err && <div className="pt-err">{err}</div>}
    </section>
  );
}

// ───────────────────────── Links tab ─────────────────────────
function LinksTab({ c, me, catalog, stats, onCreated }: { c: SupabaseClient; me: Profile; catalog: CatalogItem[]; stats: Stats | null; onCreated: () => void }) {
  const [pid, setPid] = useState<string>("");
  const [platform, setPlatform] = useState<PPlatform>("TT");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<(NewLink & { handle: string }) | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const prod = catalog.find((p) => p.product_id === pid) ?? null;
  const frozen = me.status !== "ACTIVE";
  const handleByTitle = useMemo(() => new Map(catalog.map((p) => [p.title, p.handle])), [catalog]);

  const make = async () => {
    if (!prod) return;
    setBusy(true); setErr("");
    try { const l = await createLink(c, prod.product_id, platform, label); setMade({ ...l, handle: prod.handle }); setLabel(""); onCreated(); setTimeout(() => document.getElementById("pt-made")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const short = made ? shortLink(made.token) ?? made.dest_url : "";
  const cap = made ? captionFor(made.handle, made.platform) : null;

  return (
    <>
      {frozen && <div className="pt-err">Аккаунт приостановлен — новые ссылки недоступны. Напиши нам в Telegram.</div>}
      <section className="pt-card">
        <h3>1. Выбери товар</h3>
        <div className="pt-products">
          {catalog.map((p) => (
            <button key={p.product_id} className={`pt-prod ${pid === p.product_id ? "on" : ""}`} onClick={() => setPid(p.product_id)}>
              {p.image_url ? <img src={p.image_url} alt={p.title} loading="lazy" /> : <div className="pt-noimg">🛍</div>}
              <div className="pt-prod-body">
                <div className="pt-prod-title">{p.title}</div>
                <div className="pt-prod-price">{usd(p.price_cents)} · <span className={p.payout_value === null ? "pt-tbd" : "pt-pay"}>{payoutText(p.payout_rule, p.payout_value)}</span></div>
                {p.pitch && <div className="pt-prod-pitch">{p.pitch}</div>}
              </div>
            </button>
          ))}
        </div>
        {prod?.pdp_url && <a className="pt-small" href={prod.pdp_url} target="_blank" rel="noreferrer">Открыть страницу товара на likky.store ↗</a>}
      </section>
      <section className="pt-card">
        <h3>2. Где выложишь</h3>
        <div className="pt-seg">
          {(["TT", "IG", "YT"] as PPlatform[]).map((p) => (
            <button key={p} className={platform === p ? "on" : ""} onClick={() => setPlatform(p)}>{PLATFORM_ICON[p]} {PLATFORM_LABEL[p]}</button>
          ))}
        </div>
        <label className="pt-label">Подпись для себя (необязательно)
          <input className="pt-input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="например: ролик 12 окт, тёмная комната" />
        </label>
        <button className="pt-btn primary wide" disabled={!prod || busy || frozen} onClick={make}>{busy ? "Создаю…" : prod ? "🔗 Получить мою ссылку" : "Сначала выбери товар"}</button>
        {err && <div className="pt-err">{err}</div>}
      </section>

      {made && cap && (
        <section className="pt-card pt-made" id="pt-made">
          <h3>✅ Твоя ссылка готова</h3>
          <div className="pt-linkbox">{short}</div>
          <div className="pt-row"><CopyBtn text={short} label="📋 Копировать ссылку" big /></div>
          <div className="pt-center"><Qr value={short} /></div>
          <p className="pt-dim pt-small">{made.product_title} · {PLATFORM_LABEL[made.platform]} · код <code>{made.token}</code>. Ставь её в шапку профиля и отправляй в личку. Не обрезай и не меняй ссылку — иначе продажа не засчитается.</p>
          <h4>Подпись к ролику (English)</h4>
          <pre className="pt-pre">{cap.caption}</pre>
          <CopyBtn text={cap.caption} label="Копировать подпись" />
          <h4>Ответ в личку на «{cap.keyword}»</h4>
          <pre className="pt-pre">{cap.dm(short)}</pre>
          <CopyBtn text={cap.dm(short)} label="Копировать ответ" />
          <p className="pt-note">Больше советов — в <Link href="/guide/creator">инструкции</Link>.</p>
        </section>
      )}

      <section className="pt-card">
        <h3>Мои ссылки ({stats?.links.length ?? 0})</h3>
        {!stats?.links.length ? <p className="pt-dim">Пока нет ссылок — создай первую выше.</p> : (
          <div className="pt-links">
            {stats.links.map((l) => {
              const s = shortLink(l.token) ?? "";
              const cp = captionFor(handleByTitle.get(l.product_title ?? "") ?? "", (l.platform ?? "TT") as PPlatform);
              return (
                <div className="pt-link" key={l.token}>
                  <div className="pt-link-top">
                    <b>{l.platform ? PLATFORM_ICON[l.platform] : "🔗"} {l.product_title ?? "—"}</b>
                    <span className="pt-dim pt-small">{fmtDate(l.created_at)}</span>
                  </div>
                  {l.label && <div className="pt-small pt-dim">{l.label}</div>}
                  <div className="pt-linkbox sm">{s}</div>
                  <div className="pt-row">
                    <CopyBtn text={s} />
                    <CopyBtn text={cp.dm(s)} label="Текст для лички" />
                    <button className="pt-btn" onClick={() => setQrFor(qrFor === l.token ? null : l.token)}>QR</button>
                  </div>
                  {qrFor === l.token && <div className="pt-center"><Qr value={s} size={150} /></div>}
                  <div className="pt-mini">👆 {l.clicks} кликов · 🛒 {l.orders} продаж · 💰 {usd(l.held_cents + l.approved_cents + l.paid_cents)}{l.revoked ? " · отключена" : ""}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

// ───────────────────────── Stats tab ─────────────────────────
function StatsTab({ stats, range, setRange, catalog }: { stats: Stats | null; range: string; setRange: (r: string) => void; catalog: CatalogItem[] }) {
  const t = stats?.totals;
  const rateKnown = catalog.some((p) => p.payout_value !== null);
  return (
    <>
      <div className="pt-seg">
        {[["7", "7 дней"], ["30", "30 дней"], ["all", "Всё время"]].map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}
      </div>
      {!rateKnown && <div className="pt-info">Ставка за продажу уточняется — продажи уже считаются, сумма начислится, когда ставка будет задана.</div>}
      <div className="pt-kpis">
        <div className="pt-kpi"><span>Клики</span><b>{t?.clicks ?? 0}</b></div>
        <div className="pt-kpi"><span>Продажи</span><b>{t?.orders ?? 0}</b></div>
        <div className="pt-kpi"><span>Сумма заказов</span><b>{usd(t?.revenue_cents)}</b></div>
        <div className="pt-kpi"><span>⏳ На удержании</span><b>{usd(t?.held_cents)}</b></div>
        <div className="pt-kpi"><span>✅ К выплате</span><b>{usd(t?.approved_cents)}</b></div>
        <div className="pt-kpi"><span>💸 Выплачено</span><b>{usd(t?.paid_cents)}</b></div>
      </div>
      <p className="pt-note">Удержание {stats?.hold_days ?? 14} дней — на случай возврата. Возвраты не оплачиваются. Клики ботов не считаем.</p>
      <section className="pt-card">
        <h3>По ссылкам</h3>
        {!stats?.links.length ? <p className="pt-dim">Нет ссылок.</p> : (
          <div className="pt-tablewrap">
            <table className="pt-table">
              <thead><tr><th>Ссылка</th><th className="num">Клики</th><th className="num">Продажи</th><th className="num">Сумма</th><th className="num">Заработок</th></tr></thead>
              <tbody>
                {stats.links.map((l) => (
                  <tr key={l.token}><td><div>{l.platform ? PLATFORM_ICON[l.platform] : ""} {l.product_title}</div><div className="pt-dim pt-small">{l.label ?? l.token}</div></td>
                    <td className="num">{l.clicks}</td><td className="num">{l.orders}</td><td className="num">{usd(l.revenue_cents)}</td><td className="num">{usd(l.held_cents + l.approved_cents + l.paid_cents)}</td></tr>
                ))}
                {stats.unlinked.orders > 0 && <tr><td className="pt-dim">Без ссылки (засчитано вручную)</td><td className="num">—</td><td className="num">{stats.unlinked.orders}</td><td className="num">{usd(stats.unlinked.revenue_cents)}</td><td className="num">—</td></tr>}
                <tr className="strong"><td>Итого</td><td className="num">{t?.clicks ?? 0}</td><td className="num">{t?.orders ?? 0}</td><td className="num">{usd(t?.revenue_cents)}</td><td className="num">{usd((t?.held_cents ?? 0) + (t?.approved_cents ?? 0) + (t?.paid_cents ?? 0))}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="pt-card">
        <h3>Выплаты</h3>
        {!stats?.payouts.length ? <p className="pt-dim">Выплат пока не было.</p> : (
          <table className="pt-table">
            <thead><tr><th>Дата</th><th>Период</th><th className="num">Сумма</th><th>Статус</th></tr></thead>
            <tbody>{stats.payouts.map((p, i) => (
              <tr key={i}><td>{fmtDate(p.paid_at)}</td><td className="pt-dim pt-small">{fmtDate(p.period_start)}–{fmtDate(p.period_end)}</td><td className="num">{usd(p.amount_cents)}</td>
                <td>{({ PAID: "✅ выплачено", PROCESSING: "⏳ в работе", DRAFT: "готовится", FAILED: "❌ ошибка" } as Record<string, string>)[p.status] ?? p.status}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ───────────────────────── App ─────────────────────────
export function PartnerApp() {
  // Client is created after mount so the static HTML and the first client render match (no hydration mismatch).
  const [c, setC] = useState<SupabaseClient | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setC(sb()); setMounted(true); }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Profile | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("links");
  const [range, setRange] = useState("30");
  const [err, setErr] = useState("");
  const [hashErr, setHashErr] = useState("");

  useEffect(() => {
    if (!mounted) return;
    if (!c) { setReady(true); return; }
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (h.get("error_description")) setHashErr(`Ссылка не сработала: ${h.get("error_description")}. Запросите код ещё раз.`);
    c.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => { setSession(s); if (s && window.location.hash.includes("access_token")) history.replaceState(null, "", window.location.pathname); });
    return () => sub.subscription.unsubscribe();
  }, [c, mounted]);

  const uid = session?.user.id;
  useEffect(() => {
    if (!c || !uid) { setMe(null); setMeLoaded(false); return; }
    getMe(c).then((p) => { setMe(p); setMeLoaded(true); }).catch((e) => { setErr(e.message); setMeLoaded(true); });
  }, [c, uid]);

  const loadStats = useCallback(async () => {
    if (!c || !me) return;
    const from = range === "all" ? null : new Date(Date.now() - Number(range) * 86400000).toISOString();
    try { setStats(await getStats(c, from)); } catch (e) { setErr((e as Error).message); }
  }, [c, me, range]);
  useEffect(() => { if (c && me) getCatalog(c).then(setCatalog).catch((e) => setErr(e.message)); }, [c, me]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const header = (
    <header className="pt-top">
      <div className="logo-dot" aria-hidden />
      <div className="pt-top-t"><b>Likky · партнёр</b>{me && <span>@{me.nick}</span>}</div>
      {session && <button className="pt-linkbtn" onClick={() => c?.auth.signOut()}>Выйти</button>}
    </header>
  );

  let body: React.ReactNode;
  if (!mounted) body = <div className="pt-loading">Загрузка…</div>;
  else if (!supabaseConfigured || !c) body = <section className="pt-card"><p>Кабинет временно недоступен (база не подключена).</p></section>;
  else if (!ready) body = <div className="pt-loading">Загрузка…</div>;
  else if (!session) body = <LoginView c={c} initialError={hashErr} />;
  else if (!meLoaded) body = <div className="pt-loading">Загрузка профиля…</div>;
  else if (!me) body = <ProfileForm c={c} me={null} email={session.user.email ?? ""} onSaved={setMe} />;
  else body = (
    <>
      <nav className="pt-tabs">
        <button className={tab === "links" ? "on" : ""} onClick={() => setTab("links")}>🔗 Ссылки</button>
        <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>📊 Статистика</button>
        <button className={tab === "profile" ? "on" : ""} onClick={() => setTab("profile")}>👤 Профиль</button>
      </nav>
      {tab === "links" && <LinksTab c={c} me={me} catalog={catalog} stats={stats} onCreated={loadStats} />}
      {tab === "stats" && <StatsTab stats={stats} range={range} setRange={setRange} catalog={catalog} />}
      {tab === "profile" && <ProfileForm c={c} me={me} email={session.user.email ?? ""} onSaved={setMe} />}
    </>
  );

  return (
    <div className="pt-shell">
      {header}
      <main className="pt-main">
        {err && <div className="pt-err">Ошибка: {err}</div>}
        {body}
      </main>
      <footer className="pt-foot"><Link href="/guide/creator">📋 Инструкция и FAQ</Link> · likky.store</footer>
    </div>
  );
}
