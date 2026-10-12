import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { create, remove } from '../../db/repo';
import type { Exercise, Profile } from '../../db/types';
import { checkSetPB, e1rm, exerciseBests, PB_LABEL, REP_MAXES } from '../../lib/calc/training';
import { isLoggableDate, todayISO } from '../../lib/dates';
import { formatWeight, fromDisplayWeight, parseDecimal } from '../../lib/units';
import { matchesExercise } from './logic';
import type { Training } from './useTraining';

/**
 * Record a PR in a few taps: exercise, weight × reps, date. It's checked against everything
 * you've lifted (workouts and earlier records) so you see straight away whether it's a new best.
 * Saved as a personal record — it never counts as a workout or changes your suggestions.
 */
export function LogRecordSheet({ t, profile, exerciseId, onClose }: { t: Training; profile: Profile; exerciseId?: string; onClose: () => void }) {
  const toast = useToast();
  const u = profile.weightUnit;
  const [exId, setExId] = useState<string | null>(exerciseId ?? null);
  const [q, setQ] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const exercise = exId ? t.exMap.get(exId) : undefined;

  // Exercises you've done first, then the rest of the library.
  const choices = useMemo(() => {
    const done = (e: Exercise) => (t.bests.get(e.id)?.length ?? 0) > 0;
    return t.exercises
      .filter((e) => !e.archived && matchesExercise(e.name, q))
      .sort((a, b) => Number(done(b)) - Number(done(a)) || a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [t, q]);

  if (!exercise) {
    return (
      <Sheet title="Log a PR" onClose={onClose}>
        <div className="input-wrap">
          <Icon name="search" width={20} height={20} color="var(--text-3)" />
          <input type="search" placeholder="Which exercise? (e.g. bench, ohp, db row)" value={q} onChange={(e) => setQ(e.target.value)} autoCorrect="off" style={{ paddingLeft: 8 }} aria-label="Search exercises" />
        </div>
        <div className="list picker-list">
          {choices.map((e) => {
            const best = (t.bests.get(e.id)?.length ?? 0) > 0 ? exerciseBests(t.bests.get(e.id)!).heaviest : null;
            return (
              <button key={e.id} className="list-row" onClick={() => setExId(e.id)}>
                <div className="grow">
                  <div className="title">{e.name}</div>
                  <div className="desc">{best ? `Best ${formatWeight(best.weightKg, u)} × ${best.reps}` : 'No lifts yet'}</div>
                </div>
                <span className="trail">
                  <Icon name="chevronRight" />
                </span>
              </button>
            );
          })}
          {choices.length === 0 && <p className="muted">No exercise matches — add it in the exercise library first.</p>}
        </div>
      </Sheet>
    );
  }

  const w = parseDecimal(weight);
  const kg = w === null ? null : fromDisplayWeight(w, u);
  const valid = kg !== null && kg >= 0 && kg < 1000 && (kg > 0 || exercise.bodyweight) && reps >= 1 && reps <= 100 && isLoggableDate(date);
  const earlier = (t.bests.get(exercise.id) ?? []).flatMap((s) => s.sets);
  // null = nothing valid typed yet; 'none' = valid but not above your best.
  const verdict = valid ? (earlier.length === 0 ? 'first' : (checkSetPB({ weightKg: kg!, reps }, earlier, exercise.bodyweight) ?? 'none')) : null;
  const bests = earlier.length ? exerciseBests(t.bests.get(exercise.id)!) : null;

  async function save() {
    if (!valid) return;
    setBusy(true);
    const rec = await create('records', { exerciseId: exercise!.id, date, weightKg: kg!, reps, note: note.trim() || null });
    const what = `${exercise!.name} ${formatWeight(kg!, u)} × ${reps}`;
    toast(typeof verdict === 'object' && verdict ? `🏆 New PR · ${what}` : `Saved · ${what}`, { label: 'Undo', run: () => void remove('records', rec.id) });
    onClose();
  }

  return (
    <Sheet title={`Log a PR · ${exercise.name}`} onClose={onClose}>
      {!exerciseId && (
        <button className="link-btn" onClick={() => setExId(null)} style={{ alignSelf: 'flex-start' }}>
          <Icon name="chevronLeft" width={16} height={16} /> Change exercise
        </button>
      )}
      {bests?.heaviest && (
        <p className="muted" style={{ fontSize: 14 }}>
          Your bests: <b>{formatWeight(bests.heaviest.weightKg, u)} × {bests.heaviest.reps}</b>
          {!exercise.bodyweight && bests.e1rm ? ` · e1RM ${formatWeight(bests.e1rm.value, u)}` : ''}
        </p>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor="pr-weight">{exercise.bodyweight ? 'Added weight' : 'Weight'}</label>
          <div className="input-wrap big">
            <input id="pr-weight" inputMode="decimal" value={weight} placeholder="0" onChange={(e) => setWeight(e.target.value.replace(/[^0-9.,]/g, ''))} autoFocus />
            <span className="suffix">{u}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pr-reps">Reps</label>
          <div className="input-wrap big">
            <input id="pr-reps" inputMode="numeric" value={reps} onFocus={(e) => e.target.select()} onChange={(e) => setReps(Math.min(100, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)))} />
          </div>
        </div>
      </div>
      <div className="quick-row" role="group" aria-label="Quick reps">
        {REP_MAXES.map((n) => (
          <button key={n} className="btn" aria-pressed={reps === n} aria-label={`${n} rep${n === 1 ? '' : 's'}`} onClick={() => setReps(n)}>
            ×{n}
          </button>
        ))}
      </div>
      {verdict !== null && (
        <p className={`pr-verdict${typeof verdict === 'object' ? ' good' : ''}`} aria-live="polite">
          {verdict === 'first' ? (
            <>First record for {exercise.name} — it becomes your baseline.</>
          ) : verdict !== 'none' ? (
            <>
              🏆 New PR — {PB_LABEL[verdict.kind].toLowerCase()} (was {formatWeight(verdict.previous.weightKg, u)} × {verdict.previous.reps})
              {!exercise.bodyweight && reps > 1 ? ` · e1RM ${formatWeight(e1rm(kg!, reps), u)}` : ''}
            </>
          ) : (
            <>Not above your best yet — it’ll still be saved to your records.</>
          )}
        </p>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor="pr-date">Date</label>
          <div className="input-wrap">
            <input id="pr-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="pr-note">Note (optional)</label>
          <div className="input-wrap">
            <input id="pr-note" value={note} placeholder="e.g. belt, paused" onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </div>
      <button className="btn btn-primary btn-lg btn-block" disabled={!valid || busy} onClick={() => void save()}>
        <Icon name="trophy" /> Save PR
      </button>
      <p className="faint" style={{ fontSize: 13 }}>
        Records count towards your bests, PBs and goals — not as a workout, and they don’t change your suggested weights.
      </p>
    </Sheet>
  );
}
