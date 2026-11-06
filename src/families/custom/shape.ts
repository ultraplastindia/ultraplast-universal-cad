import type { Pt } from '../../core/types.ts';

/** Helpers that read an outline typed as values ("x,y; x,y; ...") and check that it is a usable flat shape.
 *  Pure functions: no browser or 3D library is needed, so they can be unit-tested directly. */

export const MAX_POINTS = 1000;
export interface RoundHole { c: Pt; r: number }

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

export const signedArea = (pts: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
};
export const perimeter = (pts: Pt[]): number => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

/** Reads "x,y; x,y" (separators: semicolon or new line; numbers separated by comma or space). */
export function parsePoints(text: string, what = 'outline'): { pts: Pt[]; error?: string } {
  const pts: Pt[] = [];
  const items = String(text ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const it of items) {
    const n = it.split(/[,\s]+/).filter(Boolean).map(num);
    if (n.length !== 2 || !n.every(Number.isFinite)) return { pts: [], error: `Could not read "${it.slice(0, 30)}" in ${what}. Write each point as x,y (for example 10,20).` };
    pts.push([n[0], n[1]]);
    if (pts.length > MAX_POINTS) return { pts: [], error: `${what} has more than ${MAX_POINTS} points.` };
  }
  // drop repeated points and a closing point equal to the first one
  const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
  if (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-9) clean.pop();
  return { pts: clean };
}

/** Several polygons separated by "|". */
export function parseCutouts(text: string): { polys: Pt[][]; error?: string } {
  const polys: Pt[][] = [];
  const parts = String(text ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const r = parsePoints(parts[i], `cut-out ${i + 1}`);
    if (r.error) return { polys: [], error: r.error };
    polys.push(r.pts);
  }
  return { polys };
}

/** Round holes written as "x,y,diameter; x,y,diameter". */
export function parseRoundHoles(text: string): { holes: RoundHole[]; error?: string } {
  const holes: RoundHole[] = [];
  const items = String(text ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const it of items) {
    const n = it.split(/[,\s]+/).filter(Boolean).map(num);
    if (n.length !== 3 || !n.every(Number.isFinite) || n[2] <= 0) return { holes: [], error: `Could not read round hole "${it.slice(0, 30)}". Write x,y,diameter (for example 10,20,6.5).` };
    holes.push({ c: [n[0], n[1]], r: n[2] / 2 });
  }
  return { holes };
}

