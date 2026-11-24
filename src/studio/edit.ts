import type { Pt } from '../core/types.ts';
import type { Ent, EntOf } from './model.ts';
import { uid } from './model.ts';
import {
  add, angOf, applyAff, bulgeArc, bulgeOf, crossings, dist, dot, EPS, inArc, intersectLines, lineCircle, mul, norm, normAng, polarPt, polyPts,
  rotateAff, segDist, signedArea, sub, sweepOf, TAU, tess, transformEnt, translateAff,
} from './geom.ts';

/* Editing operations of the Design Studio: offset, trim, extend, fillet, chamfer, explode, join, arrays.
 * Each one returns new entities (or a readable error); the caller puts the result into the undo history. */

export type EditResult = { ok: true; remove: string[]; add: Ent[]; note?: string } | { ok: false; error: string };
const fail = (error: string): EditResult => ({ ok: false, error });
const copyBase = (e: Ent) => ({ layer: e.layer, source: e.source === 'feature' || e.source === 'library' ? ('drawn' as const) : e.source, ...(e.style ? { style: e.style } : {}) });

/* ---------- offset ---------- */
/** Offset of open or closed straight polylines: each edge moves by d (positive = to the left of its direction) and neighbours meet again (mitre). */
export function offsetPolyline(pts: Pt[], closed: boolean, d: number): Pt[] {
  const n = pts.length, segs = closed ? n : n - 1;
  const lines: [Pt, Pt][] = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], u = norm(sub(b, a)), nn: Pt = [-u[1] * d, u[0] * d];
    lines.push([add(a, nn), add(b, nn)]);
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === 0) { out.push(lines[0][0]); continue; }
    if (!closed && i === n - 1) { out.push(lines[segs - 1][1]); continue; }
    const L1 = lines[(i - 1 + segs) % segs], L2 = lines[i % segs], x = intersectLines(L1[0], L1[1], L2[0], L2[1]);
    out.push(x ?? L2[0]);
  }
  return out;
}
/** Offsets an entity by distance d towards the side where `side` lies. */
export function offsetEnt(e: Ent, d: number, side: Pt): EditResult {
  if (!(d > 0)) return fail('Enter an offset distance above 0.');
  const base = copyBase(e);
  if (e.k === 'line') {
    const u = norm(sub(e.b, e.a)), n: Pt = [-u[1], u[0]], s = dot(sub(side, e.a), n) >= 0 ? 1 : -1;
    return { ok: true, remove: [], add: [{ ...base, id: uid(), k: 'line', a: add(e.a, mul(n, d * s)), b: add(e.b, mul(n, d * s)) }] };
  }
  if (e.k === 'circle' || e.k === 'arc') {
    const r = dist(side, e.c) < e.r ? e.r - d : e.r + d;
    if (r <= EPS) return fail(`The offset (${d} mm) is larger than the radius (${+e.r.toFixed(3)} mm).`);
    return { ok: true, remove: [], add: [{ ...e, ...base, id: uid(), r }] };
  }
  if (e.k === 'ellipse') {
    const inside = ((side[0] - e.c[0]) ** 2) / (e.rx ** 2) + ((side[1] - e.c[1]) ** 2) / (e.ry ** 2) < 1, s = inside ? -1 : 1;
    if (e.rx + s * d <= 0 || e.ry + s * d <= 0) return fail('The offset is larger than the ellipse.');
    const pts = tess(e, 0.02)[0].slice(0, -1).map((p, i, a) => { const q = a[(i + 1) % a.length], r = a[(i - 1 + a.length) % a.length], t = norm(sub(q, r)); const nn: Pt = [t[1], -t[0]]; return add(p, mul(nn, d * s)); });
    return { ok: true, remove: [], add: [{ ...base, id: uid(), k: 'poly', pts, closed: true }], note: 'An offset ellipse is not an ellipse; it is drawn as a closed polyline.' };
  }
  if (e.k === 'poly' || e.k === 'spline') {
    const hasArc = e.k === 'poly' && e.bulge?.some((b) => Math.abs(b) > 1e-12);
    let pts = e.k === 'spline' || hasArc ? tess(e, 0.02)[0] : e.pts.slice();
    const closed = e.closed;
    if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts = pts.slice(0, -1);
    if (pts.length < 2) return fail('This shape is too small to offset.');
    // decide the side: try both, keep the one whose first edge is nearer to the picked side point
    const left = offsetPolyline(pts, closed, d), right = offsetPolyline(pts, closed, -d);
    const dl = Math.min(...left.map((p, i) => (i + 1 < left.length || closed ? segDist(side, p, left[(i + 1) % left.length]) : Infinity)));
    const dr = Math.min(...right.map((p, i) => (i + 1 < right.length || closed ? segDist(side, p, right[(i + 1) % right.length]) : Infinity)));
    let res = dl <= dr ? left : right;
    if (closed && Math.sign(signedArea(res)) !== Math.sign(signedArea(pts))) return fail('The offset is too large for this shape (it turns inside out).');
    if (closed && dl > dr && Math.abs(signedArea(res)) < 1e-9) res = left;
    return { ok: true, remove: [], add: [{ ...base, id: uid(), k: 'poly', pts: res, closed }], ...(hasArc || e.k === 'spline' ? { note: 'Curved parts were offset as short straight pieces.' } : {}) };
  }
  return fail('This kind of item cannot be offset.');
}

