import type { Pt } from '../core/types.ts';
import type { Dim, Ent, EntOf, LRef, PRef, StudioDoc } from './model.ts';

/* Pure 2D geometry for the Design Studio: points of entities, curves as points, distances, intersections and transforms.
 * Everything is in millimetres. No browser APIs, so all of it is unit-tested. */

export const TAU = Math.PI * 2;
export const EPS = 1e-9;
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
export const crs = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const norm = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const polarPt = (c: Pt, r: number, a: number): Pt => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
export const angOf = (c: Pt, p: Pt): number => Math.atan2(p[1] - c[1], p[0] - c[0]);
export const normAng = (a: number): number => { let x = a % TAU; if (x < 0) x += TAU; return x; };
/** counter-clockwise sweep from a0 to a1, in (0, 2π] */
export const sweepOf = (a0: number, a1: number): number => { const s = normAng(a1 - a0); return s < 1e-12 ? TAU : s; };
/** is angle a inside the CCW arc a0 -> a1 */
export const inArc = (a: number, a0: number, a1: number): boolean => normAng(a - a0) <= sweepOf(a0, a1) + 1e-12;
export const round = (v: number, dp = 6): number => { const k = 10 ** dp; return Math.round(v * k) / k; };

/** number of straight pieces so that the chord error stays below tol */
export function arcSteps(r: number, sweep: number, tol = 0.01): number {
  const a = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, tol * 2))));
  return Math.max(2, Math.min(1440, Math.ceil(Math.abs(sweep) / Math.max(a, 1e-4))));
}
export function arcPts(c: Pt, r: number, a0: number, sweep: number, tol = 0.01): Pt[] {
  const n = arcSteps(r, sweep, tol);
  return Array.from({ length: n + 1 }, (_, i) => polarPt(c, r, a0 + (sweep * i) / n));
}

/** Arc of a bulged polyline segment p0 -> p1 (bulge = tan(sweep/4), positive = counter-clockwise). */
export function bulgeArc(p0: Pt, p1: Pt, b: number): { c: Pt; r: number; a0: number; sweep: number } | null {
  if (Math.abs(b) < 1e-12) return null;
  const ch = dist(p0, p1); if (ch < EPS) return null;
  const th = 4 * Math.atan(b), d = sub(p1, p0), n: Pt = [-d[1] / ch, d[0] / ch];
  const c = add(mid(p0, p1), mul(n, ch / 2 / Math.tan(th / 2)));
  return { c, r: Math.abs(ch / 2 / Math.sin(th / 2)), a0: angOf(c, p0), sweep: th };
}
/** bulge that makes segment p0 -> p1 an arc of signed sweep th */
export const bulgeOf = (th: number): number => Math.tan(th / 4);

export function ellipsePt(e: { c: Pt; rx: number; ry: number; rot: number }, t: number): Pt {
  const x = e.rx * Math.cos(t), y = e.ry * Math.sin(t), cr = Math.cos(e.rot), sr = Math.sin(e.rot);
  return [e.c[0] + x * cr - y * sr, e.c[1] + x * sr + y * cr];
}

/** Centripetal Catmull-Rom curve through the points. */
export function splinePts(pts: Pt[], closed: boolean, per = 16): Pt[] {
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2 && !closed) return pts.slice();
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [sub(mul(pts[0], 2), pts[1]), ...pts, sub(mul(pts[pts.length - 1], 2), pts[pts.length - 2])];
  const out: Pt[] = [];
  const tj = (ti: number, a: Pt, b: Pt) => ti + Math.max(Math.sqrt(dist(a, b)), 1e-6);
  const segs = closed ? pts.length : pts.length - 1;
  for (let s = 0; s < segs; s++) {
    const [p0, p1, p2, p3] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let i = 0; i < per; i++) {
      const t = t1 + ((t2 - t1) * i) / per;
      const L = (a: Pt, b: Pt, ta: number, tb: number): Pt => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(closed ? out[0] : pts[pts.length - 1]);
  return out;
}

/** Points along a polyline including its bulged (arc) segments. */
export function polyPts(e: { pts: Pt[]; closed: boolean; bulge?: number[] }, tol = 0.01): Pt[] {
  const n = e.pts.length, segs = e.closed ? n : n - 1, out: Pt[] = [e.pts[0]];
  for (let i = 0; i < segs; i++) {
    const p0 = e.pts[i], p1 = e.pts[(i + 1) % n], arc = bulgeArc(p0, p1, e.bulge?.[i] ?? 0);
    if (arc) out.push(...arcPts(arc.c, arc.r, arc.a0, arc.sweep, tol).slice(1));
    else out.push(p1);
  }
  return out;
}

