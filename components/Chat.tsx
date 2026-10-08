"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreatorState, Message, QuickReply } from "@/lib/types";
import { FAKE_CLIPS } from "@/lib/fixtures";
import { OfferCard } from "./OfferCard";
import { ClipCards } from "./ClipCards";
import { ProgressCard } from "./ProgressCard";
import { StatusCard } from "./StatusCard";
import { PayoutCard } from "./PayoutCard";
import { DmScriptCard } from "./DmScriptCard";
import { LinksCard } from "./LinksCard";
import { SANDBOX_OFFER, DEMO_LINK } from "@/lib/fixtures";

let msgSeq = 0;
let bootOnce = false;
function mid() {
  msgSeq += 1;
  return `m_${Date.now()}_${msgSeq}`;
}

const INITIAL: CreatorState = {
  phase: "boot",
  niche: null,
  geo: null,
  social: null,
  offerClaimed: false,
  clipsReady: false,
  postedClip: null,
  balance: 0,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<CreatorState>(INITIAL);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressStep, setProgressStep] = useState(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const scrollDown = () => {
    requestAnimationFrame(() =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    );
  };

  const push = useCallback((m: Omit<Message, "id" | "ts">) => {
    setMessages((prev) => [...prev, { ...m, id: mid(), ts: Date.now() }]);
    scrollDown();
  }, []);

  const pushBot = useCallback(
    (text: string) => push({ role: "bot", kind: "text", text }),
    [push]
  );
  const pushUser = useCallback(
    (text: string) => push({ role: "user", kind: "text", text }),
    [push]
  );
  const pushSystem = useCallback(
    (kind: Message["kind"], text?: string) =>
      push({ role: "system", kind, text }),
    [push]
  );

  const showOffer = useCallback(() => {
    setState((s) => ({ ...s, phase: "offer" }));
    pushSystem("offer");
    setReplies([
      { id: "claim", label: "✅ Claim", payload: "Беру оффер" },
      { id: "status", label: "Статус", payload: "статус" },
      { id: "help", label: "Помощь", payload: "помощь" },
    ]);
  }, [pushSystem]);

  const startOnboarding = useCallback(async () => {
    setBusy(true);
    pushBot(
      "Привет. ViralForge платит за продажи с твоих Reels/Shorts — не за просмотры.\nSandbox demo · реальных денег нет."
    );
    await sleep(400);
    pushBot("Нужна 1 мин: ниша, гео, аккаунт. Выбери нишу:");
    setState((s) => ({ ...s, phase: "niche" }));
    setReplies([
      { id: "decor", label: "🏠 Decor/Home", payload: "Decor/Home" },
      { id: "beauty", label: "💄 Beauty", payload: "Beauty" },
      { id: "gifts", label: "🎁 Gifts", payload: "Gifts" },
      { id: "fitness", label: "🏋️ Fitness", payload: "Fitness" },
    ]);
    setBusy(false);
  }, [pushBot]);

  useEffect(() => {
    if (bootOnce) return;
    bootOnce = true;
    void startOnboarding();
  }, [startOnboarding]);

  const runGenerate = useCallback(async () => {
    setBusy(true);
    setState((s) => ({ ...s, phase: "generating" }));
    setReplies([]);
    pushBot("Apify stub: топ Reels ниши Decor… (без spend)\nTrend ✓ → Formula cards 3 → Clips 0/3");
    pushSystem("progress");
    setProgressStep(1);
    await sleep(2000);
    setProgressStep(2);
    await sleep(2000);
    setProgressStep(3);
    await sleep(2000);
    setProgressStep(4);
    await sleep(2000);
    setState((s) => ({ ...s, phase: "delivered", clipsReady: true }));
    pushBot(
      "Готово. 3 stub-клипа + captions + keywords из formula-cards.example.json. Higgsfield не вызывали."
    );
    pushSystem("clips");
    pushBot(
      "Пости вручную. Keyword в комментах → DM со ссылкой.\n«Мои ссылки» · «Выплаты» · «запостил #N»."
    );
    setReplies([
      { id: "post1", label: "Запостил #1", payload: "запостил #1" },
      { id: "post2", label: "Запостил #2", payload: "запостил #2" },
      { id: "post3", label: "Запостил #3", payload: "запостил #3" },
      { id: "links", label: "🔗 Мои ссылки", payload: "мои ссылки" },
      { id: "status", label: "Статус", payload: "статус" },
      { id: "payout", label: "Выплаты", payload: "выплата" },
      { id: "gen", label: "Сделай видосы снова", payload: "сделай видосы" },
    ]);
    setBusy(false);
  }, [pushBot, pushSystem]);

  const handleIntent = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      const lower = text.toLowerCase();
      const s = stateRef.current;

      pushUser(text);
      setInput("");
      setBusy(true);
      await sleep(250);

      // --- onboarding branches ---
      if (s.phase === "niche") {
        const niche = text.includes("Decor")
          ? "Decor/Home"
          : text.includes("Beauty")
            ? "Beauty"
            : text.includes("Gift")
              ? "Gifts"
              : text.includes("Fitness")
                ? "Fitness"
                : text;
        setState((prev) => ({ ...prev, niche, phase: "geo" }));
        pushBot("Гео аудитории?");
        setReplies([
          { id: "us", label: "US", payload: "US" },
          { id: "uk", label: "UK", payload: "UK" },
          { id: "eu", label: "EU", payload: "EU" },
          { id: "gcc", label: "GCC", payload: "GCC" },
          { id: "ru", label: "RU/CIS", payload: "RU/CIS" },
        ]);
        setBusy(false);
        return;
      }

      if (s.phase === "geo") {
        setState((prev) => ({ ...prev, geo: text.toUpperCase(), phase: "social" }));
        pushBot(
          "Пришли 1 ссылку на IG / TikTok / YT Shorts (или нажми демо-слот)."
        );
        setReplies([
          {
            id: "demo",
            label: "@glow.home.us (demo)",
            payload: "https://instagram.com/glow.home.us",
          },
        ]);
        setBusy(false);
        return;
      }

      if (s.phase === "social") {
        const handle = text.includes("instagram") || text.startsWith("@") || text.startsWith("http")
          ? text
          : `@${text}`;
        setState((prev) => ({
          ...prev,
          social: handle,
          phase: "offer",
        }));
        pushBot(
          `Слот A = IG · ${handle} · tier New · KYC не нужен (<$100).\nИщу оффер дня…`
        );
        await sleep(500);
        showOffer();
        setBusy(false);
        return;
      }

      // --- intents ---
      if (
        lower.includes("беру оффер") ||
        lower === "claim" ||
        lower.includes("claim")
      ) {
        if (!s.offerClaimed && (s.phase === "offer" || s.phase === "claimed" || s.phase === "delivered" || s.phase === "posted" || s.phase === "generating" || s.phase === "payout")) {
          setState((prev) => ({
            ...prev,
            offerClaimed: true,
            phase: "claimed",
          }));
          pushBot(
            "Оффер закреплён: Sandbox Glow Dragon Lamp · CPA $8/order.\nНапиши «сделай видосы» — ~8с симуляция → 3 stub-клипа."
          );
          setReplies([
            { id: "gen", label: "🎬 Сделай видосы", payload: "сделай видосы" },
            { id: "links", label: "🔗 Мои ссылки", payload: "мои ссылки" },
            { id: "status", label: "Статус", payload: "статус" },
            { id: "payout", label: "Выплаты", payload: "выплата" },
          ]);
        } else if (s.offerClaimed) {
          pushBot("Уже закреплён. Жми «сделай видосы».");
        } else {
          pushBot("Сначала пройди онбординг — оффер появится сам.");
        }
        setBusy(false);
        return;
      }

      if (
        lower.includes("сделай видосы") ||
        lower.includes("генери") ||
        lower.includes("make clips")
      ) {
        if (!stateRef.current.offerClaimed) {
          pushBot("Сначала закрепи оффер кнопкой «Беру оффер».");
          setBusy(false);
          return;
        }
        setBusy(false);
        await runGenerate();
        return;
      }


      if (
        lower.includes("ссыл") ||
        lower.includes("мои ссылки") ||
        lower.includes("link")
      ) {
        pushSystem("links");
        pushBot(
          "Твоя ссылка: " + DEMO_LINK + "\nВ DM после keyword кидай её + #ad."
        );
        setReplies([
          { id: "status", label: "Статус", payload: "статус" },
          { id: "payout", label: "Выплаты", payload: "выплата" },
          { id: "gen", label: "Сделай видосы", payload: "сделай видосы" },
        ]);
        setBusy(false);
        return;
      }

      if (lower.includes("статус") || lower === "/status") {
        pushSystem("status");
        setBusy(false);
        return;
      }

      if (
        lower.includes("выплат") ||
        lower.includes("вывести") ||
        lower === "/payout" ||
        lower.includes("payout")
      ) {
        setState((prev) => ({ ...prev, phase: "payout" }));
        pushSystem("payout");
        pushBot(
          "пока sandbox — выплат нет. Баланс $0 · Sheet ledger stub. Live Wise/USDT — после founder unlock."
        );
        setBusy(false);
        return;
      }

      if (lower.includes("запостил") || lower.includes("posted")) {
        const match = lower.match(/#?\s*([123])/);
        const num = match ? Number(match[1]) : 1;
        const clip = FAKE_CLIPS.find((c) => c.num === num) ?? FAKE_CLIPS[0];
        setState((prev) => ({
          ...prev,
          phase: "posted",
          postedClip: clip.num,
        }));
        pushSystem("post_ack");
        pushBot(
          `Bound: Clip#${clip.num} ↔ permalink (stub).\nTracking link live · keyword ${clip.keyword} active.`
        );
        pushSystem("dm_script");
        setReplies([
          { id: "links", label: "🔗 Мои ссылки", payload: "мои ссылки" },
          { id: "status", label: "Статус", payload: "статус" },
          { id: "payout", label: "Выплаты", payload: "выплата" },
          { id: "gen", label: "Сделай видосы", payload: "сделай видосы" },
        ]);
        setBusy(false);
        return;
      }

      if (lower.includes("старт") || lower === "/start" || lower.includes("заново")) {
        setState(INITIAL);
        setMessages([]);
        setReplies([]);
        setBusy(false);
        await startOnboarding();
        return;
      }

      if (lower.includes("помощ") || lower === "/help" || lower.includes("help")) {
        pushBot(
          "Команды:\n• Беру оффер\n• сделай видосы\n• статус\n• запостил #1|#2|#3\n• выплата\n• старт — заново\n\nSandbox: без auth, DB, Shopify, Higgsfield, live money."
        );
        setBusy(false);
        return;
      }

      // free text during offer phase → nudge
      if (s.phase === "offer" && !s.offerClaimed) {
        pushBot("Жми «Беру оффер», чтобы закрепить sandbox SKU.");
        setBusy(false);
        return;
      }

      pushBot(
        "Не понял. Напиши «помощь» или выбери кнопку ниже."
      );
      setBusy(false);
    },
    [busy, pushBot, pushUser, pushSystem, showOffer, runGenerate, startOnboarding]
  );

  const onClaim = () => {
    void handleIntent("Беру оффер");
  };

  const renderBody = (m: Message) => {
    if (m.kind === "text") {
      return <div className="bubble">{m.text}</div>;
    }
    if (m.kind === "offer") {
      return (
        <div className="bubble">
          <OfferCard
            claimed={state.offerClaimed}
            onClaim={onClaim}
          />
        </div>
      );
    }
    if (m.kind === "progress") {
      return (
        <div className="bubble">
          <ProgressCard step={progressStep} />
        </div>
      );
    }
    if (m.kind === "clips") {
      return (
        <div className="bubble">
          <ClipCards />
        </div>
      );
    }
    if (m.kind === "status") {
      return (
        <div className="bubble">
          <StatusCard state={state} />
        </div>
      );
    }
    if (m.kind === "payout") {
      return (
        <div className="bubble">
          <PayoutCard balance={state.balance} />
        </div>
      );
    }
    if (m.kind === "links") {
      return (
        <div className="bubble">
          <LinksCard />
        </div>
      );
    }
    if (m.kind === "dm_script") {
      const n = state.postedClip ?? 1;
      const kw = FAKE_CLIPS.find((c) => c.num === n)?.keyword ?? "GLOW";
      return (
        <div className="bubble">
          <DmScriptCard keyword={kw} />
        </div>
      );
    }
    if (m.kind === "post_ack") {
      return null;
    }
    return <div className="bubble">{m.text}</div>;
  };

  return (
    <div className="app-shell">
      <div className="sandbox-banner">SANDBOX v1 · no live payouts · no Higgsfield/Apify API</div>
      <header className="topbar">
        <div className="logo-dot" aria-hidden />
        <div>
          <h1>ViralForge</h1>
          <div className="sub">CPA Chat OS · v1 sandbox</div>
        </div>
        <span className="badge">SANDBOX v1</span>
        <Link className="nav-link-analytics" href="/analytics">📊 Аналитика</Link>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-hint">Загрузка онбординга…</div>
        )}
        {messages.map((m) => {
          if (m.kind === "post_ack") return null;
          return (
            <div key={m.id} className={`msg-row ${m.role}`}>
              {renderBody(m)}
              <div className="meta">
                {m.role === "user" ? "ты" : m.role === "system" ? "card" : "ViralForge"}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="msg-row bot">
            <div className="bubble">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {replies.length > 0 && (
          <div className="quick-replies">
            {replies.map((r) => (
              <button
                key={r.id}
                type="button"
                className="qr"
                disabled={busy}
                onClick={() => void handleIntent(r.payload)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleIntent(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Напиши или выбери кнопку…"
            disabled={busy}
            aria-label="Сообщение"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            →
          </button>
        </form>
      </div>
    </div>
  );
}