/* ---------- trim ---------- */
/** sorted values with near-duplicates removed */
const uniq = (v: number[]): number[] => v.slice().sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-9);
/** Removes the part of a line, arc or circle between the two cutting points around the picked point. */
export function trimEnt(e: Ent, pick: Pt, others: Ent[]): EditResult {
  const xs = crossings(e, others);
  const base = copyBase(e);
  if (e.k === 'line') {
    const d = sub(e.b, e.a), L2 = dot(d, d); if (L2 < EPS) return fail('The line has no length.');
    const ts = uniq(xs.map((p) => dot(sub(p, e.a), d) / L2)).filter((t) => t > 1e-6 && t < 1 - 1e-6);
    if (!ts.length) return fail('Nothing crosses this line, so there is nothing to trim against. Use Delete to remove it.');
    const tp = dot(sub(pick, e.a), d) / L2, cuts = [0, ...ts, 1];
    let k = 0; while (k < cuts.length - 2 && tp > cuts[k + 1]) k++;
    const at = (t: number): Pt => add(e.a, mul(d, t)), out: Ent[] = [];
    if (cuts[k] > 0) out.push({ ...base, id: uid(), k: 'line', a: e.a, b: at(cuts[k]) });
    if (cuts[k + 1] < 1) out.push({ ...base, id: uid(), k: 'line', a: at(cuts[k + 1]), b: e.b });
    return { ok: true, remove: [e.id], add: out };
  }
  if (e.k === 'circle' || e.k === 'arc') {
    const full = e.k === 'circle', a0 = full ? 0 : e.a0, sw = full ? TAU : sweepOf(e.a0, e.a1);
    const ts = uniq(xs.map((p) => normAng(angOf(e.c, p) - a0))).filter((t) => (full ? true : t > 1e-6 && t < sw - 1e-6));
    if (full ? ts.length < 2 : !ts.length) return fail(full ? 'A circle needs at least two crossing points to be trimmed.' : 'Nothing crosses this arc.');
    const tp = normAng(angOf(e.c, pick) - a0);
    if (full) {
      let k = ts.findIndex((t, i) => tp >= t && tp < (ts[i + 1] ?? TAU + ts[0]));
      if (k < 0) k = ts.length - 1;
      const keepFrom = ts[(k + 1) % ts.length], keepTo = ts[k];
      return { ok: true, remove: [e.id], add: [{ ...base, id: uid(), k: 'arc', c: e.c, r: e.r, a0: a0 + keepFrom, a1: a0 + keepTo }] };
    }
    const cuts = [0, ...ts, sw]; let k = 0; while (k < cuts.length - 2 && tp > cuts[k + 1]) k++;
    const out: Ent[] = [];
    if (cuts[k] > 0) out.push({ ...base, id: uid(), k: 'arc', c: e.c, r: e.r, a0, a1: a0 + cuts[k] });
    if (cuts[k + 1] < sw) out.push({ ...base, id: uid(), k: 'arc', c: e.c, r: e.r, a0: a0 + cuts[k + 1], a1: a0 + sw });
    return { ok: true, remove: [e.id], add: out };
  }
  if (e.k === 'poly') return fail('Polylines are trimmed piece by piece: use Explode first, then Trim.');
  return fail('Trim works on lines, arcs and circles.');
}

