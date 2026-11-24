import type { Pt } from '../core/types.ts';
import type { Ent, StudioDoc } from './model.ts';
import { bulgeArc, dist, geometryEnts, polarPt, polyPts, signedArea, sweepOf, tess } from './geom.ts';

/* Closed profiles of the sketch: the outlines a 3D body is made from.
 * A profile is one closed entity (circle, ellipse, closed polyline/spline) or a chain of lines/arcs/open polylines meeting end to end. */

export interface Loop {
  /** entities that make the loop */
  ids: string[];
  /** the outline as points, counter-clockwise, without repeating the first point */
  pts: Pt[];
  /** exact circle (kept so holes stay true circles in the 3D model and STEP file) */
  circle?: { c: Pt; r: number };
  area: number;
}
const TOL = 1e-3;

function ccw(pts: Pt[]): Pt[] {
  let p = pts.slice();
  if (p.length > 2 && dist(p[0], p[p.length - 1]) < 1e-9) p = p.slice(0, -1);
  return signedArea(p) < 0 ? p.reverse() : p;
}
export function isClosedEnt(e: Ent): boolean { return e.k === 'circle' || e.k === 'ellipse' || ((e.k === 'poly' || e.k === 'spline') && e.closed); }
function endsOf(e: Ent): [Pt, Pt] | null {
  if (e.k === 'line') return [e.a, e.b];
  if (e.k === 'arc') return [polarPt(e.c, e.r, e.a0), polarPt(e.c, e.r, e.a1)];
  if ((e.k === 'poly' || e.k === 'spline') && !e.closed) return [e.pts[0], e.pts[e.pts.length - 1]];
  return null;
}
function pathOf(e: Ent, tol: number): Pt[] {
  if (e.k === 'poly') return polyPts(e, tol);
  return tess(e, tol)[0] ?? [];
}

/** All closed loops of the visible geometry. Open chains are reported separately (open profiles). */
export function findLoops(d: StudioDoc, tol = 0.01): { loops: Loop[]; open: { ids: string[]; gap: number; ends: [Pt, Pt] }[] } {
  const ents = geometryEnts(d);
  const loops: Loop[] = [], open: { ids: string[]; gap: number; ends: [Pt, Pt] }[] = [];
  for (const e of ents) if (isClosedEnt(e)) {
    const pts = ccw(e.k === 'circle' ? tess(e, tol)[0] : pathOf(e, tol));
    if (pts.length >= 3) loops.push({ ids: [e.id], pts, ...(e.k === 'circle' ? { circle: { c: e.c, r: e.r } } : {}), area: exactArea(e) ?? Math.abs(signedArea(pts)) });
  }
  // chains of open pieces
  const pieces = ents.filter((e) => !isClosedEnt(e) && endsOf(e));
  const used = new Set<string>();
  for (const start of pieces) {
    if (used.has(start.id)) continue;
    used.add(start.id);
    const chain: { e: Ent; rev: boolean }[] = [{ e: start, rev: false }];
    const headTail = () => { const f = chain[0], l = chain[chain.length - 1]; const fe = endsOf(f.e)!, le = endsOf(l.e)!; return { head: f.rev ? fe[1] : fe[0], tail: l.rev ? le[0] : le[1] }; };
    let grew = true;
    while (grew) {
      grew = false;
      const { head, tail } = headTail();
      if (chain.length > 1 && dist(head, tail) < TOL) break;
      for (const o of pieces) {
        if (used.has(o.id)) continue;
        const [a, b] = endsOf(o)!;
        if (dist(a, tail) < TOL) chain.push({ e: o, rev: false }); else if (dist(b, tail) < TOL) chain.push({ e: o, rev: true });
        else if (dist(b, head) < TOL) chain.unshift({ e: o, rev: false }); else if (dist(a, head) < TOL) chain.unshift({ e: o, rev: true }); else continue;
        used.add(o.id); grew = true; break;
      }
    }
    const { head, tail } = headTail();
    if (dist(head, tail) < TOL && (chain.length > 1 || start.k === 'poly' || start.k === 'spline')) {
      const pts: Pt[] = [];
      for (const c of chain) { let p = pathOf(c.e, tol); if (c.rev) p = p.slice().reverse(); pts.push(...(pts.length ? p.slice(1) : p)); }
      const loop = ccw(pts);
      if (loop.length >= 3) loops.push({ ids: chain.map((c) => c.e.id), pts: loop, area: Math.abs(signedArea(loop)) });
    } else open.push({ ids: chain.map((c) => c.e.id), gap: dist(head, tail), ends: [head, tail] });
  }
  return { loops, open };
}

