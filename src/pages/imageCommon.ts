import { autoThreshold, backgroundDistance, largestComponent } from '../lib/trace.ts';
import type { Raster } from '../lib/trace.ts';

export const MAX_SIDE = 700;       // pictures are shrunk to this size before tracing (fast, and plenty for an outline)
export const MAX_FILE = 15 * 1024 * 1024;

export interface Loaded { raster: Raster; url: string; mime: string; base64: string; name: string; autoThr: number }

export async function loadPicture(file: File): Promise<Loaded> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture file (JPG, PNG, WebP).');
  if (file.size > MAX_FILE) throw new Error('The picture is larger than 15 MB. Please use a smaller one.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened. Try saving it as JPG or PNG.'); });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser cannot read pictures here.');
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
  const raster: Raster = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
  const url = cv.toDataURL('image/webp', 0.85), mime = url.slice(5, url.indexOf(';'));
  return { raster, url, mime, base64: url.slice(url.indexOf(',') + 1), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Picture', autoThr: autoThreshold(backgroundDistance(raster).dist) };
}


/** Foreground mask of the largest object: pixels that differ from the background by more than `thr` (or the opposite when `invert`). */
export function maskOf(raster: Raster, thr: number, invert: boolean): Uint8Array {
  const { dist } = backgroundDistance(raster);
  let m: Uint8Array = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < m.length; i++) m[i] = (dist[i] > thr ? 1 : 0) ^ (invert ? 1 : 0);
  m = largestComponent(m, raster.width, raster.height);
  return m;
}
