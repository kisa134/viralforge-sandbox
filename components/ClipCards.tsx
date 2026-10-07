"use client";

import { FAKE_CLIPS } from "@/lib/fixtures";

function formatPlays(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function ClipCards() {
  return (
    <div className="clips-grid">
      {FAKE_CLIPS.map((c) => (
        <div key={c.id} className="clip-card">
          <div className="clip-thumb" style={{ background: c.gradient }}>
            <span>
              #{c.num} · {c.durationSec}s · 9:16
            </span>
            <span>stub mp4 · no HF</span>
          </div>
          <div className="clip-body">
            <div className="hook">{c.hook}</div>
            <div className="caption">{c.caption}</div>
            <div className="clip-meta">
              <span className="kw">keyword {c.keyword}</span>
              <span>slot {c.accountSlot}</span>
              <span>{c.pattern}</span>
              <span>
                {c.proofHandle} · {formatPlays(c.plays)}
              </span>
              <span>{c.formulaId}</span>
            </div>
            <div className="btn-row">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  alert(
                    `Sandbox stub: скачивание clip #${c.num} недоступно.\nKeyword: ${c.keyword}\nFormula: ${c.formulaId}`
                  )
                }
              >
                ⬇ Скачать (stub)
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(c.caption);
                }}
              >
                Caption
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
