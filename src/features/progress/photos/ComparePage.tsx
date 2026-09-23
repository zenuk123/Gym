import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SubHeader } from '../../../components/PageHeader';
import { Segmented } from '../../../components/Segmented';
import { usePhotos, useWeights } from '../../../db/hooks';
import type { PhotoPose, Profile } from '../../../db/types';
import { daysBetween, formatDateShort } from '../../../lib/dates';
import { formatWeight } from '../../../lib/units';
import { POSES } from './AddPhotoSheet';
import { PhotoImg } from './PhotoImg';
import { weightNear } from './PhotosPage';
import '../progress.css';

/** Before/after: side by side, or one image over the other with a drag slider. */
export function ComparePage({ profile }: { profile: Profile }) {
  const photos = usePhotos();
  const weights = useWeights() ?? [];
  const [params] = useSearchParams();
  const [pose, setPose] = useState<PhotoPose>((params.get('pose') as PhotoPose) || 'front');
  const [mode, setMode] = useState<'side' | 'slider'>('slider');
  const [aId, setA] = useState<string | null>(params.get('a'));
  const [bId, setB] = useState<string | null>(params.get('b'));
  const [split, setSplit] = useState(50);

  const list = useMemo(() => [...(photos ?? [])].filter((p) => p.pose === pose).sort((x, y) => x.date.localeCompare(y.date)), [photos, pose]);
  if (!photos) return <main className="page" />;
  const a = list.find((p) => p.id === aId) ?? list[0];
  const b = list.find((p) => p.id === bId) ?? list.at(-1);
  const wa = a ? weightNear(weights, a.date) : null;
  const wb = b ? weightNear(weights, b.date) : null;

  return (
    <main className="page">
      <SubHeader title="Compare" back="/progress/photos" />
      <Segmented
        label="Pose"
        value={pose}
        onChange={(p) => {
          setPose(p);
          setA(null);
          setB(null);
        }}
        options={POSES}
      />
      {list.length < 2 || !a || !b ? (
        <p className="muted">You need at least two {pose} photos to compare.</p>
      ) : (
        <>
          <Segmented
            label="View"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'slider', label: 'Slider' },
              { value: 'side', label: 'Side by side' },
            ]}
          />
          {mode === 'side' ? (
            <div className="compare-side">
              <figure>
                <PhotoImg id={a.id} which="full" alt={`Before, ${a.date}`} />
                <figcaption>
                  <b>{formatDateShort(a.date)}</b>
                  {wa !== null && <span>{formatWeight(wa, profile.weightUnit)}</span>}
                </figcaption>
              </figure>
              <figure>
                <PhotoImg id={b.id} which="full" alt={`After, ${b.date}`} />
                <figcaption>
                  <b>{formatDateShort(b.date)}</b>
                  {wb !== null && <span>{formatWeight(wb, profile.weightUnit)}</span>}
                </figcaption>
              </figure>
            </div>
          ) : (
            <div className="compare-slider" style={{ aspectRatio: `${b.width} / ${b.height}` }}>
              <PhotoImg id={b.id} which="full" alt={`After, ${b.date}`} />
              <div className="compare-top" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                <PhotoImg id={a.id} which="full" alt={`Before, ${a.date}`} />
              </div>
              <div className="compare-line" style={{ left: `${split}%` }} />
              <span className="compare-tag left">{formatDateShort(a.date)}</span>
              <span className="compare-tag right">{formatDateShort(b.date)}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
                aria-label="Drag to compare before and after"
              />
            </div>
          )}
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Time between</div>
              <div className="value">{Math.round(daysBetween(a.date, b.date) / 7)} weeks</div>
            </div>
            {wa !== null && wb !== null && (
              <div className="stat">
                <div className="label">Weight change</div>
                <div className="value">{formatWeight(wb - wa, profile.weightUnit, { signed: true })}</div>
              </div>
            )}
          </div>
          <h2 className="section-title">Before</h2>
          <div className="thumb-strip">
            {list.map((p) => (
              <button key={p.id} className={`thumb-pick${p.id === a.id ? ' on' : ''}`} onClick={() => setA(p.id)} aria-pressed={p.id === a.id} aria-label={`Before: ${p.date}`}>
                <PhotoImg id={p.id} alt="" />
                <small>{formatDateShort(p.date)}</small>
              </button>
            ))}
          </div>
          <h2 className="section-title">After</h2>
          <div className="thumb-strip">
            {list.map((p) => (
              <button key={p.id} className={`thumb-pick${p.id === b.id ? ' on' : ''}`} onClick={() => setB(p.id)} aria-pressed={p.id === b.id} aria-label={`After: ${p.date}`}>
                <PhotoImg id={p.id} alt="" />
                <small>{formatDateShort(p.date)}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