/** exact enclosed area of a closed entity (true circles, ellipses and arc segments of polylines), mm² */
export function exactArea(e: Ent): number | null {
  if (e.k === 'circle') return Math.PI * e.r * e.r;
  if (e.k === 'ellipse') return Math.PI * e.rx * e.ry;
  if (e.k === 'poly' && e.closed) {
    let a = signedArea(e.pts);
    const n = e.pts.length;
    for (let i = 0; i < n; i++) { const arc = bulgeArc(e.pts[i], e.pts[(i + 1) % n], e.bulge?.[i] ?? 0); if (arc) a += (arc.r * arc.r / 2) * (arc.sweep - Math.sin(arc.sweep)); }
    return Math.abs(a);
  }
  return null;
}
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** loop b lies completely inside loop a (every point of b inside a, and no crossing) */
export function loopInside(b: Loop, a: Loop): boolean {
  if (b.area >= a.area) return false;
  const step = Math.max(1, Math.floor(b.pts.length / 64));
  for (let i = 0; i < b.pts.length; i += step) if (!pointInPoly(b.pts[i], a.pts)) return false;
  return !loopsCross(a, b);
}
export function loopsCross(a: Loop, b: Loop): boolean {
  const A = a.pts, B = b.pts;
  const bx = (pts: Pt[]) => pts.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const ba = bx(A), bb = bx(B); if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) return false;
  for (let i = 0; i < A.length; i++) {
    const p = A[i], q = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const r = B[j], s = B[(j + 1) % B.length];
      const d1 = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]), d2 = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
      const d3 = (s[0] - r[0]) * (p[1] - r[1]) - (s[1] - r[1]) * (p[0] - r[0]), d4 = (s[0] - r[0]) * (q[1] - r[1]) - (s[1] - r[1]) * (q[0] - r[0]);
      if (((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12))) return true;
    }
  }
  return false;
}

export interface Profile { outer: Loop; holes: Loop[]; islands: number; crossing: string[] }
/** The profile that entity `id` belongs to: its loop as the outside and every loop directly inside it as a hole (internal profile). */
export function profileOf(d: StudioDoc, id: string, found = findLoops(d), exclude?: Set<string>): Profile | { error: string } {
  const outer = found.loops.find((l) => l.ids.includes(id));
  if (!outer) {
    const op = found.open.find((o) => o.ids.includes(id));
    return { error: op ? `This outline is not closed: its ends are ${+op.gap.toFixed(3)} mm apart. Close the gap (snap the end points together) first.` : 'Pick a closed outline (circle, rectangle, closed polyline or a closed chain of lines and arcs).' };
  }
  // loops used as the profile of another 3D body (for example a pocket) are not holes of this one
  const inside = found.loops.filter((l) => l !== outer && !(exclude && l.ids.some((x) => exclude.has(x))) && loopInside(l, outer));
  const holes = inside.filter((h) => !inside.some((o) => o !== h && loopInside(h, o)));
  const crossing = found.loops.filter((l) => l !== outer && !inside.includes(l) && loopsCross(l, outer)).flatMap((l) => l.ids);
  return { outer, holes, islands: inside.length - holes.length, crossing };
}
/** total area of a profile (outer minus holes), mm² */
export const profileArea = (p: Profile): number => p.outer.area - p.holes.reduce((s, h) => s + h.area, 0);
/** first moment about the Y axis of the region (for Pappus volume of a revolve): ∫ x dA */
export function regionMomentX(p: Profile, axis: 'x' | 'y', at: number): { A: number; M: number } {
  const mom = (pts: Pt[]) => { let a = 0, m = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], c = x0 * y1 - x1 * y0; a += c; m += axis === 'y' ? (x0 + x1) * c : (y0 + y1) * c; } return { a: a / 2, m: m / 6 }; };
  const o = mom(p.outer.pts); let A = Math.abs(o.a), M = Math.sign(o.a) * o.m;
  for (const h of p.holes) { const q = mom(h.pts); A -= Math.abs(q.a); M -= Math.sign(q.a) * q.m; }
  return { A, M: M - A * at };
}
export { bulgeArc, sweepOf };
