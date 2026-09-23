import { useState } from 'react';
import { CardHead } from '../../../components/CardHead';
import { useSleep } from '../../../db/hooks';
import { formatDuration, lastNight } from '../../../lib/calc/sleep';
import { QUALITY_LABEL, SleepSheet } from '../../progress/sleep/SleepSheet';

/** Last night at a glance, or a one-tap prompt to log it. */
export function SleepCard({ today }: { today: string }) {
  const logs = useSleep();
  const [open, setOpen] = useState(false);
  if (!logs) return null;
  const night = lastNight(logs, today);

  return (
    <section className="card">
      <CardHead icon="moonStar" tone="var(--sleep)" title="Sleep" link={{ to: '/progress/sleep', label: 'Trends' }} />
      {night ? (
        <button className="sleep-today" onClick={() => setOpen(true)} aria-label="Edit last night's sleep">
          <span className="big-num">{formatDuration(night.durationMin)}</span>
          <span className="muted">
            {night.bedTime} → {night.wakeTime} · {QUALITY_LABEL[night.quality]}
          </span>
        </button>
      ) : (
        <div className="sleep-today">
          <p className="muted" style={{ fontSize: 15 }}>
            How did you sleep?
          </p>
          <button className="btn" onClick={() => setOpen(true)}>
            Log last night
          </button>
        </div>
      )}
      {open && <SleepSheet last={night ?? logs.at(-1) ?? null} editing={night ?? undefined} onClose={() => setOpen(false)} />}
    </section>
  );
}
