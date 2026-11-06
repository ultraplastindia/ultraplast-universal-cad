import type { Pt } from '../core/types.ts';
import type { RoundHole } from '../families/custom/shape.ts';

/** Turns a picture of a part (dark or coloured part on a plain background, or a PNG with transparent background)
 *  into an outline in real millimetres. Pure code: works on raw pixels, so it is easy to test without a browser. */

export interface Raster { width: number; height: number; data: Uint8ClampedArray | number[] } // RGBA, row by row
export interface TraceOptions {
  /** how different from the background a pixel must be (0-255) to count as part of the shape */
  threshold: number;
  /** pick the opposite: the part is the plain area and the background is the busy one */
  invert: boolean;
  /** corner-rounding smoothing of the pixel edge, in pixels (0 = none) */
  smooth: number;
  /** simplification: maximum allowed distance (pixels) between the simplified outline and the pixel edge */
  tolerance: number;
  maxPoints: number;
  /** ignore holes smaller than this fraction of the shape area */
  minHoleFrac: number;
}
export const DEFAULT_TRACE: TraceOptions = { threshold: 60, invert: false, smooth: 2, tolerance: 1.2, maxPoints: 250, minHoleFrac: 0.002 };

export interface TraceResult {
  outer: Pt[]; holes: Pt[][]; round: RoundHole[];
  width: number; height: number;
  /** bounding box of the outline in pixels: x0, y0, x1, y1 (y grows downward) */
  box: [number, number, number, number];
  mask: Uint8Array;
  warnings: string[];
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

/** Distance of every pixel from the background colour (0-255), or alpha-based when the picture has a transparent background. */
export function backgroundDistance(img: Raster): { dist: Uint8Array; transparent: boolean } {
  const { width: w, height: h, data } = img, n = w * h, dist = new Uint8Array(n);
  const border: number[] = [];
  for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
  const clear = border.filter((i) => data[i * 4 + 3] < 128).length;
  if (clear > border.length / 2) { for (let i = 0; i < n; i++) dist[i] = data[i * 4 + 3] >= 128 ? 255 : 0; return { dist, transparent: true }; }
  const bg = [0, 1, 2].map((c) => median(border.map((i) => data[i * 4 + c])));
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) { dist[i] = 0; continue; }
    dist[i] = Math.max(Math.abs(data[i * 4] - bg[0]), Math.abs(data[i * 4 + 1] - bg[1]), Math.abs(data[i * 4 + 2] - bg[2]));
  }
  return { dist, transparent: false };
}

/** Otsu's method on the background distances: a sensible starting threshold. */
export function autoThreshold(dist: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const d of dist) hist[d]++;
  const total = dist.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = 0, thr = 60;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return Math.max(15, Math.min(200, thr));
}

/** Keeps only the largest 4-connected group of part pixels. */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h), queue = new Int32Array(w * h);
  let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    id++; let head = 0, tail = 0; queue[tail++] = s; label[s] = id;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; queue[tail++] = p + w; }
    }
    if (tail > best) { best = tail; bestId = id; }
  }
  const out = new Uint8Array(w * h);
  if (bestId) for (let i = 0; i < out.length; i++) if (label[i] === bestId) out[i] = 1;
  return out;
}

/** Follows the pixel edges of a mask and returns every closed loop as a list of corner points (one point per unit step).
 *  The part is always on the right-hand side of the walking direction, so diagonal pixels are kept apart. */
