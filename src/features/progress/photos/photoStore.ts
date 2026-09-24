import { useEffect, useState } from 'react';
import { db } from '../../../db/db';
import { create, remove, update } from '../../../db/repo';
import type { ISODate, PhotoPose, ProgressPhoto } from '../../../db/types';
import { notifyLocalChange } from '../../../sync/signal';
import { downloadPhoto } from '../../../sync/manager';
import { decodeImage } from '../../../lib/image';

/**
 * Progress photos are private: stored inside the app (IndexedDB), never in the camera
 * roll, and — when signed in — uploaded to a private per-user cloud folder.
 */

const FULL_EDGE = 1600;
const THUMB_EDGE = 360;

function render(src: ImageBitmap | HTMLImageElement, maxEdge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new Error('Could not process photo'))), 'image/jpeg', quality),
  );
}

export async function processImage(file: Blob) {
  const src = await decodeImage(file);
  const full = await render(src, FULL_EDGE, 0.85);
  const thumb = await render(src, THUMB_EDGE, 0.8);
  if ('close' in src) src.close();
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
}

export async function addPhoto(file: Blob, pose: PhotoPose, date: ISODate): Promise<ProgressPhoto> {
  const img = await processImage(file);
  const meta = await create('photos', { date, pose, width: img.width, height: img.height, note: null });
  await db.photoFiles.put({ id: meta.id, full: img.full, thumb: img.thumb, remote: 'pending' });
  notifyLocalChange();
  return meta;
}

export async function deletePhoto(id: string): Promise<void> {
  await remove('photos', id);
  const f = await db.photoFiles.get(id);
  // Never uploaded from here → just forget it; otherwise queue the cloud delete.
  if (f?.remote === 'pending' || f?.remote === 'none') await db.photoFiles.delete(id);
  else await db.photoFiles.put({ id, full: null, thumb: null, remote: 'delete' });
  notifyLocalChange();
}

export const setPhotoPose = (id: string, pose: PhotoPose) => update('photos', id, { pose });

/** Object URL for a photo (thumbnail or full). Downloads from the cloud if this device doesn't have it yet. */
export function usePhotoUrl(id: string, which: 'thumb' | 'full'): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: null, missing: false });
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      let f = await db.photoFiles.get(id);
      if (!f?.full && f?.remote !== 'delete') {
        const blob = await downloadPhoto(id);
        if (blob) {
          const img = await processImage(blob).catch(() => null);
          f = { id, full: blob, thumb: img?.thumb ?? blob, remote: 'uploaded' };
          await db.photoFiles.put(f);
        }
      }
      const blob = which === 'thumb' ? (f?.thumb ?? f?.full) : f?.full;
      if (cancelled) return;
      if (!blob) return setState({ url: null, missing: true });
      url = URL.createObjectURL(blob);
      setState({ url, missing: false });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, which]);
  return state;
}

/** All locally available full-size photos, for export. */
export async function exportablePhotos(): Promise<File[]> {
  const metas = (await db.photos.orderBy('date').toArray()).filter((p) => p.deletedAt === null);
  const files: File[] = [];
  for (const m of metas) {
    const f = await db.photoFiles.get(m.id);
    if (f?.full) files.push(new File([f.full], `progress-${m.date}-${m.pose}-${m.id.slice(0, 4)}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}
