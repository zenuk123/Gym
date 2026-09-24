/** Decode an image file, honouring EXIF orientation (iPhone photos are often stored rotated). */
export async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Meal photo → small 4:3 JPEG data URL (centre-cropped, ~40–70 KB). Small enough to live
 * inside the meal record, so it syncs and backs up with it.
 */
export async function mealPhotoDataUrl(file: Blob, width = 720, quality = 0.72): Promise<string> {
  const src = await decodeImage(file);
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const aspect = 4 / 3;
  const cropW = Math.min(sw, sh * aspect);
  const cropH = cropW / aspect;
  const w = Math.min(width, Math.round(cropW));
  const h = Math.round(w / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH, 0, 0, w, h);
  if ('close' in src) src.close();
  return canvas.toDataURL('image/jpeg', quality);
}