/** The curve of an entity as one or more polylines (closed curves repeat the first point). Text and dimensions give nothing. */
export function tess(e: Ent, tol = 0.01): Pt[][] {
  switch (e.k) {
    case 'line': return [[e.a, e.b]];
    case 'poly': return [polyPts(e, tol)];
    case 'circle': return [arcPts(e.c, e.r, 0, TAU, tol)];
    case 'arc': return [arcPts(e.c, e.r, e.a0, sweepOf(e.a0, e.a1), tol)];
    case 'ellipse': { const n = arcSteps(Math.max(e.rx, e.ry), TAU, tol); return [Array.from({ length: n + 1 }, (_, i) => ellipsePt(e, (TAU * i) / n))]; }
    case 'spline': return [splinePts(e.pts, e.closed, 24)];
    default: return [];
  }
}

/** Editable points of an entity. Their index is what PRef.i refers to. */
export function handles(e: Ent): Pt[] {
  switch (e.k) {
    case 'line': return [e.a, e.b];
    case 'poly': case 'spline': return e.pts;
    case 'circle': return [e.c];
    case 'arc': return [e.c, polarPt(e.c, e.r, e.a0), polarPt(e.c, e.r, e.a1)];
    case 'ellipse': return [e.c];
    case 'text': return [e.p];
    default: return [];
  }
}
/** Moves one handle. Arc ends keep the centre and change radius/angle. */
export function setHandle(e: Ent, i: number, p: Pt): Ent {
  switch (e.k) {
    case 'line': return i === 0 ? { ...e, a: p } : { ...e, b: p };
    case 'poly': case 'spline': { const pts = e.pts.slice(); if (i >= 0 && i < pts.length) pts[i] = p; return { ...e, pts }; }
    case 'circle': return { ...e, c: p };
    case 'arc': return i === 0 ? { ...e, c: p } : i === 1 ? { ...e, a0: angOf(e.c, p), r: dist(e.c, p) } : { ...e, a1: angOf(e.c, p), r: dist(e.c, p) };
    case 'ellipse': return { ...e, c: p };
    case 'text': return { ...e, p };
    default: return e;
  }
}
export const findEnt = (d: { ents: Ent[] }, id: string): Ent | undefined => d.ents.find((e) => e.id === id);
export function pointOf(d: { ents: Ent[] }, r: PRef): Pt | null { const e = findEnt(d, r.e); if (!e) return null; const h = handles(e); return h[r.i] ?? null; }
/** end points of a straight edge reference */
export function lineOf(d: { ents: Ent[] }, r: LRef): [Pt, Pt] | null {
  const e = findEnt(d, r.e); if (!e) return null;
  if (e.k === 'line') return [e.a, e.b];
  if (e.k === 'poly') { const s = r.seg ?? 0, n = e.pts.length; if (s < 0 || s >= (e.closed ? n : n - 1)) return null; return [e.pts[s], e.pts[(s + 1) % n]]; }
  return null;
}
export const radiusOf = (e: Ent | undefined): number | null => (e && (e.k === 'circle' || e.k === 'arc') ? e.r : null);
export const centreOf = (e: Ent | undefined): Pt | null => (e && (e.k === 'circle' || e.k === 'arc' || e.k === 'ellipse') ? e.c : null);

