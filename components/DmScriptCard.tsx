"use client";

import { DEMO_LINK } from "@/lib/fixtures";

export function DmScriptCard({ keyword }: { keyword: string }) {
  const script = `Hey! Link for the glow lamp 👇 ${DEMO_LINK} · Code ${keyword} for tracking. #ad`;
  return (
    <div className="card">
      <h3>DM-скрипт</h3>
      <div className="muted">Keyword → DM · всегда #ad · warm glow only · no flame breath</div>
      <p style={{ fontSize: 13, margin: "10px 0", lineHeight: 1.45 }}>{script}</p>
      <div className="btn-row">
        <button
          className="btn"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(script)}
        >
          Копировать
        </button>
      </div>
    </div>
  );
}
