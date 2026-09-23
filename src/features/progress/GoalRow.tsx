import type { Exercise, Profile } from '../../db/types';
import type { GoalStatus } from '../../lib/calc/goals';
import { SITE_LABEL } from '../../lib/calc/measurements';
import { formatDateShort } from '../../lib/dates';
import { formatWeight, round, toDisplayLength } from '../../lib/units';
import { ProgressBar } from '../../components/ProgressBar';

export function goalTitle(s: GoalStatus, exMap: Map<string, Exercise>): string {
  switch (s.kind) {
    case 'bodyweight':
      return 'Body weight';
    case 'frequency':
      return 'Training this week';
    case 'lift': {
      const name = exMap.get(s.goal?.exerciseId ?? '')?.name ?? 'Lift';
      return s.goal?.metric === 'e1rm' ? `${name} (e1RM)` : name;
    }
    case 'measurement':
      return s.goal?.site ? SITE_LABEL[s.goal.site] : 'Measurement';
  }
}

export function goalFormatter(s: GoalStatus, profile: Profile): (v: number) => string {
  if (s.kind === 'frequency') return (v) => String(Math.round(v));
  if (s.kind === 'measurement') {
    const u = profile.lengthUnit;
    return (v) => `${round(toDisplayLength(v, u), 1)} ${u}`;
  }
  return (v) => formatWeight(v, profile.weightUnit);
}

/** One goal: start → current → target with a progress bar and a calculated projection. */
export function GoalRow({ s, profile, exMap, compact = false }: { s: GoalStatus; profile: Profile; exMap: Map<string, Exercise>; compact?: boolean }) {
  const fmt = goalFormatter(s, profile);
  const pct = Math.round(s.progress * 100);
  let note: string | null = null;
  if (s.kind === 'frequency') note = s.achieved ? 'Weekly target hit ✓' : `${s.target - (s.current ?? 0)} to go this week`;
  else if (s.achieved) note = s.achievedOn ? `Achieved ${formatDateShort(s.achievedOn)} 🎉` : 'Achieved 🎉';
  else if (s.eta) note = `Projected ${formatDateShort(s.eta)} at your current rate`;
  else if (s.current !== null && s.ratePerWeek !== null && s.ratePerWeek <= 0) note = 'Not moving toward this goal lately';
  else if (s.current === null) note = s.kind === 'lift' ? 'Log this lift to start tracking' : 'Add a measurement to start tracking';

  return (
    <div className="goal-row">
      <div className="goal-top">
        <span className="goal-title">{goalTitle(s, exMap)}</span>
        <span className="goal-values">
          {s.kind === 'frequency' ? (
            <>
              <b>{s.current}</b> / {s.target} sessions
            </>
          ) : (
            <>
              <b>{s.current !== null ? fmt(s.current) : '—'}</b> → {fmt(s.target)}
            </>
          )}
        </span>
      </div>
      <ProgressBar value={pct} max={100} tone={s.achieved ? 'var(--success)' : 'var(--accent)'} />
      {!compact && (
        <div className="goal-foot">
          <span>{s.kind === 'frequency' ? '' : `From ${fmt(s.start)} · ${pct}%`}</span>
          {note && <span>{note}</span>}
        </div>
      )}
      {compact && note && <div className="goal-foot">{note}</div>}
    </div>
  );
}
