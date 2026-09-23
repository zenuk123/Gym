import { CardHead } from '../../../components/CardHead';
import { ProgressBar } from '../../../components/ProgressBar';
import { useToast } from '../../../components/Toast';
import { useWaterLogs } from '../../../db/hooks';
import { create, remove } from '../../../db/repo';
import type { Profile } from '../../../db/types';
import { formatLitres } from '../../../lib/format';
import { haptic } from '../../../pwa/platform';

export function WaterCard({ profile, date }: { profile: Profile; date: string }) {
  const toast = useToast();
  const logs = useWaterLogs(date) ?? [];
  const total = logs.reduce((s, l) => s + l.ml, 0);

  async function add(ml: number) {
    haptic();
    const rec = await create('waterLogs', { date, ml });
    toast(`+${ml} ml water`, { label: 'Undo', run: () => void remove('waterLogs', rec.id) });
  }

  return (
    <section className="card">
      <CardHead icon="droplet" tone="var(--water)" title="Water" />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="big-num">
          {formatLitres(total).replace(' L', '')}
          <small>/ {formatLitres(profile.waterTargetMl)}</small>
        </span>
        {total >= profile.waterTargetMl && <span className="pill good">Goal hit</span>}
      </div>
      <ProgressBar value={total} max={profile.waterTargetMl} tone="var(--water)" />
      <div className="quick-row">
        <button className="btn" onClick={() => void add(250)}>
          +250 ml
        </button>
        <button className="btn" onClick={() => void add(500)}>
          +500 ml
        </button>
        <button className="btn" onClick={() => void add(750)}>
          +750 ml
        </button>
      </div>
    </section>
  );
}
