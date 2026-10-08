"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dataset } from "@/lib/analytics/model";
import { generateDemo } from "@/lib/analytics/demo";
import { filterByPeriod, type Period } from "@/lib/analytics/metrics";
import { LocalManageStore, SupabaseManageStore, type ManageStore } from "@/lib/analytics/manage";
import { sb, supabaseConfigured } from "@/lib/analytics/sbClient";
import { hasWorkspaceData, type Workspace } from "@/lib/analytics/workspace";
import { Tour, useTour, type TourStep } from "../Tour";
import { ContentTab, CreatorsTab, FunnelTab, RecruitTab } from "./AnalyticsTabs";
import { CreatorsManage, ImportTab, LinksTab, MineOnlyNote, PayoutsTab, SettingsTab, type Act } from "./ManageTabs";
import { Login } from "./Login";

type Tab = "funnel" | "content" | "creators" | "links" | "payouts" | "recruit" | "import" | "settings";
const TABS: [Tab, string][] = [
  ["funnel", "Воронка"], ["content", "Ролики / Формулы"], ["creators", "Креаторы"], ["links", "Ссылки"],
  ["payouts", "Выплаты"], ["recruit", "Найм"], ["import", "Заказы / импорт"], ["settings", "Настройки"],
];
const MANAGE: Tab[] = ["links", "import", "settings"];
type Kind = "DEMO" | "LOCAL" | "DB";
const KIND_KEY = "vf_an_source_v1";

