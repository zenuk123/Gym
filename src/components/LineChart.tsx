import { useId, useLayoutEffect, useRef, useState } from 'react';

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Dependency-free SVG line chart: faint dots for raw values, bold line for the trend,
 * optional dashed goal line. Scales to its container width.
 */
export function LineChart({
  raw,
  trend,
  goal,
  height = 160,
  tone = 'var(--weight)',
  formatY = (v) => v.toFixed(1),
  compact = false,
}: {
  raw: ChartPoint[];
  trend: ChartPoint[];
  goal?: number | null;
  height?: number;
  tone?: string;
  formatY?: (v: number) => string;
  compact?: boolean;
}) {
  const gradId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const padL = compact ? 2 : 36;
  const padR = 6;
  const padT = 10;
  const padB = compact ? 4 : 18;
  const all = [...raw, ...trend];
  if (all.length === 0) return <div ref={box} />;

  const xs = all.map((p) => p.x);
  let ys = all.map((p) => p.y);
  if (goal != null && !compact) ys = [...ys, goal];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const span = Math.max(maxY - minY, 1);
  minY -= span * 0.15;
  maxY += span * 0.15;

  const sx = (x: number) => padL + (maxX === minX ? (W - padL - padR) / 2 : ((x - minX) / (maxX - minX)) * (W - padL - padR));
  const sy = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);
  const path = trend.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = trend.length > 1 ? `${path}L${sx(trend.at(-1)!.x)},${H - padB}L${sx(trend[0].x)},${H - padB}Z` : '';
  const ticks = compact ? [] : [maxY - (maxY - minY) * 0.15, (minY + maxY) / 2, minY + (maxY - minY) * 0.15];

  return (
    <div ref={box}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Weight trend chart" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone} stopOpacity="0.28" />
          <stop offset="1" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={sy(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-3)">
            {formatY(t)}
          </text>
        </g>
      ))}
      {goal != null && !compact && goal >= minY && goal <= maxY && (
        <line x1={padL} x2={W - padR} y1={sy(goal)} y2={sy(goal)} stroke="var(--accent)" strokeDasharray="4 4" strokeWidth="1.5" />
      )}
      {area && <path d={area} fill={`url(#${gradId})`} />}
      {raw.map((p) => (
        <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={compact ? 0 : 2.5} fill={tone} opacity="0.45" />
      ))}
      <path d={path} fill="none" stroke={tone} strokeWidth={compact ? 2.5 : 3} strokeLinecap="round" strokeLinejoin="round" />
      {trend.length > 0 && <circle cx={sx(trend.at(-1)!.x)} cy={sy(trend.at(-1)!.y)} r="4" fill={tone} />}
    </svg>
    </div>
  );
}
