"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

export interface TourStep { title: string; body: ReactNode; selector?: string; onEnter?: () => void }

const key = (id: string) => `vf_tour_${id}_v1`;

/** First-visit tour: opens automatically once per browser, re-openable via start(). */
export function useTour(id: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(key(id))) setOpen(true); } catch { /* private mode */ }
  }, [id]);
  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => { setOpen(false); try { localStorage.setItem(key(id), new Date().toISOString()); } catch { /* ignore */ } }, [id]);
  return { open, start, close };
}

export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    const step = steps[i];
    step.onEnter?.();
    let el: HTMLElement | null = null;
    let prevPos = ""; let changed = false;
    const t = setTimeout(() => {
      el = step.selector ? (document.querySelector(step.selector) as HTMLElement | null) : null;
      if (el) {
        if (getComputedStyle(el).position === "static") { prevPos = el.style.position; el.style.position = "relative"; changed = true; }
        el.classList.add("tour-hl");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
    return () => { clearTimeout(t); if (el) { el.classList.remove("tour-hl"); if (changed) el.style.position = prevPos; } };
  }, [open, i, steps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, steps.length]);

  if (!open) return null;
  const step = steps[i];
  const last = i === steps.length - 1;
  return (
    <>
      {!step.selector && <div className="tour-backdrop" onClick={onClose} />}
      <div className="tour-card" role="dialog" aria-label="Обучающий тур">
        <div className="tour-head">
          <span className="tour-count">Шаг {i + 1} из {steps.length}</span>
          <button className="tour-x" onClick={onClose} aria-label="Закрыть тур">✕</button>
        </div>
        <div className="tour-title">{step.title}</div>
        <div className="tour-body">{step.body}</div>
        <div className="tour-dots">{steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}</div>
        <div className="tour-actions">
          <button className="btn" onClick={onClose}>Пропустить</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>← Назад</button>}
          <button className="btn primary" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? "Готово" : "Далее →"}</button>
        </div>
        <div className="tour-foot">Тур можно открыть снова кнопкой «🧭 Тур» в шапке.</div>
      </div>
    </>
  );
}