/** Snap candidates: end points, middles, centres and quadrant points. */
export function snapPoints(e: Ent): { p: Pt; kind: 'end' | 'mid' | 'centre' | 'quad' }[] {
  const o: { p: Pt; kind: 'end' | 'mid' | 'centre' | 'quad' }[] = [];
  if (e.k === 'line') o.push({ p: e.a, kind: 'end' }, { p: e.b, kind: 'end' }, { p: mid(e.a, e.b), kind: 'mid' });
  else if (e.k === 'poly') { const n = e.pts.length; e.pts.forEach((p) => o.push({ p, kind: 'end' })); for (let i = 0; i < (e.closed ? n : n - 1); i++) { const arc = bulgeArc(e.pts[i], e.pts[(i + 1) % n], e.bulge?.[i] ?? 0); o.push({ p: arc ? polarPt(arc.c, arc.r, arc.a0 + arc.sweep / 2) : mid(e.pts[i], e.pts[(i + 1) % n]), kind: 'mid' }); if (arc) o.push({ p: arc.c, kind: 'centre' }); } }
  else if (e.k === 'circle') { o.push({ p: e.c, kind: 'centre' }); for (let q = 0; q < 4; q++) o.push({ p: polarPt(e.c, e.r, (q * Math.PI) / 2), kind: 'quad' }); }
  else if (e.k === 'arc') { o.push({ p: e.c, kind: 'centre' }, { p: polarPt(e.c, e.r, e.a0), kind: 'end' }, { p: polarPt(e.c, e.r, e.a1), kind: 'end' }, { p: polarPt(e.c, e.r, e.a0 + sweepOf(e.a0, e.a1) / 2), kind: 'mid' }); }
  else if (e.k === 'ellipse') { o.push({ p: e.c, kind: 'centre' }); for (let q = 0; q < 4; q++) o.push({ p: ellipsePt(e, (q * Math.PI) / 2), kind: 'quad' }); }
  else if (e.k === 'spline') e.pts.forEach((p) => o.push({ p, kind: 'end' }));
  else if (e.k === 'text') o.push({ p: e.p, kind: 'end' });
  return o;
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a), L2 = dot(d, d);
  const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / L2));
  return dist(p, add(a, mul(d, t)));
}
export function polylineDist(p: Pt, pts: Pt[]): number { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, segDist(p, pts[i], pts[i + 1])); return pts.length === 1 ? dist(p, pts[0]) : m; }
/** distance from a point to an entity's curve (for picking) */
export function entDist(e: Ent, p: Pt, d?: { ents: Ent[] }): number {
  switch (e.k) {
    case 'line': return segDist(p, e.a, e.b);
    case 'circle': return Math.abs(dist(p, e.c) - e.r);
    case 'arc': { const a = angOf(e.c, p); return inArc(a, e.a0, e.a1) ? Math.abs(dist(p, e.c) - e.r) : Math.min(dist(p, polarPt(e.c, e.r, e.a0)), dist(p, polarPt(e.c, e.r, e.a1))); }
    case 'text': { const w = e.s.length * e.h * 0.6; return Math.max(0, Math.abs(p[0] - (e.p[0] + w / 2)) - w / 2, Math.abs(p[1] - (e.p[1] + e.h / 2)) - e.h / 2); }
    case 'dim': { if (!d) return Infinity; const g = dimGeometry(d, e); return g ? Math.min(polylineDist(p, [g.a, g.b]), dist(p, g.textAt)) : Infinity; }
    default: return Math.min(...tess(e, 0.05).map((pl) => polylineDist(p, pl)));
  }
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const boxAdd = (b: Box, p: Pt): void => { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]); };
export const boxOk = (b: Box): boolean => Number.isFinite(b.x0) && Number.isFinite(b.x1);
export function entBox(e: Ent): Box {
  const b = emptyBox();
  if (e.k === 'circle') { boxAdd(b, [e.c[0] - e.r, e.c[1] - e.r]); boxAdd(b, [e.c[0] + e.r, e.c[1] + e.r]); }
  else if (e.k === 'text') { boxAdd(b, e.p); boxAdd(b, [e.p[0] + e.s.length * e.h * 0.6, e.p[1] + e.h]); }
  else for (const pl of tess(e, 0.05)) pl.forEach((p) => boxAdd(b, p));
  return b;
}
export function boxOf(ents: Ent[]): Box { const b = emptyBox(); for (const e of ents) { if (e.k === 'dim') continue; const q = entBox(e); if (boxOk(q)) { boxAdd(b, [q.x0, q.y0]); boxAdd(b, [q.x1, q.y1]); } } return b; }

/* ---------- measured values ---------- */
export function curveLength(e: Ent): number {
  if (e.k === 'line') return dist(e.a, e.b);
  if (e.k === 'circle') return TAU * e.r;
  if (e.k === 'arc') return e.r * sweepOf(e.a0, e.a1);
  return tess(e, 0.005).reduce((s, pl) => s + pl.reduce((a, p, i) => (i ? a + dist(pl[i - 1], p) : 0), 0), 0);
}
export function signedArea(pts: Pt[]): number { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
/** angle between two lines in degrees, 0..180 (between their directions as drawn) */
export function lineAngle(a: [Pt, Pt], b: [Pt, Pt]): number {
  const u = norm(sub(a[1], a[0])), v = norm(sub(b[1], b[0]));
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180) / Math.PI;
}

