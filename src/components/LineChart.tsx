import { useState } from 'react';
import { niceTicks } from '../lib/calc/stats';
import { Tooltip } from './charts/Tooltip';
import { useWidth } from './charts/useWidth';

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Single-series line chart (dependency-free SVG).
 * - `trend` is the line (2px) with a 10% area wash and a ringed end-dot.
 * - `raw` are de-emphasised context dots (e.g. daily weigh-ins behind a 7-day average).
 * - `goal` draws a dashed threshold line.
 * Drag or tap to read values (crosshair snaps to the nearest point).
 */
export function LineChart({
  raw,
  trend,
  goal,
  height = 160,
  tone = 'var(--weight)',
  formatY = (v) => v.toFixed(1),
  formatX,
  formatValue,
  compact = false,
  label = 'Trend chart',
  seriesName = 'Trend',
  rawName = 'Logged',
}: {
  raw: ChartPoint[];
  trend: ChartPoint[];
  goal?: number | null;
  height?: number;
  tone?: string;
  /** Axis tick labels. */
  formatY?: (v: number) => string;
  /** x → label (dates). Enables x-axis end labels and the tooltip date. */
  formatX?: (x: number) => string;
  /** Tooltip value formatting (defaults to formatY). */
  formatValue?: (v: number) => string;
  compact?: boolean;
  label?: string;
  seriesName?: string;
  rawName?: string;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = [...raw, ...trend];
  if (all.length === 0) return <div ref={box} />;

  const H = height;
  const xAxis = !compact && formatX;
  const padL = compact ? 4 : 40;
  const padR = compact ? 6 : 12;
  if (W < padL + padR + 10) return <div ref={box} className="chart-box" style={{ height: H }} />;
  const padT = 10;
  const padB = xAxis ? 22 : compact ? 6 : 8;

  const xs = all.map((p) => p.x);
  let ys = all.map((p) => p.y);
  if (goal != null && !compact) ys = [...ys, goal];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const ticks = compact ? [] : niceTicks(Math.min(...ys), Math.max(...ys), 4);
  let minY = compact ? Math.min(...ys) : ticks[0];
  let maxY = compact ? Math.max(...ys) : ticks[ticks.length - 1];
  if (maxY - minY < 1e-9) {
    minY -= 1;
    maxY += 1;
  }

  const sx = (x: number) => padL + (maxX === minX ? (W - padL - padR) / 2 : ((x - minX) / (maxX - minX)) * (W - padL - padR));
  const sy = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);
  const path = trend.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = trend.length > 1 ? `${path}L${sx(trend.at(-1)!.x)},${H - padB}L${sx(trend[0].x)},${H - padB}Z` : '';
  const end = trend.at(-1);
  const fmtV = formatValue ?? formatY;

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    trend.forEach((p, i) => {
      if (Math.abs(sx(p.x) - px) < Math.abs(sx(trend[best].x) - px)) best = i;
    });
    setHover(best);
  };
  const h = hover !== null ? trend[hover] : null;
  const hRaw = h ? raw.find((p) => p.x === h.x) : undefined;

  return (
    <div ref={box} className="chart-box" style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={label}
        style={{ touchAction: compact ? 'auto' : 'pan-y' }}
        onPointerMove={compact ? undefined : (e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={compact ? undefined : (e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges" />
            <text x={padL - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" className="tick">
              {formatY(t)}
            </text>
          </g>
        ))}
        {goal != null && !compact && (
          <g>
            <line x1={padL} x2={W - padR} y1={sy(goal)} y2={sy(goal)} stroke="var(--text-2)" strokeDasharray="4 4" strokeWidth="1.5" />
            <text x={W - padR} y={sy(goal) - 5} textAnchor="end" fontSize="11" fill="var(--text-2)">
              Goal
            </text>
          </g>
        )}
        {area && <path d={area} fill={tone} fillOpacity="0.1" />}
        {raw.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={compact ? 0 : 2.5} fill={tone} opacity="0.4" />
        ))}
        <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {end && <circle cx={sx(end.x)} cy={sy(end.y)} r="4.5" fill={tone} stroke="var(--surface)" strokeWidth="2" />}
        {xAxis && (
          <>
            <text x={padL} y={H - 5} fontSize="11" fill="var(--text-3)">
              {formatX!(minX)}
            </text>
            <text x={W - padR} y={H - 5} fontSize="11" fill="var(--text-3)" textAnchor="end">
              {formatX!(maxX)}
            </text>
          </>
        )}
        {h && (
          <g pointerEvents="none">
            <line x1={sx(h.x)} x2={sx(h.x)} y1={padT} y2={H - padB} stroke="var(--text-3)" strokeWidth="1" />
            <circle cx={sx(h.x)} cy={sy(h.y)} r="5" fill={tone} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <Tooltip x={sx(h.x)} width={W}>
          <b>{fmtV(h.y)}</b>
          <span>
            {seriesName}
            {formatX ? ` · ${formatX(h.x)}` : ''}
          </span>
          {hRaw && raw.length > 0 && (
            <span>
              {rawName}: {fmtV(hRaw.y)}
            </span>
          )}
        </Tooltip>
      )}
    </div>
  );
}