/* ---------- extend ---------- */
/** Extends the end of a line nearest to `pick` until it meets the nearest other curve. */
export function extendLine(e: EntOf<'line'>, pick: Pt, others: Ent[]): EditResult {
  const fromB = dist(pick, e.b) <= dist(pick, e.a);
  const s = fromB ? e.a : e.b, f = fromB ? e.b : e.a, dir = norm(sub(f, s)), far = add(f, mul(dir, 1e6));
  let best: Pt | null = null, bd = Infinity;
  const ray: Ent = { ...e, id: '__ray', a: f, b: far };
  for (const p of crossings(ray, others.filter((o) => o.id !== e.id))) { const dd = dist(p, f); if (dd > 1e-6 && dd < bd) { bd = dd; best = p; } }
  if (!best) return fail('Nothing lies ahead of this end of the line.');
  return { ok: true, remove: [e.id], add: [{ ...e, id: uid(), ...(fromB ? { b: best } : { a: best }) }] };
}

/* ---------- fillet / chamfer ---------- */
function cornerOf(l1: [Pt, Pt], l2: [Pt, Pt]): { x: Pt; u1: Pt; u2: Pt; far1: Pt; far2: Pt } | null {
  const x = intersectLines(l1[0], l1[1], l2[0], l2[1]); if (!x) return null;
  const far1 = dist(l1[0], x) > dist(l1[1], x) ? l1[0] : l1[1], far2 = dist(l2[0], x) > dist(l2[1], x) ? l2[0] : l2[1];
  return { x, far1, far2, u1: norm(sub(far1, x)), u2: norm(sub(far2, x)) };
}
/** Rounds the corner between two lines with radius r: both lines are shortened and an arc is added. */
export function filletLines(e1: EntOf<'line'>, e2: EntOf<'line'>, r: number): EditResult {
  if (!(r > 0)) return fail('Enter a fillet radius above 0.');
  const c = cornerOf([e1.a, e1.b], [e2.a, e2.b]); if (!c) return fail('The two lines are parallel; they have no corner.');
  const th = Math.acos(Math.max(-1, Math.min(1, dot(c.u1, c.u2)))); if (th < 1e-6 || th > Math.PI - 1e-6) return fail('The lines are in line with each other.');
  const t = r / Math.tan(th / 2);
  if (t > dist(c.x, c.far1) + 1e-9 || t > dist(c.x, c.far2) + 1e-9) return fail(`Radius ${r} mm is too large for these lines (it needs ${+t.toFixed(3)} mm of each line).`);
  const p1 = add(c.x, mul(c.u1, t)), p2 = add(c.x, mul(c.u2, t)), bis = norm(add(c.u1, c.u2)), cen = add(c.x, mul(bis, r / Math.sin(th / 2)));
  let a0 = angOf(cen, p1), a1 = angOf(cen, p2); if (sweepOf(a0, a1) > Math.PI) [a0, a1] = [a1, a0];
  return { ok: true, remove: [e1.id, e2.id], add: [
    { ...e1, id: uid(), a: c.far1, b: p1 }, { ...e2, id: uid(), a: p2, b: c.far2 }, { ...copyBase(e1), id: uid(), k: 'arc', c: cen, r, a0, a1 },
  ] };
}
export function chamferLines(e1: EntOf<'line'>, e2: EntOf<'line'>, d1: number, d2 = d1): EditResult {
  if (!(d1 > 0) || !(d2 > 0)) return fail('Enter a chamfer distance above 0.');
  const c = cornerOf([e1.a, e1.b], [e2.a, e2.b]); if (!c) return fail('The two lines are parallel; they have no corner.');
  if (d1 > dist(c.x, c.far1) || d2 > dist(c.x, c.far2)) return fail('The chamfer is longer than the lines.');
  const p1 = add(c.x, mul(c.u1, d1)), p2 = add(c.x, mul(c.u2, d2));
  return { ok: true, remove: [e1.id, e2.id], add: [{ ...e1, id: uid(), a: c.far1, b: p1 }, { ...e2, id: uid(), a: p2, b: c.far2 }, { ...copyBase(e1), id: uid(), k: 'line', a: p1, b: p2 }] };
}
/** Rounds (r > 0, mode 'fillet') or bevels ('chamfer') one corner of a polyline; i = vertex index. Fillets become arc (bulge) segments. */
export function cornerPoly(e: EntOf<'poly'>, i: number, r: number, mode: 'fillet' | 'chamfer'): EditResult {
  const n = e.pts.length;
  if (!e.closed && (i <= 0 || i >= n - 1)) return fail('An open polyline has no corner at its ends.');
  if (!(r > 0)) return fail(`Enter a ${mode} size above 0.`);
  const prev = e.pts[(i - 1 + n) % n], p = e.pts[i], next = e.pts[(i + 1) % n];
  if ((e.bulge?.[(i - 1 + n) % n] ?? 0) !== 0 || (e.bulge?.[i] ?? 0) !== 0) return fail('This corner touches a curved segment; only corners between straight segments can be changed.');
  const u1 = norm(sub(prev, p)), u2 = norm(sub(next, p)), th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (th < 1e-6 || th > Math.PI - 1e-6) return fail('There is no corner at this point.');
  const t = mode === 'fillet' ? r / Math.tan(th / 2) : r;
  if (t > dist(p, prev) + 1e-9 || t > dist(p, next) + 1e-9) return fail(`${mode === 'fillet' ? 'Radius' : 'Chamfer'} ${r} mm is too large for this corner (needs ${+t.toFixed(3)} mm of each side).`);
  const a = add(p, mul(u1, t)), b = add(p, mul(u2, t));
  const turn = Math.sign(u1[0] * u2[1] - u1[1] * u2[0]) || 1; // >0: path turns right at this corner
  const bul = mode === 'fillet' ? bulgeOf(-turn * (Math.PI - th)) : 0;
  const pts = [...e.pts.slice(0, i), a, b, ...e.pts.slice(i + 1)];
  const old = e.bulge ?? new Array<number>(n).fill(0);
  const bulge = [...old.slice(0, i), bul, ...old.slice(i)];
  return { ok: true, remove: [e.id], add: [{ ...e, id: uid(), pts, bulge: bulge.slice(0, pts.length) }] };
}

