import type { ReactNode } from 'react';

/** Chart readout: value first (strong), label second. Positioned inside the chart box, clamped to its edges. */
export function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const W = 150;
  const left = Math.min(Math.max(0, x - W / 2), Math.max(0, width - W));
  return (
    <div className="chart-tip" style={{ left, width: W }} role="status">
      {children}
    </div>
  );
}
