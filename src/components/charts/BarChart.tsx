import { useState } from 'react';
import { niceTicks } from '../../lib/calc/stats';
import { Tooltip } from './Tooltip';
import { useWidth } from './useWidth';

/** Surface-coloured outline so labels stay legible where they cross marks or lines. */
const HALO = { stroke: 'var(--surface)', strokeWidth: 4, paintOrder: 'stroke', strokeLinejoin: 'round' } as const;

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Tooltip heading (e.g. full date). Defaults to label. */
  title?: string;
}

/**
 * Column chart: one hue, ≤ 24px columns with a 4px rounded data-end and a square
 * baseline, optional dashed target line, the latest value labelled at its cap, and a
 * tap/hover readout per column.
 */
export function BarChart({
  bars,
  height = 170,
  tone = 'var(--accent)',
  target,
  targetLabel = 'Target',
  formatValue = (v) => String(Math.round(v)),
  formatTick = formatValue,
  label,
}: {
  bars: Bar[];
  height?: number;
  tone?: string;
  target?: number | null;
  targetLabel?: string;
  formatValue?: (v: number) => string;
  formatTick?: (v: number) => string;
  label: string;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const padL = 40;
  const padR = 8;
  // Nothing to draw, or not laid out yet (width still settling): keep the box, skip the marks.
  if (bars.length === 0 || W < padL + padR + bars.length) return <div ref={box} className="chart-box" style={{ height: H }} />;

  const padT = 18;
  const padB = 22;
  const max = Math.max(...bars.map((b) => b.value), target ?? 0);
  const ticks = niceTicks(0, max || 1, 4);
  const top = ticks[ticks.length - 1];
  const band = (W - padL - padR) / bars.length;
  const bw = Math.min(24, Math.max(4, band * 0.62));
  const sy = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const cx = (i: number) => padL + band * i + band / 2;
  const every = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor((W - padL) / 52))));
  const r = Math.min(4, bw / 2);
  const last = bars.length - 1;

  const column = (i: number, v: number) => {
    const x = cx(i) - bw / 2;
    const y = sy(v);
    const base = sy(0);
    if (base - y < 0.5) return '';
    const rr = Math.min(r, base - y);
    return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + bw - rr}Q${x + bw},${y} ${x + bw},${y + rr}V${base}Z`;
  };

  return (
    <div ref={box} className="chart-box" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ touchAction: 'pan-y' }} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges" />
            <text x={padL - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" className="tick">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => (
          <path key={b.key} d={column(i, b.value)} fill={tone} opacity={hover === null || hover === i ? 1 : 0.55} />
        ))}
        {target != null && target > 0 && (
          <g pointerEvents="none">
            <line x1={padL} x2={W - padR} y1={sy(target)} y2={sy(target)} stroke="var(--text-2)" strokeDasharray="4 4" strokeWidth="1.5" />
            <text x={padL + 4} y={sy(target) - 5} fontSize="11" fill="var(--text-2)" {...HALO}>
              {targetLabel}
            </text>
          </g>
        )}
        {/* Selective label: only the latest value, short form, at its cap (skipped if it would sit on the target line). */}
        {bars[last].value > 0 && hover === null && (target == null || Math.abs(sy(bars[last].value) - sy(target)) > 16) && (
          <text x={cx(last)} y={sy(bars[last].value) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)" {...HALO}>
            {formatTick(bars[last].value)}
          </text>
        )}
        {bars.map((b, i) =>
          (last - i) % every === 0 ? (
            <text key={b.key} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">
              {b.label}
            </text>
          ) : null,
        )}
        {/* Hit targets: the whole band, not just the painted column. */}
        {bars.map((b, i) => (
          <rect
            key={b.key}
            x={padL + band * i}
            y={padT}
            width={band}
            height={H - padT - padB}
            fill="transparent"
            tabIndex={0}
            aria-label={`${b.title ?? b.label}: ${formatValue(b.value)}`}
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={cx(hover)} width={W}>
          <b>{formatValue(bars[hover].value)}</b>
          <span>{bars[hover].title ?? bars[hover].label}</span>
        </Tooltip>
      )}
    </div>
  );
}
