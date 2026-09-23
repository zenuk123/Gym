/** Horizontal meter rows (one hue): label · bar · value. Values are text, so nothing hides behind hover. */
export function MeterList({
  rows,
  tone = 'var(--accent)',
  formatValue = (v) => String(Math.round(v)),
  max: fixedMax,
}: {
  /** `text` overrides the formatted value for that row. */
  rows: { key: string; label: string; value: number; text?: string }[];
  tone?: string;
  formatValue?: (v: number) => string;
  /** Scale maximum (defaults to the largest value). */
  max?: number;
}) {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="meter-list" role="table">
      {rows.map((r) => (
        <div key={r.key} className="meter-row" role="row">
          <span className="meter-label" role="rowheader">
            {r.label}
          </span>
          <span className="meter-track" aria-hidden="true">
            <span style={{ width: `${(r.value / max) * 100}%`, background: tone }} />
          </span>
          <span className="meter-value" role="cell">
            {r.text ?? formatValue(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface StackPart {
  key: string;
  label: string;
  share: number;
  color: string;
  detail?: string;
}

/** 100% stacked bar with 2px surface gaps and a legend that carries every value. */
export function StackBar({ parts, label }: { parts: StackPart[]; label: string }) {
  const visible = parts.filter((p) => p.share > 0);
  return (
    <div className="stack">
      <div className="stack-bar" role="img" aria-label={`${label}: ${visible.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(', ')}`}>
        {visible.map((p) => (
          <span key={p.key} style={{ flexGrow: p.share, background: p.color }} />
        ))}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span className="legend-label">{p.label}</span>
            <b>{Math.round(p.share * 100)}%</b>
            {p.detail && <span className="faint">{p.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