/* ---------- explode / join ---------- */
export function explodePoly(e: EntOf<'poly'>): EditResult {
  const n = e.pts.length, base = copyBase(e), out: Ent[] = [];
  for (let i = 0; i < (e.closed ? n : n - 1); i++) {
    const p = e.pts[i], q = e.pts[(i + 1) % n], arc = bulgeArc(p, q, e.bulge?.[i] ?? 0);
    if (arc) { const a1 = arc.a0 + arc.sweep; out.push({ ...base, id: uid(), k: 'arc', c: arc.c, r: arc.r, a0: arc.sweep > 0 ? arc.a0 : a1, a1: arc.sweep > 0 ? a1 : arc.a0 }); }
    else if (dist(p, q) > 1e-9) out.push({ ...base, id: uid(), k: 'line', a: p, b: q });
  }
  return { ok: true, remove: [e.id], add: out };
}
/** Joins lines and arcs that meet end to end into one polyline (closed if the chain closes). */
export function joinChain(items: Ent[], tol = 1e-3): EditResult {
  type Seg = { a: Pt; b: Pt; bulge: number; id: string };
  const segs: Seg[] = [];
  for (const e of items) {
    if (e.k === 'line') segs.push({ a: e.a, b: e.b, bulge: 0, id: e.id });
    else if (e.k === 'arc') { const sw = sweepOf(e.a0, e.a1); segs.push({ a: polarPt(e.c, e.r, e.a0), b: polarPt(e.c, e.r, e.a1), bulge: bulgeOf(sw), id: e.id }); }
    else if (e.k === 'poly' && !e.closed) for (let i = 0; i + 1 < e.pts.length; i++) segs.push({ a: e.pts[i], b: e.pts[i + 1], bulge: e.bulge?.[i] ?? 0, id: e.id });
    else return fail('Only lines, arcs and open polylines can be joined.');
  }
  if (!segs.length) return fail('Select the lines and arcs to join.');
  const chain: Seg[] = [segs.shift()!];
  let grew = true;
  while (segs.length && grew) {
    grew = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], head = chain[0].a, tail = chain[chain.length - 1].b;
      const rev = (x: Seg): Seg => ({ a: x.b, b: x.a, bulge: -x.bulge, id: x.id });
      if (dist(s.a, tail) < tol) chain.push(s); else if (dist(s.b, tail) < tol) chain.push(rev(s));
      else if (dist(s.b, head) < tol) chain.unshift(s); else if (dist(s.a, head) < tol) chain.unshift(rev(s)); else continue;
      segs.splice(i, 1); grew = true; break;
    }
  }
  if (segs.length) return fail(`${segs.length} of the selected pieces do not connect end to end with the others (gap larger than ${tol} mm).`);
  const closed = chain.length > 1 && dist(chain[0].a, chain[chain.length - 1].b) < tol;
  const pts = chain.map((s) => s.a); if (!closed) pts.push(chain[chain.length - 1].b);
  const bulge = chain.map((s) => s.bulge);
  const f = items[0];
  return { ok: true, remove: [...new Set(items.map((e) => e.id))], add: [{ ...copyBase(f), id: uid(), k: 'poly', pts, closed, ...(bulge.some((b) => b !== 0) ? { bulge: closed ? bulge : bulge.slice(0, pts.length) } : {}) }] };
}

