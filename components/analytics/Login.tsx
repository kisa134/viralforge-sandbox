"use client";

import Link from "next/link";
import { useState } from "react";
import { sb } from "@/lib/analytics/sbClient";
import { loginToEmail } from "@/lib/partner";

export function Login() {
  const [mode, setMode] = useState<"password" | "email">("password");
  const [login, setLogin] = useState("");
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const signIn = async () => {
    const c = sb(); if (!c) return;
    setState("sending");
    const { error } = await c.auth.signInWithPassword({ email: loginToEmail(login), password: pw });
    if (error) { setErr("Неверный логин или пароль"); setState("error"); } else setState("idle");
  };
  const send = async () => {
    const c = sb(); if (!c) return;
    setState("sending");
    const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.href.split("#")[0] } });
    if (error) { setErr(error.message); setState("error"); } else setState("sent");
  };
  return (
    <section className="an-card login-card">
      <h2>Вход в кабинет</h2>
      <p className="dim">Живой режим (Supabase). Доступ только у админов (таблица <code>admins</code>). Управление заявками партнёров — в <Link href="/admin/">/admin/</Link>.</p>
      {mode === "password" ? (
        <div className="an-inline">
          <input className="an-input" style={{ width: 180 }} autoCapitalize="none" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="логин (напр. admin)" />
          <input className="an-input" style={{ width: 180 }} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="пароль" onKeyDown={(e) => { if (e.key === "Enter" && login && pw) signIn(); }} />
          <button className="btn primary" disabled={!login || !pw || state === "sending"} onClick={signIn}>{state === "sending" ? "Вхожу…" : "Войти"}</button>
        </div>
      ) : (
        <div className="an-inline">
          <input className="an-input" style={{ width: 280 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <button className="btn primary" disabled={!email.includes("@") || state === "sending"} onClick={send}>{state === "sending" ? "Отправляю…" : "Прислать ссылку"}</button>
        </div>
      )}
      {state === "sent" && <div className="an-warn">Ссылка отправлена на {email}. Откройте её в этом же браузере.</div>}
      {state === "error" && <div className="an-warn">Ошибка: {err}</div>}
      <p className="an-note">
        <button className="btn sm" onClick={() => { setMode(mode === "password" ? "email" : "password"); setState("idle"); }}>{mode === "password" ? "Войти по email-ссылке" : "Войти по логину и паролю"}</button>{" "}
        «Демо» и «Мои CSV» работают без входа — переключатель «Данные» сверху. Email-вход требует своего SMTP в Supabase.
      </p>
    </section>
  );
}
