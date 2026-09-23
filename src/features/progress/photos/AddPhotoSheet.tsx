import { useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { Sheet } from '../../../components/Sheet';
import { useToast } from '../../../components/Toast';
import type { PhotoPose } from '../../../db/types';
import { todayISO } from '../../../lib/dates';
import { addPhoto } from './photoStore';

export const POSES: { value: PhotoPose; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
];

/** Take or choose a photo. After saving it moves on to the next pose, so a full check-in is three taps. */
export function AddPhotoSheet({ initialPose = 'front', initialDate, onClose }: { initialPose?: PhotoPose; initialDate?: string; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pose, setPose] = useState<PhotoPose>(initialPose);
  const [date, setDate] = useState(initialDate ?? todayISO());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PhotoPose[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      await addPhoto(file, pose, date);
      const saved = [...done, pose];
      setDone(saved);
      const next = POSES.find((p) => !saved.includes(p.value));
      toast(`${POSES.find((p) => p.value === pose)!.label} photo saved privately`);
      if (next) setPose(next.value);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Progress photo" onClose={onClose}>
      <Segmented label="Pose" value={pose} onChange={setPose} options={POSES.map((p) => ({ ...p, label: done.includes(p.value) ? `${p.label} ✓` : p.label }))} />
      <div className="field">
        <label htmlFor="photo-date">Date</label>
        <div className="input-wrap">
          <input id="photo-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Same spot, same light, same time of day (mornings are best) — it makes comparisons honest.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="plus" />
        {busy ? 'Saving…' : `Take or choose ${pose} photo`}
      </button>
      <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
        <Icon name="lock" width={12} height={12} style={{ display: 'inline', verticalAlign: -1 }} /> Stored inside the app only — never added to your camera roll.
      </p>
    </Sheet>
  );
}
