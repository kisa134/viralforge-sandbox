"use client";

export function PayoutCard({ balance }: { balance: number }) {
  return (
    <div className="card">
      <h3>Выплаты</h3>
      <div className="muted">пока sandbox — выплат нет</div>
      <div className="kv">
        <div className="k">Баланс</div>
        <div>
          <strong>${balance.toFixed(2)}</strong>
        </div>
        <div className="k">Ledger</div>
        <div>Google Sheet stub</div>
        <div className="k">Статус</div>
        <div>пока sandbox — выплат нет</div>
        <div className="k">Методы</div>
        <div>Wise / USDT / PayPal — later</div>
      </div>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Тип</th>
            <th>Сумма</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={4} style={{ color: "var(--text-dim)", textAlign: "center" }}>
              Sheet stub · нет matched orders · live payouts locked
            </td>
          </tr>
        </tbody>
      </table>
      <button className="btn" disabled style={{ marginTop: 10 }}>
        Запросить выплату (locked)
      </button>
    </div>
  );
}