/** The value a dimension shows (mm or degrees), measured from the geometry it points at. Always equal to the drawing. */
export function dimValue(d: { ents: Ent[] }, e: EntOf<'dim'>): number | null {
  const x = e.d;
  if (x.kind === 'dist' || x.kind === 'hdist' || x.kind === 'vdist') {
    const p = pointOf(d, x.p1), q = pointOf(d, x.p2); if (!p || !q) return null;
    return x.kind === 'dist' ? dist(p, q) : x.kind === 'hdist' ? Math.abs(q[0] - p[0]) : Math.abs(q[1] - p[1]);
  }
  if (x.kind === 'length') { const l = lineOf(d, x.l); return l ? dist(l[0], l[1]) : null; }
  if (x.kind === 'radius' || x.kind === 'diameter') { const r = radiusOf(findEnt(d, x.e)); return r === null ? null : x.kind === 'radius' ? r : 2 * r; }
  if (x.kind !== 'angle') return null;
  const l1 = lineOf(d, x.l1), l2 = lineOf(d, x.l2); return l1 && l2 ? lineAngle(l1, l2) : null;
}
export function dimLabel(d: { ents: Ent[] }, e: EntOf<'dim'>, fmt: (mm: number) => string): string {
  const v = dimValue(d, e); if (v === null) return '?';
  const k = e.d.kind;
  return k === 'angle' ? `${+v.toFixed(2)}°` : k === 'radius' ? `R${fmt(v)}` : k === 'diameter' ? `Ø${fmt(v)}` : fmt(v);
}
/** Where a dimension is drawn: the dimension line a-b, its two measured points and the text position. */
export function dimGeometry(d: { ents: Ent[] }, e: EntOf<'dim'>): { a: Pt; b: Pt; p: Pt; q: Pt; textAt: Pt; ang: number } | null {
  const x = e.d;
  if (x.kind === 'dist' || x.kind === 'hdist' || x.kind === 'vdist' || x.kind === 'length') {
    let p: Pt | null, q: Pt | null;
    if (x.kind === 'length') { const l = lineOf(d, x.l); if (!l) return null; [p, q] = l; } else { p = pointOf(d, x.p1); q = pointOf(d, x.p2); }
    if (!p || !q) return null;
    let a: Pt, b: Pt;
    if (x.kind === 'hdist') { const y = Math.max(p[1], q[1]) + x.off; a = [p[0], y]; b = [q[0], y]; }
    else if (x.kind === 'vdist') { const xx = Math.max(p[0], q[0]) + x.off; a = [xx, p[1]]; b = [xx, q[1]]; }
    else { const u = norm(sub(q, p)), n: Pt = [-u[1], u[0]]; a = add(p, mul(n, x.off)); b = add(q, mul(n, x.off)); }
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return { a, b, p, q, textAt: mid(a, b), ang };
  }
  if (x.kind === 'radius' || x.kind === 'diameter') {
    const t = findEnt(d, x.e); const c = centreOf(t), r = radiusOf(t); if (!c || r === null) return null;
    const edge = polarPt(c, r, x.ang), start = x.kind === 'diameter' ? polarPt(c, r, x.ang + Math.PI) : c;
    return { a: start, b: edge, p: start, q: edge, textAt: polarPt(c, r * 1.25 + 2, x.ang), ang: x.ang };
  }
  if (x.kind !== 'angle') return null;
  const l1 = lineOf(d, x.l1), l2 = lineOf(d, x.l2); if (!l1 || !l2) return null;
  const c = intersectLines(l1[0], l1[1], l2[0], l2[1]) ?? mid(l1[0], l2[0]);
  const a1 = Math.atan2(l1[1][1] - l1[0][1], l1[1][0] - l1[0][0]), a2 = Math.atan2(l2[1][1] - l2[0][1], l2[1][0] - l2[0][0]);
  return { a: polarPt(c, x.rad, a1), b: polarPt(c, x.rad, a2), p: c, q: c, textAt: polarPt(c, x.rad + 3, (a1 + a2) / 2), ang: 0 };
}