export function AnalyticsCabinet() {
  const localStore = useMemo(() => new LocalManageStore(), []);
  const dbStore = useMemo(() => (supabaseConfigured ? new SupabaseManageStore() : null), []);
  const demo = useMemo<Dataset | null>(() => (typeof window === "undefined" ? null : generateDemo()), []);
  const [kind, setKind] = useState<Kind | null>(null);
  const [auth, setAuth] = useState<"unknown" | "none" | "ok">(supabaseConfigured ? "unknown" : "ok");
  const [email, setEmail] = useState<string | null>(null);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [mine, setMine] = useState<Dataset | null>(null);
  const [tab, setTab] = useState<Tab>("funnel");
  const [period, setPeriod] = useState<Period>(30);
  const [hit, setHit] = useState(10000);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const tour = useTour("analytics");
  const lastKind = useRef<string | null>(null);

  useEffect(() => {
    if (kind) return;
    const saved = typeof window !== "undefined" ? (localStorage.getItem(KIND_KEY) as Kind | null) : null;
    if (saved === "DEMO" || saved === "LOCAL" || (saved === "DB" && supabaseConfigured)) setKind(saved);
    else setKind(hasWorkspaceData() ? "LOCAL" : "DEMO");
  }, [kind]);
  useEffect(() => { if (kind) localStorage.setItem(KIND_KEY, kind); }, [kind]);

  // Management tabs need a writable store: DEMO falls back to «Мои CSV» (browser).
  const mKind: "LOCAL" | "DB" = kind === "DB" && dbStore ? "DB" : "LOCAL";
  const store: ManageStore = mKind === "DB" && dbStore ? dbStore : localStore;

  useEffect(() => {
    const c = sb();
    if (!c) return;
    c.auth.getSession().then(({ data }) => { setAuth(data.session ? "ok" : "none"); setEmail(data.session?.user.email ?? null); });
    const { data } = c.auth.onAuthStateChange((_e, session) => { setAuth(session ? "ok" : "none"); setEmail(session?.user.email ?? null); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (lastKind.current !== mKind) { setWs(null); setMine(null); lastKind.current = mKind; } // switching source: clear; plain refresh: keep UI mounted
    if (mKind === "DB" && auth !== "ok") return;
    let alive = true;
    Promise.all([store.load(), store.dataset()])
      .then(([w, d]) => { if (alive) { setWs(w); setMine(d); } })
      .catch((e) => alive && setToast({ msg: `Ошибка загрузки: ${(e as Error).message}`, err: true }));
    return () => { alive = false; };
  }, [store, mKind, auth, tick]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);

  const act: Act = useCallback(async (fn, okMsg) => {
    try {
      await fn();
      setKind((k) => (k === "DB" ? "DB" : "LOCAL"));
      setTick((t) => t + 1);
      if (okMsg) setToast({ msg: okMsg });
    } catch (e) { setToast({ msg: (e as Error).message, err: true }); }
  }, []);

  const data = kind === "DEMO" ? demo : mine;
  const view = useMemo(() => (data ? filterByPeriod(data, period) : null), [data, period]);
  const isDemo = kind === "DEMO";
  const needLogin = kind === "DB" && auth !== "ok";
  const toMine = () => setKind("LOCAL");

  const steps: TourStep[] = useMemo(() => [
    { title: "Кабинет сквозной аналитики", body: <>Здесь вся цепочка: <b>креатор → ссылка с меткой ref → пост → заказ Shopify → начисление → выплата</b>. Тур — 6 шагов.</> },
    { title: "Демо / Мои CSV / База", selector: ".an-controls", body: <><b>Демо</b> — выдуманные цифры, чтобы посмотреть логику. <b>Мои CSV</b> — ваши креаторы и заказы из выгрузки Shopify, хранятся только в этом браузере. <b>База</b> — живой режим: Supabase, вход по email, клики и заказы приходят сами. Баннер сверху всегда показывает, что открыто.</> },
    { title: "1. Креаторы", selector: '[data-tab="creators"]', onEnter: () => setTab("creators"), body: <>Добавьте креатора (ник, контакт, соцсети). Ничего заводить в Shopify не нужно — креатор узнаётся по метке в его ссылках.</> },
    { title: "2. Ссылки на посты", selector: '[data-tab="links"]', onEnter: () => setTab("links"), body: <>Выберите креатора и товар → ссылка прямо на товар с меткой <code>ref</code> (= код поста) + кодовое слово, текст для DM и QR. По этой метке заказ привяжется к креатору.</> },
    { title: "3. Заказы", selector: '[data-tab="import"]', onEnter: () => setTab("import"), body: <>В «Базе» заказы приходят сами (вебхук Shopify) и привязываются по <code>ref</code>. В «Мои CSV» — загрузите Orders → Export; в CSV Shopify нет источника, поэтому креатора выбираете вручную в таблице (или колонка <code>creator</code>).</> },
    { title: "4. Выплаты и настройки", selector: '[data-tab="payouts"]', onEnter: () => setTab("payouts"), body: <>«К выплате» — начисления, у которых прошло удержание (14 дней). Перевели деньги — «Отметить выплачено». Сумму за продажу и COGS задайте в «Настройках». Подробно — «❓ Как это работает».</> },
  ], []);

  return (
    <div className="an-shell">
      {isDemo ? (
        <div className="an-demo-banner">DEMO · СГЕНЕРИРОВАННЫЕ ПРИМЕРНЫЕ ДАННЫЕ · НЕ РЕАЛЬНЫЕ ЦИФРЫ LIKKY / VIRALFORGE</div>
      ) : (
        <div className="an-real-banner">{kind === "DB" ? "БАЗА · живой режим (Supabase): реальные клики и заказы" : "МОИ CSV · реальные данные, хранятся только в этом браузере (бэкап — вкладка «Заказы / импорт»)"}</div>
      )}
      <header className="topbar an-topbar">
        <div className="logo-dot" aria-hidden />
        <div>
          <h1>ViralForge · Аналитика</h1>
          <div className="sub">Креатор → ссылка → пост → заказ → начисление → выплата</div>
        </div>
        <div className="hdr-links">
          <Link className="hdr-btn" href="/">💬 Чат</Link>
          <Link className="hdr-btn nav-link-guide" href="/guide">❓ Как это работает</Link>
          <button className="hdr-btn nav-tour" onClick={tour.start}>🧭 Тур</button>
          {email && <button className="hdr-btn" onClick={() => sb()?.auth.signOut()}>Выйти ({email})</button>}
        </div>
      </header>

      <div className="an-controls">
        <div className="an-seg">
          <span className="an-seg-label">Данные:</span>
          <button className={`an-chip src-demo ${kind === "DEMO" ? "on" : ""}`} onClick={() => setKind("DEMO")} title="Сгенерированный пример">Демо</button>
          <button className={`an-chip src-mine ${kind === "LOCAL" ? "on" : ""}`} onClick={() => setKind("LOCAL")} title="Ваши данные в этом браузере, импорт CSV из Shopify">Мои CSV</button>
          <button className={`an-chip src-db ${kind === "DB" ? "on" : ""}`} onClick={() => supabaseConfigured ? setKind("DB") : setToast({ msg: "База не подключена в этой сборке (нет NEXT_PUBLIC_SUPABASE_*). См. docs/GO_LIVE.md", err: true })} title="Живой режим: Supabase, вход по email">База{kind === "DB" && auth === "ok" ? " ✓" : ""}</button>
        </div>
        <div className="an-seg">
          <span className="an-seg-label">Период:</span>
          {([7, 30, 0] as Period[]).map((p) => (
            <button key={p} className={`an-chip ${period === p ? "on" : ""}`} onClick={() => setPeriod(p)}>{p ? `${p} дн` : "всё время"}</button>
          ))}
        </div>
      </div>

      <nav className="an-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} data-tab={id} className={`an-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {isDemo && !MANAGE.includes(tab) && demo && <div className="an-warn demo">• {demo.meta.warnings[0]}</div>}
      {!isDemo && mine && !MANAGE.includes(tab) && mine.meta.warnings.length > 0 && (
        <div className="an-warn">{mine.meta.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
      )}

      <main className="an-main">
        {needLogin ? (auth === "unknown" ? <div className="empty-hint">Проверяем вход…</div> : <Login />) : !view || !ws ? <div className="empty-hint">Загрузка…</div> : (
          <>
            {tab === "funnel" && <FunnelTab d={view} demo={isDemo} />}
            {tab === "content" && <ContentTab d={view} demo={isDemo} hit={hit} setHit={setHit} />}
            {tab === "creators" && (
              <>
                <CreatorsManage store={store} ws={ws} mine={mine} act={act} />
                <CreatorsTab d={view} demo={isDemo} period={period} />
              </>
            )}
            {tab === "links" && <><MineOnlyNote isDemo={isDemo} onSwitch={toMine} /><LinksTab store={store} ws={ws} mine={mine} act={act} /></>}
            {tab === "payouts" && <PayoutsTab d={view} demo={isDemo} store={store} act={act} />}
            {tab === "recruit" && <RecruitTab d={view} demo={isDemo} />}
            {tab === "import" && <><MineOnlyNote isDemo={isDemo} onSwitch={toMine} /><ImportTab store={store} ws={ws} mine={mine} act={act} /></>}
            {tab === "settings" && <><MineOnlyNote isDemo={isDemo} onSwitch={toMine} /><SettingsTab key={tick} store={store} ws={ws} act={act} /></>}
          </>
        )}
      </main>
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.msg}</div>}
      <Tour steps={steps} open={tour.open} onClose={tour.close} />
      <footer className="an-footer">
        Формулы метрик: <code>docs/ANALYTICS_SYSTEM.md</code> · запуск живого режима: <code>docs/GO_LIVE.md</code> · схема БД: <code>supabase/migrations</code>.
        {isDemo && " Все числа в DEMO — пример."}
      </footer>
    </div>
  );
}