const orient = (a: Pt, b: Pt, c: Pt): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSeg = (a: Pt, b: Pt, p: Pt): boolean => Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
export function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b), e = 1e-9;
  if (((o1 > e && o2 < -e) || (o1 < -e && o2 > e)) && ((o3 > e && o4 < -e) || (o3 < -e && o4 > e))) return true;
  return (Math.abs(o1) <= e && onSeg(a, b, c)) || (Math.abs(o2) <= e && onSeg(a, b, d)) || (Math.abs(o3) <= e && onSeg(c, d, a)) || (Math.abs(o4) <= e && onSeg(c, d, b));
}
/** True if the polygon crosses or touches itself (neighbouring edges are allowed to share their end point). */
export function selfIntersects(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsTouch(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export const distToPoly = (p: Pt, poly: Pt[]): number => poly.reduce((m, a, i) => Math.min(m, distToSegment(p, a, poly[(i + 1) % poly.length])), Infinity);

export interface Shape { outline: Pt[]; cutouts: Pt[][]; holes: RoundHole[]; L: number; W: number; area: number; perim: number }

/** Reads and checks the three text inputs. Moves the shape so its lower-left corner is at 0,0 and fixes the point order
 *  (outline anticlockwise, cut-outs clockwise). Returns error messages instead of throwing. */
export function buildShape(outlineText: string, cutoutText: string, holeText: string): { shape?: Shape; errors: string[] } {
  const errors: string[] = [];
  const o = parsePoints(outlineText, 'outline');
  if (o.error) return { errors: [o.error] };
  if (o.pts.length < 3) return { errors: ['The outline needs at least 3 points.'] };
  const c = parseCutouts(cutoutText); if (c.error) return { errors: [c.error] };
  const h = parseRoundHoles(holeText); if (h.error) return { errors: [h.error] };
  let outline = o.pts;
  const area0 = signedArea(outline);
  if (Math.abs(area0) < 1e-6) return { errors: ['The outline has no area (all points are on one line).'] };
  if (selfIntersects(outline)) return { errors: ['The outline crosses itself. Re-order the points so they follow the edge once around the shape.'] };
  const x0 = Math.min(...outline.map((p) => p[0])), y0 = Math.min(...outline.map((p) => p[1]));
  const sh = (p: Pt): Pt => [p[0] - x0, p[1] - y0];
  outline = outline.map(sh);
  if (signedArea(outline) < 0) outline = [...outline].reverse();
  const cutouts = c.polys.map((poly, i) => {
    if (poly.length < 3) errors.push(`Cut-out ${i + 1} needs at least 3 points.`);
    const s = poly.map(sh);
    return signedArea(s) > 0 ? [...s].reverse() : s;
  });
  const holes = h.holes.map((q) => ({ c: sh(q.c), r: q.r }));
  if (errors.length) return { errors };
  cutouts.forEach((poly, i) => {
    if (Math.abs(signedArea(poly)) < 1e-6) errors.push(`Cut-out ${i + 1} has no area.`);
    else if (selfIntersects(poly)) errors.push(`Cut-out ${i + 1} crosses itself.`);
    else if (!poly.every((p) => pointInPoly(p, outline)) || poly.some((p, k) => outline.some((a, m) => segmentsTouch(p, poly[(k + 1) % poly.length], a, outline[(m + 1) % outline.length])))) errors.push(`Cut-out ${i + 1} must be fully inside the outline and not touch its edge.`);
  });
  if (!errors.length) for (let i = 0; i < cutouts.length; i++) for (let j = i + 1; j < cutouts.length; j++) {
    if (cutouts[i].some((p) => pointInPoly(p, cutouts[j])) || cutouts[j].some((p) => pointInPoly(p, cutouts[i]))) errors.push(`Cut-outs ${i + 1} and ${j + 1} overlap.`);
  }
  holes.forEach((q, i) => {
    if (!pointInPoly(q.c, outline) || distToPoly(q.c, outline) < q.r) errors.push(`Round hole ${i + 1} is not fully inside the outline.`);
    else if (cutouts.some((cp) => pointInPoly(q.c, cp) || distToPoly(q.c, cp) < q.r)) errors.push(`Round hole ${i + 1} overlaps a cut-out.`);
  });
  if (!errors.length) for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
    if (Math.hypot(holes[i].c[0] - holes[j].c[0], holes[i].c[1] - holes[j].c[1]) < holes[i].r + holes[j].r) errors.push(`Round holes ${i + 1} and ${j + 1} overlap.`);
  }
  if (errors.length) return { errors };
  const L = Math.max(...outline.map((p) => p[0])), W = Math.max(...outline.map((p) => p[1]));
  const area = Math.abs(signedArea(outline)) - cutouts.reduce((a, p) => a + Math.abs(signedArea(p)), 0) - holes.reduce((a, q) => a + Math.PI * q.r * q.r, 0);
  return { shape: { outline, cutouts, holes, L, W, area, perim: perimeter(outline) }, errors: [] };
}

const f = (n: number): string => String(+n.toFixed(3));
export const formatPoints = (pts: Pt[]): string => pts.map((p) => `${f(p[0])},${f(p[1])}`).join('; ');
export const formatCutouts = (polys: Pt[][]): string => polys.map(formatPoints).join(' | ');
export const formatHoles = (holes: RoundHole[]): string => holes.map((q) => `${f(q.c[0])},${f(q.c[1])},${f(q.r * 2)}`).join('; ');