/* ---------- intersections ---------- */
/** infinite-line intersection */
export function intersectLines(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a), s = sub(d, c), den = crs(r, s);
  if (Math.abs(den) < 1e-12 * Math.max(1, dot(r, r) * dot(s, s))) return null;
  const t = crs(sub(c, a), s) / den;
  return add(a, mul(r, t));
}
/** parameters t on segment a-b (0..1 inclusive with tolerance) where it meets segment c-d */
export function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number; p: Pt } | null {
  const r = sub(b, a), s = sub(d, c), den = crs(r, s);
  if (Math.abs(den) < 1e-14) return null;
  const t = crs(sub(c, a), s) / den, u = crs(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, p: add(a, mul(r, t)) };
}
/** parameters t along the infinite line a + t(b-a) where it meets the circle */
export function lineCircle(a: Pt, b: Pt, c: Pt, r: number): number[] {
  const d = sub(b, a), f = sub(a, c), A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r, disc = B * B - 4 * A * C;
  if (A < EPS || disc < -1e-12) return [];
  if (disc < 1e-12) return [-B / (2 * A)];
  const s = Math.sqrt(disc); return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}
export function circleCircle(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2); if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a)), u = norm(sub(c2, c1)), m = add(c1, mul(u, a));
  return h < 1e-9 ? [m] : [add(m, [-u[1] * h, u[0] * h]), add(m, [u[1] * h, -u[0] * h])];
}

/** A curve piece used for trim/extend: straight segment or circular arc (full circle = arc with sweep 2π). */
export type Piece = { t: 'seg'; a: Pt; b: Pt } | { t: 'arc'; c: Pt; r: number; a0: number; sweep: number };
export function piecesOf(e: Ent): Piece[] {
  if (e.k === 'line') return [{ t: 'seg', a: e.a, b: e.b }];
  if (e.k === 'circle') return [{ t: 'arc', c: e.c, r: e.r, a0: 0, sweep: TAU }];
  if (e.k === 'arc') return [{ t: 'arc', c: e.c, r: e.r, a0: e.a0, sweep: sweepOf(e.a0, e.a1) }];
  if (e.k === 'poly') {
    const n = e.pts.length, out: Piece[] = [];
    for (let i = 0; i < (e.closed ? n : n - 1); i++) { const p = e.pts[i], q = e.pts[(i + 1) % n], arc = bulgeArc(p, q, e.bulge?.[i] ?? 0); out.push(arc ? { t: 'arc', ...arc } : { t: 'seg', a: p, b: q }); }
    return out;
  }
  if (e.k === 'ellipse' || e.k === 'spline') { const pl = tess(e, 0.02)[0]; return pl.slice(1).map((p, i) => ({ t: 'seg', a: pl[i], b: p })); }
  return [];
}
const onArcPiece = (p: Pt, k: Extract<Piece, { t: 'arc' }>): boolean => (k.sweep >= TAU - 1e-12 ? true : normAng(angOf(k.c, p) - k.a0) <= Math.abs(k.sweep) + 1e-9) ;
/** all points where two pieces meet */
export function piecePoints(k1: Piece, k2: Piece): Pt[] {
  if (k1.t === 'seg' && k2.t === 'seg') { const r = segSeg(k1.a, k1.b, k2.a, k2.b); return r ? [r.p] : []; }
  if (k1.t === 'arc' && k2.t === 'arc') return circleCircle(k1.c, k1.r, k2.c, k2.r).filter((p) => onArcPiece(p, k1) && onArcPiece(p, k2));
  const s = (k1.t === 'seg' ? k1 : k2) as Extract<Piece, { t: 'seg' }>, a = (k1.t === 'arc' ? k1 : k2) as Extract<Piece, { t: 'arc' }>;
  return lineCircle(s.a, s.b, a.c, a.r).filter((t) => t >= -1e-9 && t <= 1 + 1e-9).map((t) => add(s.a, mul(sub(s.b, s.a), t))).filter((p) => onArcPiece(p, a));
}
/** where a curve meets all the other entities */
export function crossings(e: Ent, others: Ent[]): Pt[] {
  const mine = piecesOf(e), out: Pt[] = [];
  for (const o of others) { if (o.id === e.id || o.k === 'dim' || o.k === 'text') continue; for (const k2 of piecesOf(o)) for (const k1 of mine) out.push(...piecePoints(k1, k2)); }
  return out;
}

