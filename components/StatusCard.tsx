"use client";

import type { CreatorState } from "@/lib/types";
import { SANDBOX_OFFER } from "@/lib/fixtures";

export function StatusCard({ state }: { state: CreatorState }) {
  return (
    <div className="card">
      <h3>Статус</h3>
      <div className="muted">sandbox · денег нет</div>
      <table className="status-table">
        <tbody>
          <tr>
            <td>Фаза</td>
            <td>
              <code>{state.phase}</code>
            </td>
          </tr>
          <tr>
            <td>Ниша</td>
            <td>{state.niche ?? "—"}</td>
          </tr>
          <tr>
            <td>Гео</td>
            <td>{state.geo ?? "—"}</td>
          </tr>
          <tr>
            <td>Аккаунт</td>
            <td>{state.social ?? "—"}</td>
          </tr>
          <tr>
            <td>Оффер</td>
            <td>
              {state.offerClaimed
                ? `${SANDBOX_OFFER.sku} · claimed`
                : "не закреплён"}
            </td>
          </tr>
          <tr>
            <td>Клипы</td>
            <td>{state.clipsReady ? "3 готовы (fixture)" : "ещё нет"}</td>
          </tr>
          <tr>
            <td>Пост</td>
            <td>
              {state.postedClip != null
                ? `запостил #${state.postedClip}`
                : "не подтверждён"}
            </td>
          </tr>
          <tr>
            <td>Баланс</td>
            <td>${state.balance.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
