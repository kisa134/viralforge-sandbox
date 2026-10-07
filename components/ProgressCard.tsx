"use client";

type Props = {
  step: number;
};

const STEPS = [
  "Trend scrape (stub) ✓",
  "Formula cards ×3 ✓",
  "Avatar / product ✓",
  "Clips generating…",
];

export function ProgressCard({ step }: Props) {
  return (
    <div className="progress-card">
      <strong style={{ fontSize: 13 }}>Генерация batch (sandbox)</strong>
      <ul className="progress-steps">
        {STEPS.map((label, i) => {
          const idx = i + 1;
          const cls = idx < step ? "done" : idx === step ? "active" : "";
          const prefix = idx < step ? "✓ " : idx === step ? "→ " : "· ";
          return (
            <li key={label} className={cls}>
              {prefix}
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
