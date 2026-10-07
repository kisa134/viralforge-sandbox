"use client";

import { DEMO_LINK } from "@/lib/fixtures";

export function LinksCard() {
  return (
    <div className="card">
      <h3>🔗 Мои ссылки</h3>
      <div className="muted">sandbox unique link · клики → фейковый ledger</div>
      <div className="kv">
        <div className="k">Unique link</div>
        <div>
          <a href={DEMO_LINK} onClick={(e) => e.preventDefault()}>
            {DEMO_LINK}
          </a>
        </div>
        <div className="k">Token</div>
        <div>
          <code>demo123</code>
        </div>
        <div className="k">Keywords</div>
        <div>GLOW · BUNDLE · GIFT</div>
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(DEMO_LINK)}
        >
          Копировать ссылку
        </button>
      </div>
    </div>
  );
}
