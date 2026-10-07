"use client";

import { SANDBOX_OFFER } from "@/lib/fixtures";

type Props = {
  claimed: boolean;
  onClaim: () => void;
};

export function OfferCard({ claimed, onClaim }: Props) {
  const o = SANDBOX_OFFER;
  return (
    <div className="card">
      <div className="muted">Оффер дня · sandbox</div>
      <h3>{o.sku}</h3>
      <div className="muted">{o.subtitle}</div>
      <div className="kv">
        <div className="k">Цена</div>
        <div>
          <strong>{o.priceDisplay}</strong>
        </div>
        <div className="k">CPA</div>
        <div>
          <strong>${o.cpa}</strong> первый заказ
        </div>
        <div className="k">RevShare</div>
        <div>
          <strong>{o.revSharePct}%</strong> LTV (после рефандов)
        </div>
        <div className="k">Гео</div>
        <div>{o.geo}</div>
        <div className="k">Лимит</div>
        <div>{o.creativeLimit}</div>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>
        Claim-strip
      </div>
      <div className="pill-row">
        {o.claimStrip.ban.map((b) => (
          <span key={b} className="pill ban">
            ❌ {b}
          </span>
        ))}
        {o.claimStrip.ok.map((b) => (
          <span key={b} className="pill ok">
            ✅ {b}
          </span>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        {claimed ? (
          <button className="btn" disabled>
            ✅ Оффер закреплён
          </button>
        ) : (
          <button className="btn primary" onClick={onClaim}>
            Беру оффер
          </button>
        )}
      </div>
    </div>
  );
}