export function boundaryLoops(mask: Uint8Array, w: number, h: number): Pt[][] {
  const W1 = w + 1, from: number[] = [], to: number[] = [], out = new Map<number, number[]>();
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const a = y0 * W1 + x0, b = y1 * W1 + x1, id = from.length;
    from.push(a); to.push(b);
    const l = out.get(a); if (l) l.push(id); else out.set(a, [id]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  const used = new Uint8Array(from.length), loops: Pt[][] = [];
  const vx = (v: number) => v % W1, vy = (v: number) => Math.floor(v / W1);
  for (let e0 = 0; e0 < from.length; e0++) {
    if (used[e0]) continue;
    const pts: Pt[] = []; let e = e0;
    for (;;) {
      used[e] = 1; pts.push([vx(from[e]), vy(from[e])]);
      const dx = vx(to[e]) - vx(from[e]), dy = vy(to[e]) - vy(from[e]);
      const cands = (out.get(to[e]) ?? []).filter((c) => !used[c]);
      if (!cands.length) break;
      // prefer a right turn (towards the part), then straight on, then a left turn
      const score = (c: number) => { const ex = vx(to[c]) - vx(from[c]), ey = vy(to[c]) - vy(from[c]); const cr = dx * ey - dy * ex; return cr > 0 ? 0 : cr === 0 ? 1 : 2; };
      cands.sort((a, b) => score(a) - score(b));
      e = cands[0];
    }
    if (pts.length >= 4) loops.push(pts);
  }
  return loops;
}

const area = (pts: Pt[]): number => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/** Moving-average smoothing of a closed loop. */
export function smoothLoop(pts: Pt[], r: number): Pt[] {
  if (r <= 0 || pts.length < 2 * r + 2) return pts;
  const n = pts.length;
  return pts.map((_, i) => { let x = 0, y = 0; for (let k = -r; k <= r; k++) { const p = pts[(i + k + n) % n]; x += p[0]; y += p[1]; } return [x / (2 * r + 1), y / (2 * r + 1)] as Pt; });
}

const dseg = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
function dpOpen(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = dseg(pts[i], pts[a], pts[b]); if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m] = 1; stack.push([a, m], [m, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Douglas-Peucker for a closed loop: split at the point farthest from the start, simplify both halves. */
export function simplifyLoop(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dpOpen(pts.slice(0, far + 1), tol), b = dpOpen([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function simplifyTo(pts: Pt[], tol: number, maxPts: number): Pt[] {
  let t = tol, r = simplifyLoop(pts, t);
  while (r.length > maxPts && t < 1e4) { t *= 1.25; r = simplifyLoop(pts, t); }
  return r;
}

export function traceImage(img: Raster, opt: Partial<TraceOptions> = {}): TraceResult | { error: string } {
  const o = { ...DEFAULT_TRACE, ...opt }, { width: w, height: h } = img;
  if (w < 8 || h < 8) return { error: 'The picture is too small.' };
  const { dist } = backgroundDistance(img);
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = (dist[i] > o.threshold ? 1 : 0) ^ (o.invert ? 1 : 0);
  mask = largestComponent(mask, w, h);
  const count = mask.reduce((a, b) => a + b, 0);
  if (count < w * h * 0.002) return { error: 'No shape was found. Lower the "Sensitivity" or try a picture with a plainer background.' };
  const loops = boundaryLoops(mask, w, h).map((l) => ({ l, a: Math.abs(area(l)) })).sort((p, q) => q.a - p.a);
  if (!loops.length) return { error: 'Could not find the edge of the shape.' };
  const warnings: string[] = [];
  if (count > w * h * 0.95) warnings.push('The shape fills almost the whole picture. The background may not be plain; try "Part is lighter than background" or another photo.');
  const outerSm = smoothLoop(loops[0].l, o.smooth), outerArea = Math.abs(area(outerSm));
  const outer = simplifyTo(outerSm, o.tolerance, o.maxPoints);
  if (outer.length < 3) return { error: 'The outline is too small to use.' };
  const holes: Pt[][] = [], round: RoundHole[] = [];
  for (const { l, a } of loops.slice(1)) {
    if (a < Math.max(12, outerArea * o.minHoleFrac)) continue;
    const sm = smoothLoop(l, Math.min(o.smooth, 1)), xs = sm.map((p) => p[0]), ys = sm.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), A = Math.abs(area(sm));
    const fill = A / ((Math.PI / 4) * bw * bh);
    if (Math.abs(bw - bh) / Math.max(bw, bh) < 0.15 && fill > 0.85 && fill < 1.1) round.push({ c: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2], r: Math.sqrt(A / Math.PI) });
    else { const s = simplifyTo(sm, o.tolerance, 60); if (s.length >= 3) holes.push(s); }
  }
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  return { outer, holes, round, width: w, height: h, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], mask, warnings };
}

export type RefDim = 'width' | 'height' | 'longest';
export interface Millimetres { outline: Pt[]; cutouts: Pt[][]; holes: RoundHole[]; scale: number; lengthMm: number; widthMm: number }

/** Scales the traced pixels to real size: the chosen overall dimension of the picture's shape becomes `mm`. The picture's up direction is kept. */
export function toMillimetres(t: TraceResult, ref: RefDim, mm: number): Millimetres {
  const [x0, y0, x1, y1] = t.box, wpx = x1 - x0, hpx = y1 - y0;
  const refPx = ref === 'width' ? wpx : ref === 'height' ? hpx : Math.max(wpx, hpx);
  const s = mm / refPx, P = (p: Pt): Pt => [+((p[0] - x0) * s).toFixed(3), +((y1 - p[1]) * s).toFixed(3)];
  return { outline: t.outer.map(P), cutouts: t.holes.map((l) => l.map(P)), holes: t.round.map((q) => ({ c: P(q.c), r: +(q.r * s).toFixed(3) })), scale: s, lengthMm: wpx * s, widthMm: hpx * s };
}