/* ---------- copies ---------- */
export function arrayCircular(ents: Ent[], c: Pt, n: number, totalDeg = 360): EditResult {
  if (!Number.isInteger(n) || n < 2 || n > 500) return fail('Number of copies: 2 to 500.');
  const step = Math.abs(totalDeg - 360) < 1e-9 ? 360 / n : totalDeg / (n - 1), out: Ent[] = [];
  for (let k = 1; k < n; k++) for (const e of ents) out.push({ ...transformEnt(e, rotateAff(c, step * k)), id: uid(), feature: undefined });
  return { ok: true, remove: [], add: out };
}
export function arrayLinear(ents: Ent[], n: number, dx: number, dy: number, rows = 1, rdx = 0, rdy = 0): EditResult {
  if (!Number.isInteger(n) || n < 1 || n > 500 || !Number.isInteger(rows) || rows < 1 || rows > 500 || n * rows < 2) return fail('Copies: 1 to 500 per row and column, at least 2 in total.');
  const out: Ent[] = [];
  for (let r = 0; r < rows; r++) for (let k = 0; k < n; k++) { if (!r && !k) continue; for (const e of ents) out.push({ ...transformEnt(e, translateAff(dx * k + rdx * r, dy * k + rdy * r)), id: uid(), feature: undefined }); }
  return { ok: true, remove: [], add: out };
}

/** Freehand stroke: keeps the shape but drops points closer than `tol` to the simplified line (Douglas-Peucker). */
export function simplifyStroke(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!; let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) { const d = segDist(pts[k], pts[i], pts[j]); if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closest point on an entity's curve (used for 'nearest' snapping and for picking polyline corners). */
export function nearestOn(e: Ent, p: Pt): Pt | null {
  if (e.k === 'line') { const d = sub(e.b, e.a), L2 = dot(d, d); const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, e.a), d) / L2)); return add(e.a, mul(d, t)); }
  if (e.k === 'circle') return polarPt(e.c, e.r, angOf(e.c, p));
  if (e.k === 'arc') { const a = angOf(e.c, p); return inArc(a, e.a0, e.a1) ? polarPt(e.c, e.r, a) : null; }
  const pls = e.k === 'poly' ? [polyPts(e, 0.02)] : tess(e, 0.02);
  let best: Pt | null = null, bd = Infinity;
  for (const pl of pls) for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i], b = pl[i + 1], d = sub(b, a), L2 = dot(d, d), t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)), q = add(a, mul(d, t)), dd = dist(q, p); if (dd < bd) { bd = dd; best = q; } }
  return best;
}
export { lineCircle, applyAff };
