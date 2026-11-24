import type { Pt } from '../core/types.ts';
import type { Ent, EntOf, Reference, StudioDoc } from './model.ts';
import { dimValue, dist, tess } from './geom.ts';

/* Original drawing versus generated CAD. The uploaded picture is compared pixel by pixel with the CAD lines placed on it:
 *  - each CAD item gets a score (how much of it lies on ink of the original),
 *  - ink of the original that no CAD line covers is reported as "not yet converted" spots,
 *  - dimensions read from the drawing are compared with the sizes measured on the CAD model.
 * Works on any grey-scale raster, so it is unit-tested with synthetic pictures. */

export interface Gray { w: number; h: number; v: Uint8Array } // 0 = black ink, 255 = white paper
export const toGray = (r: { width: number; height: number; data: ArrayLike<number> }): Gray => {
  const v = new Uint8Array(r.width * r.height);
  for (let i = 0; i < v.length; i++) { const a = r.data[i * 4 + 3] / 255; v[i] = Math.round(255 - a * (255 - (0.299 * r.data[i * 4] + 0.587 * r.data[i * 4 + 1] + 0.114 * r.data[i * 4 + 2]))); }
  return { w: r.width, h: r.height, v };
};
/** threshold between paper and ink (Otsu) */
export function otsu(g: Gray): number {
  const hist = new Array<number>(256).fill(0); for (const x of g.v) hist[x]++;
  const tot = g.v.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2; if (b > best) { best = b; thr = t; } }
  return thr;
}
/** distance (pixels) from every pixel to the nearest marked pixel: two-pass chamfer 3-4 transform */
export function distanceMap(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + 3); if (y > 0) { v = Math.min(v, d[i - w] + 3); if (x > 0) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); } d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = d[i]; if (x < w - 1) v = Math.min(v, d[i + 1] + 3); if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x > 0) v = Math.min(v, d[i + w - 1] + 4); } d[i] = v; }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}
/** model mm -> reference pixel (y down) */
export const toPx = (ref: Reference, p: Pt): Pt => [(p[0] - ref.x) / ref.mmPerPx, ref.pxH - (p[1] - ref.y) / ref.mmPerPx];
export const toMm = (ref: Reference, px: Pt): Pt => [ref.x + px[0] * ref.mmPerPx, ref.y + (ref.pxH - px[1]) * ref.mmPerPx];

export interface EntScore { id: string; score: number; samples: number }
export interface Comparison { scores: EntScore[]; overall: number; uncovered: { p: Pt; n: number }[]; uncoveredFrac: number; inkPixels: number; tolPx: number }

function samplesOf(e: Ent, ref: Reference): Pt[] {
  const out: Pt[] = [];
  for (const pl of tess(e, ref.mmPerPx * 0.5)) for (let i = 0; i + 1 < pl.length; i++) {
    const a = toPx(ref, pl[i]), b = toPx(ref, pl[i + 1]), n = Math.max(1, Math.ceil(dist(a, b)));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

export function compareToReference(d: StudioDoc, ref: Reference, g: Gray, tolPx = 2.5): Comparison {
  const thr = Math.min(200, otsu(g));
  const ink = new Uint8Array(g.w * g.h); let inkPixels = 0;
  for (let i = 0; i < ink.length; i++) if (g.v[i] <= thr) { ink[i] = 1; inkPixels++; }
  const inkDist = distanceMap(ink, g.w, g.h);
  const ents = d.ents.filter((e) => e.k !== 'dim' && e.k !== 'text' && e.style !== 'construction');
  const cad = new Uint8Array(g.w * g.h);
  const scores: EntScore[] = [];
  for (const e of ents) {
    const s = samplesOf(e, ref); let on = 0, inside = 0;
    for (const [x, y] of s) { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= g.w || yi >= g.h) continue; inside++; cad[yi * g.w + xi] = 1; if (inkDist[yi * g.w + xi] <= tolPx) on++; }
    if (inside) scores.push({ id: e.id, score: on / inside, samples: inside });
  }
  const cadDist = distanceMap(cad, g.w, g.h);
  // ink far from any CAD line, grouped on a coarse grid
  const cell = Math.max(8, Math.round(Math.max(g.w, g.h) / 40)), cells = new Map<number, { x: number; y: number; n: number }>();
  let far = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const i = y * g.w + x; if (!ink[i] || cadDist[i] <= tolPx * 1.5) continue; far++; const k = Math.floor(y / cell) * 100000 + Math.floor(x / cell); const c = cells.get(k) ?? { x: 0, y: 0, n: 0 }; c.x += x; c.y += y; c.n++; cells.set(k, c); }
  const uncovered = [...cells.values()].filter((c) => c.n >= cell * 0.5).sort((a, b) => b.n - a.n).slice(0, 60).map((c) => ({ p: [c.x / c.n, c.y / c.n] as Pt, n: c.n }));
  const totS = scores.reduce((s, x) => s + x.samples, 0);
  return { scores, overall: totS ? scores.reduce((s, x) => s + x.score * x.samples, 0) / totS : 0, uncovered, uncoveredFrac: inkPixels ? far / inkPixels : 0, inkPixels, tolPx };
}

/** Each confirmed/detected drawing dimension against the nearest matching size measured on the CAD model. */
export function compareDimensions(d: StudioDoc): { text: string; drawing: number; model: number | null; diff: number | null; status: 'match' | 'mismatch' | 'not found' }[] {
  const sizes: { kind: string; v: number }[] = [];
  for (const e of d.ents) {
    if (e.k === 'circle') sizes.push({ kind: 'diameter', v: 2 * e.r }, { kind: 'radius', v: e.r });
    if (e.k === 'arc') sizes.push({ kind: 'radius', v: e.r }, { kind: 'diameter', v: 2 * e.r });
    if (e.k === 'dim') { const v = dimValue(d, e as EntOf<'dim'>); if (v !== null) sizes.push({ kind: e.d.kind === 'angle' ? 'angle' : e.d.kind === 'radius' ? 'radius' : e.d.kind === 'diameter' ? 'diameter' : 'length', v }); }
  }
  const out: { text: string; drawing: number; model: number | null; diff: number | null; status: 'match' | 'mismatch' | 'not found' }[] = [];
  for (const r of d.refs) for (const t of r.detected) {
    if (t.status === 'rejected' || t.value === null || !['length', 'diameter', 'radius', 'angle'].includes(t.kind)) continue;
    const cand = sizes.filter((s) => s.kind === t.kind);
    if (!cand.length) { out.push({ text: t.text, drawing: t.value, model: null, diff: null, status: 'not found' }); continue; }
    const best = cand.reduce((a, b) => (Math.abs(b.v - t.value!) < Math.abs(a.v - t.value!) ? b : a));
    const diff = best.v - t.value, tol = Math.max(0.01, Math.abs(t.value) * 0.002);
    out.push({ text: t.text, drawing: t.value, model: best.v, diff, status: Math.abs(diff) <= tol ? 'match' : Math.abs(diff) <= Math.abs(t.value) * 0.05 ? 'mismatch' : 'not found' });
  }
  return out;
}