/* ---------- transforms ---------- */
/** affine map p -> [m0*x + m1*y + m4, m2*x + m3*y + m5] */
export type Affine = [number, number, number, number, number, number];
export const applyAff = (m: Affine, p: Pt): Pt => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
export const translateAff = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];
export function rotateAff(c: Pt, deg: number): Affine { const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); return [co, -si, si, co, c[0] - co * c[0] + si * c[1], c[1] - si * c[0] - co * c[1]]; }
export function scaleAff(c: Pt, sx: number, sy: number): Affine { return [sx, 0, 0, sy, c[0] * (1 - sx), c[1] * (1 - sy)]; }
/** mirror about the line through a and b */
export function mirrorAff(a: Pt, b: Pt): Affine {
  const u = norm(sub(b, a)), xx = u[0] * u[0] - u[1] * u[1], xy = 2 * u[0] * u[1], m: Affine = [xx, xy, xy, -xx, 0, 0];
  const p = applyAff(m, a); m[4] = a[0] - p[0]; m[5] = a[1] - p[1]; return m;
}
/** Applies an affine map to an entity. Circles stay circles under uniform scale; under non-uniform scale they become ellipses (arcs: polylines). */
export function transformEnt(e: Ent, m: Affine): Ent {
  const T = (p: Pt) => applyAff(m, p), det = m[0] * m[3] - m[1] * m[2], k = Math.sqrt(Math.abs(det));
  const sx = Math.hypot(m[0], m[2]), sy = Math.hypot(m[1], m[3]), uniform = Math.abs(sx - sy) < 1e-9 * Math.max(1, sx) && Math.abs(m[0] * m[1] + m[2] * m[3]) < 1e-9 * Math.max(1, sx * sy);
  switch (e.k) {
    case 'line': return { ...e, a: T(e.a), b: T(e.b) };
    case 'poly': return { ...e, pts: e.pts.map(T), ...(e.bulge ? { bulge: e.bulge.map((b) => (det < 0 ? -b : b)) } : {}) };
    case 'spline': return { ...e, pts: e.pts.map(T) };
    case 'text': return { ...e, p: T(e.p), h: e.h * k, ...(e.arrowTo ? { arrowTo: T(e.arrowTo) } : {}) };
    case 'circle': {
      if (uniform) return { ...e, c: T(e.c), r: e.r * sx };
      const rot = Math.atan2(m[2], m[0]);
      return { ...e, k: 'ellipse', c: T(e.c), rx: e.r * sx, ry: e.r * sy, rot } as Ent;
    }
    case 'arc': {
      if (!uniform) { const pts = tess(e, 0.01)[0].map(T); return { id: e.id, layer: e.layer, source: e.source, style: e.style, k: 'poly', pts, closed: false } as Ent; }
      const s = T(polarPt(e.c, e.r, e.a0)), f = T(polarPt(e.c, e.r, e.a1)), c = T(e.c);
      return det < 0 ? { ...e, c, r: e.r * sx, a0: angOf(c, f), a1: angOf(c, s) } : { ...e, c, r: e.r * sx, a0: angOf(c, s), a1: angOf(c, f) };
    }
    case 'ellipse': {
      const p1 = sub(T(ellipsePt(e, 0)), T(e.c)), p2 = sub(T(ellipsePt(e, Math.PI / 2)), T(e.c));
      if (Math.abs(dot(p1, p2)) < 1e-9 * Math.max(1, dot(p1, p1))) return { ...e, c: T(e.c), rx: Math.hypot(...p1), ry: Math.hypot(...p2), rot: Math.atan2(p1[1], p1[0]) };
      return { id: e.id, layer: e.layer, source: e.source, style: e.style, k: 'spline', pts: Array.from({ length: 24 }, (_, i) => T(ellipsePt(e, (TAU * i) / 24))), closed: true } as Ent;
    }
    default: return e;
  }
}

/** entities that are real geometry (not text / dimensions / construction) on visible layers */
export function geometryEnts(d: StudioDoc, includeConstruction = false): Ent[] {
  const vis = new Set(d.layers.filter((l) => l.visible).map((l) => l.id));
  return d.ents.filter((e) => vis.has(e.layer) && e.k !== 'dim' && e.k !== 'text' && (includeConstruction || !e.style || e.style === 'normal'));
}

/** entity ids a dimension measures */
export function dimRefs(x: Dim): string[] {
  if ('p1' in x) return [x.p1.e, x.p2.e];
  if ('l1' in x) return [x.l1.e, x.l2.e];
  if ('l' in x) return [x.l.e];
  return [x.e];
}
