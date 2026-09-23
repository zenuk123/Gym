import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/CardHead';
import { Icon } from '../../../components/Icon';
import { PageHeader } from '../../../components/PageHeader';
import { Sheet } from '../../../components/Sheet';
import { usePhotos, useWeights } from '../../../db/hooks';
import type { PhotoPose, Profile, ProgressPhoto, WeightEntry } from '../../../db/types';
import { daysBetween, formatDateLong, relativeDay } from '../../../lib/dates';
import { formatWeight } from '../../../lib/units';
import { useToday } from '../../../lib/useToday';
import { ProgressTabs } from '../ProgressTabs';
import { AddPhotoSheet, POSES } from './AddPhotoSheet';
import { PhotoImg } from './PhotoImg';
import { deletePhoto } from './photoStore';
import '../progress.css';

/** Nearest weigh-in within 3 days of a date, for captions. */
export function weightNear(weights: WeightEntry[], date: string): number | null {
  let best: WeightEntry | null = null;
  for (const w of weights) {
    const d = Math.abs(daysBetween(w.date, date));
    if (d <= 3 && (!best || d < Math.abs(daysBetween(best.date, date)))) best = w;
  }
  return best?.weightKg ?? null;
}

export function PhotosPage({ profile }: { profile: Profile }) {
  const photos = usePhotos();
  const weights = useWeights() ?? [];
  const today = useToday();
  const navigate = useNavigate();
  const [adding, setAdding] = useState<{ pose?: PhotoPose; date?: string } | null>(null);
  const [viewing, setViewing] = useState<ProgressPhoto | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, ProgressPhoto[]>();
    for (const p of photos ?? []) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return [...m.entries()];
  }, [photos]);

  if (!photos) return <main className="page" />;

  return (
    <main className="page">
      <PageHeader
        title="Progress"
        action={
          <button className="btn btn-primary" onClick={() => setAdding({})}>
            <Icon name="plus" />
            Photo
          </button>
        }
      />
      <ProgressTabs />

      {photos.length === 0 ? (
        <section className="card">
          <EmptyState icon="user">
            <b className="empty-title">Your private photo timeline</b>
            Front, side and back every 2–4 weeks show changes the scale can’t. Photos stay inside the app.
          </EmptyState>
          <button className="btn btn-primary btn-block" onClick={() => setAdding({})}>
            <Icon name="plus" /> Take your first photos
          </button>
        </section>
      ) : (
        <>
          {photos.length > 1 && (
            <Link to="/progress/photos/compare" className="btn btn-block">
              <Icon name="list" />
              Compare before & after
            </Link>
          )}
          {groups.map(([date, ps]) => {
            const w = weightNear(weights, date);
            return (
              <section key={date} className="photo-day">
                <h2 className="section-title section-row">
                  <span>{relativeDay(date, today)}</span>
                  {w !== null && <span>{formatWeight(w, profile.weightUnit)}</span>}
                </h2>
                <div className="photo-row">
                  {POSES.map((pose) => {
                    const p = ps.find((x) => x.pose === pose.value);
                    return p ? (
                      <button key={pose.value} className="photo-slot" onClick={() => setViewing(p)} aria-label={`${pose.label} photo, ${formatDateLong(date)}`}>
                        <PhotoImg id={p.id} alt={`${pose.label} photo`} />
                        <span className="photo-tag">{pose.label}</span>
                      </button>
                    ) : (
                      <button key={pose.value} className="photo-slot empty" onClick={() => setAdding({ pose: pose.value, date })} aria-label={`Add ${pose.label} photo for ${formatDateLong(date)}`}>
                        <Icon name="plus" />
                        <span className="photo-tag">{pose.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}

      {adding && <AddPhotoSheet initialPose={adding.pose} initialDate={adding.date} onClose={() => setAdding(null)} />}
      {viewing && (
        <Sheet
          title={`${POSES.find((p) => p.value === viewing.pose)!.label} · ${formatDateLong(viewing.date)}`}
          onClose={() => {
            setViewing(null);
            setConfirmDel(false);
          }}
        >
          <PhotoImg id={viewing.id} which="full" alt="Progress photo" className="photo-full" />
          <div className="btn-row">
            <button className="btn" onClick={() => navigate(`/progress/photos/compare?pose=${viewing.pose}&b=${viewing.id}`)}>
              Compare
            </button>
            {confirmDel ? (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await deletePhoto(viewing.id);
                  setViewing(null);
                  setConfirmDel(false);
                }}
              >
                Delete for good
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmDel(true)}>
                Delete
              </button>
            )}
          </div>
        </Sheet>
      )}
    </main>
  );
}
