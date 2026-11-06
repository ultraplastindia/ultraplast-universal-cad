import type { Pt } from './types.ts';

/** Path segment: straight line, or true circular arc through a mid-point. */
export type Seg = { t: 'L'; to: Pt } | { t: 'A'; mid: Pt; to: Pt };

export const polar = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)];

export function circumcentre(a: Pt, b: Pt, c: Pt): Pt {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
}

/** Maximum allowed distance between a chord and the true curve, in mm (applies to every polygonised curve). */
export const CHORD_TOL = 0.003;
/** Number of segments needed to approximate a full circle of radius r within `tol`. */
export const circleSegments = (r: number, tol = CHORD_TOL, min = 48): number => Math.max(min, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - tol / Math.max(r, tol * 2)))));

/** Sample an arc p0 -> pm -> p1 (excluding p0, including p1). n = 0 chooses the segment count from CHORD_TOL. */
export function arcPoints(p0: Pt, pm: Pt, p1: Pt, n = 0): Pt[] {
  const [cx, cy] = circumcentre(p0, pm, p1);
  const r = Math.hypot(p0[0] - cx, p0[1] - cy);
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  const norm = (a: number) => { let x = a - a0; while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
  const m = norm(Math.atan2(pm[1] - cy, pm[0] - cx));
  const e = norm(Math.atan2(p1[1] - cy, p1[0] - cx));
  const sweep = m < e ? e : e - 2 * Math.PI;
  if (n <= 0) n = Math.max(2, Math.ceil((Math.abs(sweep) * circleSegments(r, CHORD_TOL, 4)) / (2 * Math.PI)));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Discretise a closed path. The final point equals the start and is dropped. */
export function discretize(start: Pt, path: Seg[], nArc = 0): Pt[] {
  const pts: Pt[] = [start];
  let cur = start;
  for (const s of path) {
    if (s.t === 'L') pts.push(s.to);
    else pts.push(...arcPoints(cur, s.mid, s.to, nArc));
    cur = s.to;
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - start[0], last[1] - start[1]) < 1e-9) pts.pop();
  return pts;
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function circlePts(r: number, n = 0, c: Pt = [0, 0]): Pt[] {
  if (n <= 0) n = circleSegments(r);
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Pt);
}

/** Bore outline with an optional keyway notch on +Y.
 *  t2 = hub keyway depth measured from the bore surface (DIN 6885 / ISO 773). */
export function borePolygon(r: number, key: { b: number; t2: number } | null, n = 0): Pt[] {
  if (n <= 0) n = circleSegments(r);
  if (!key) return circlePts(r, n);
  const th = Math.asin(key.b / 2 / r);
  const a0 = Math.PI / 2 + th, a1 = Math.PI / 2 + 2 * Math.PI - th;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const top = r + key.t2;
  pts.push([key.b / 2, top], [-key.b / 2, top]);
  return pts;
}
