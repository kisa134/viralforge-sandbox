"use client";

import { useState } from "react";
import { sb } from "@/lib/analytics/sbClient";

export function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const send = async () => {
    const c = sb();
    if (!c) return;
    setState("sending");
    const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.href.split("#")[0] } });
    if (error) { setErr(error.message); setState("error"); } else setState("sent");
  };
  return (
    <section className="an-card login-card">
      <h2>Вход в кабинет</h2>
      <p className="dim">Живой режим (Supabase). Введите email — придёт ссылка для входа. Доступ только у email из таблицы <code>admins</code>.</p>
      <div className="an-inline">
        <input className="an-input" style={{ width: 280 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <button className="btn primary" disabled={!email.includes("@") || state === "sending"} onClick={send}>{state === "sending" ? "Отправляю…" : "Прислать ссылку"}</button>
      </div>
      {state === "sent" && <div className="an-warn">Ссылка отправлена на {email}. Откройте её в этом же браузере — вернётесь сюда уже залогиненным.</div>}
      {state === "error" && <div className="an-warn">Ошибка: {err}</div>}
      <p className="an-note">«Демо» и «Мои CSV» работают без входа — переключатель «Данные» сверху. Если письмо не пришло за пару минут — проверьте «Спам» (бесплатная почта Supabase ограничена несколькими письмами в час).</p>
    </section>
  );
}
