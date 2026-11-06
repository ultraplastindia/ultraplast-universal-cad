import type { Ent } from './sheet.ts';

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
/** Approximate text box in sheet mm. */
export function textBox(e: Extract<Ent, { t: 'text' }>): [number, number, number, number] {
  const w = e.s.length * e.h * 0.62, h = e.h;
  if (e.rot === 90) return [e.p[0] - h, e.p[1] - w / 2, e.p[0] + 0.2 * h, e.p[1] + w / 2];
  const x0 = e.anchor === 'c' ? e.p[0] - w / 2 : e.anchor === 'r' ? e.p[0] - w : e.p[0];
  return [x0, e.p[1] - 0.2 * h, x0 + w, e.p[1] + h];
}
export function entDistance(e: Ent, x: number, y: number): number {
  if (e.t === 'line') return segDist(x, y, e.a[0], e.a[1], e.b[0], e.b[1]);
  if (e.t === 'circle') return Math.abs(Math.hypot(x - e.c[0], y - e.c[1]) - e.r);
  if (e.t === 'poly') { let m = Infinity; const n = e.pts.length, k = e.closed ? n : n - 1; for (let i = 0; i < k; i++) { const a = e.pts[i], b = e.pts[(i + 1) % n]; m = Math.min(m, segDist(x, y, a[0], a[1], b[0], b[1])); } return m; }
  const [x0, y0, x1, y1] = textBox(e);
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
}
/** Index of the entity nearest to (x, y) within tol (sheet mm); text with an edit binding wins ties. Returns -1 if none. */
export function pickEntity(ents: Ent[], x: number, y: number, tol = 1.5): number {
  let best = -1, bd = Infinity;
  ents.forEach((e, i) => {
    if (e.layer === 'border' || e.layer === 'hatch') return;
    const d = entDistance(e, x, y) - (e.t === 'text' && e.edit ? 0.6 : 0);
    if (d <= tol && d < bd) { bd = d; best = i; }
  });
  return best;
}
export function describeEnt(e: Ent): string {
  if (e.t === 'line') return `Line (${e.layer}), length ${Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1]).toFixed(2)} mm on sheet`;
  if (e.t === 'circle') return `Circle (${e.layer}), radius ${e.r.toFixed(2)} mm on sheet`;
  if (e.t === 'poly') return `${e.closed ? 'Closed' : 'Open'} polyline (${e.layer}), ${e.pts.length} points`;
  return `Text (${e.layer}): "${e.s}"`;
}
