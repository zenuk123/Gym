import { useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { ProgressBar } from '../../components/ProgressBar';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { useSleep, useWeights } from '../../db/hooks';
import { createMany } from '../../db/repo';
import type { Profile } from '../../db/types';
import { formatDuration } from '../../lib/calc/sleep';
import { addDays, parseISODate, todayISO } from '../../lib/dates';
import { scanHealthFile, type HealthNight, type HealthWeight } from '../../lib/healthImport';
import { plural } from '../../lib/format';
import { formatWeight } from '../../lib/units';

type Range = 'year' | 'all';

/**
 * Apple Health import (no native app needed): pick the export.xml from the Health app's
 * "Export All Health Data". Weigh-ins and sleep for days you haven't logged are added.
 */
export function HealthImportPage({ profile }: { profile: Profile }) {
  const toast = useToast();
  const weights = useWeights();
  const sleep = useSleep();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ weights: HealthWeight[]; nights: HealthNight[]; records: number } | null>(null);
  const [range, setRange] = useState<Range>('year');
  const [useW, setUseW] = useState(true);
  const [useS, setUseS] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const fresh = useMemo(() => {
    if (!found || !weights || !sleep) return null;
    const from = range === 'year' ? addDays(todayISO(), -365) : '0000-00-00';
    const haveW = new Set(weights.map((w) => w.date));
    const haveS = new Set(sleep.map((s) => s.date));
    return {
      weights: found.weights.filter((w) => w.date >= from && !haveW.has(w.date)),
      nights: found.nights.filter((n) => n.date >= from && !haveS.has(n.date)),
    };
  }, [found, weights, sleep, range]);

  async function pick(file: File) {
    setError(null);
    setFound(null);
    setDone(null);
    if (/\.zip$/i.test(file.name)) {
      setError('That’s the zip. In Files, tap export.zip once to unzip it, then open the “apple_health_export” folder and choose export.xml.');
      return;
    }
    setProgress(0);
    try {
      const r = await scanHealthFile(file, setProgress);
      if (!r.weights.length && !r.nights.length) setError('No weight or sleep data found in that file. Is it export.xml from the Health app?');
      else setFound(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.');
    } finally {
      setProgress(null);
    }
  }

  async function importNow() {
    if (!fresh) return;
    const w = useW ? await createMany('weights', fresh.weights.map((x) => ({ date: x.date, weightKg: x.weightKg, note: 'Apple Health' }))) : 0;
    const s = useS
      ? await createMany('sleep', fresh.nights.map((n) => ({ date: n.date, bedTime: n.bedTime, wakeTime: n.wakeTime, durationMin: n.durationMin, quality: 3, note: `Apple Health · ${n.source}` })))
      : 0;
    const msg = `Imported ${plural(w, 'weigh-in')} and ${plural(s, 'night')} of sleep`;
    setDone(msg);
    setFound(null);
    toast(msg);
  }

  const long = (d: string) => parseISODate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const span = (xs: { date: string }[]) => (xs.length ? `${long(xs[0].date)} – ${long(xs[xs.length - 1].date)}` : '');

  return (
    <main className="page">
      <SubHeader title="Import from Apple Health" back="/more/data" />
      <p className="muted" style={{ fontSize: 15 }}>
        Bring in your weight history and sleep from the Health app (including Apple Watch sleep). Only days you haven’t logged here are added; nothing is overwritten.
      </p>

      <section className="card">
        <h2 className="chart-title">On your iPhone</h2>
        <ol className="steps">
          <li>
            Open <b>Health</b> → tap your picture (top right) → <b>Export All Health Data</b> → <b>Export</b>.
          </li>
          <li>
            In the share sheet choose <b>Save to Files</b>. It can take a minute or two.
          </li>
          <li>
            In <b>Files</b>, tap <b>export.zip</b> once to unzip it.
          </li>
          <li>
            Come back here, tap <b>Choose export.xml</b> and pick it from the <b>apple_health_export</b> folder.
          </li>
        </ol>
        <p className="faint" style={{ fontSize: 13 }}>
          The file is read on this phone only — it’s never uploaded. Large exports take a little while.
        </p>
      </section>

      <input
        ref={fileRef}
        type="file"
        accept=".xml,text/xml,application/xml,.zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = '';
        }}
      />
      {progress !== null ? (
        <section className="card">
          <p className="muted">Reading export… {Math.round(progress * 100)}%</p>
          <ProgressBar value={progress * 100} max={100} tone="var(--accent)" />
        </section>
      ) : (
        <button className="btn btn-primary btn-lg btn-block" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" /> Choose export.xml
        </button>
      )}
      {error && <p className="chat-error" style={{ color: 'var(--danger)' }}>{error}</p>}
      {done && <p className="pill good">{done}</p>}

      {found && fresh && (
        <section className="card">
          <h2 className="chart-title">Found in your export</h2>
          <Segmented<Range>
            label="How far back"
            value={range}
            onChange={setRange}
            options={[
              { value: 'year', label: 'Last 12 months' },
              { value: 'all', label: 'Everything' },
            ]}
          />
          <label className="check-row">
            <input type="checkbox" checked={useW} onChange={(e) => setUseW(e.target.checked)} />
            <span className="grow">
              <b>{plural(fresh.weights.length, 'new weigh-in')}</b>
              <span className="desc">
                {fresh.weights.length
                  ? `${span(fresh.weights)} · latest ${formatWeight(fresh.weights[fresh.weights.length - 1].weightKg, profile.weightUnit)}`
                  : `${found.weights.length} found, all already logged or out of range`}
              </span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={useS} onChange={(e) => setUseS(e.target.checked)} />
            <span className="grow">
              <b>{plural(fresh.nights.length, 'new night')} of sleep</b>
              <span className="desc">
                {fresh.nights.length
                  ? `${span(fresh.nights)} · average ${formatDuration(fresh.nights.reduce((a, n) => a + n.durationMin, 0) / fresh.nights.length)}`
                  : `${found.nights.length} found, all already logged or out of range`}
              </span>
            </span>
          </label>
          <p className="faint" style={{ fontSize: 13 }}>
            One weigh-in per day (the earliest reading). Sleep uses your watch’s sleep stages when available, otherwise time in bed; quality is set to “OK” — edit any night later.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => void importNow()} disabled={(!useW || !fresh.weights.length) && (!useS || !fresh.nights.length)}>
            Import
          </button>
        </section>
      )}
    </main>
  );
}
