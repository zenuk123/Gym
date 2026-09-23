export function ProgressBar({ value, max, tone, allowOver = false }: { value: number; max: number; tone?: string; allowOver?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = allowOver && value > max * 1.05;
  return (
    <div
      className={`bar${over ? ' over' : ''}`}
      style={tone ? ({ '--tone': tone } as React.CSSProperties) : undefined}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
