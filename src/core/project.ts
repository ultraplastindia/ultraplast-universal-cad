import type { Pt } from './types.ts';
import { circleSegments } from './geom.ts';
import type { GeoPart, Prim } from './prims.ts';
import type { M3, V3 } from './xform.ts';
import { add, apply, dot, IDENT, norm } from './xform.ts';
import type { DrawView, ModelEnt } from '../cad2d/sheet.ts';

export interface Basis { right: V3; up: V3; dir: V3 }
export type ViewId = 'front' | 'top' | 'right' | 'iso';
const s2 = Math.SQRT1_2;
export const BASES: Record<ViewId, Basis> = {
  front: { right: [1, 0, 0], up: [0, 0, 1], dir: [0, 1, 0] },
  top: { right: [1, 0, 0], up: [0, 1, 0], dir: [0, 0, -1] },
  right: { right: [0, 1, 0], up: [0, 0, 1], dir: [-1, 0, 0] },
  iso: { right: [-s2, s2, 0], up: norm([-1, -1, 2]), dir: norm([-1, -1, -1]) },
};
export const VIEW_NAMES: Record<ViewId, string> = { front: 'FRONT', top: 'TOP', right: 'SIDE', iso: 'ISOMETRIC (EDGES ONLY)' };

interface Ctx { M: M3; pos: V3; b: Basis; off: V3 }
const P = (c: Ctx, p: V3): Pt => { const w = add(add(apply(c.M, p), c.pos), c.off); return [dot(w, c.b.right), dot(w, c.b.up)]; };
const poly = (pts: Pt[], closed: boolean): ModelEnt => ({ t: 'poly', pts, closed, layer: 'outline' });

function circle(c: Ctx, cx: number, cy: number, z: number, r: number, n = circleSegments(r, 0.003, 56)): Pt[] {
  return Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return P(c, [cx + r * Math.cos(a), cy + r * Math.sin(a), z]); });
}

function projectPrim(p: Prim, c: Ctx, out: ModelEnt[]): void {
  if (p.kind === 'sphere') {
    const q = P(c, p.c);
    out.push({ t: 'circle', c: q, r: p.r, layer: 'outline' });
  } else if (p.kind === 'tube') {
    for (const z of [p.z0, p.z1]) { out.push(poly(circle(c, 0, 0, z, p.rOut), true)); if (p.rIn > 1e-9) out.push(poly(circle(c, 0, 0, z, p.rIn), true)); }
    const u = apply(c.M, [1, 0, 0]), v = apply(c.M, [0, 1, 0]), A = dot(c.b.dir, u), B = dot(c.b.dir, v);
    if (A * A + B * B > 1e-9) {
      const th = Math.atan2(A, -B);
      for (const t of [th, th + Math.PI]) out.push({ t: 'line', a: P(c, [p.rOut * Math.cos(t), p.rOut * Math.sin(t), p.z0]), b: P(c, [p.rOut * Math.cos(t), p.rOut * Math.sin(t), p.z1]), layer: 'outline' });
    }
  } else {
    for (const z of [p.z0, p.z1]) {
      out.push(poly(p.outer.map((q) => P(c, [q[0], q[1], z])), true));
      for (const h of p.holes) out.push(poly('poly' in h ? h.poly.map((q) => P(c, [q[0], q[1], z])) : circle(c, h.c[0], h.c[1], z, h.r), true));
    }
    if (p.outer.length <= 16) for (const q of p.outer) out.push({ t: 'line', a: P(c, [q[0], q[1], p.z0]), b: P(c, [q[0], q[1], p.z1]), layer: 'outline' });
  }
}

/** Orthographic projection of the exact primitives (edges only; hidden lines are NOT removed). */
export function projectGeo(parts: GeoPart[], id: ViewId, M: M3 = IDENT, pos: V3 = [0, 0, 0], offsets: V3[] = []): ModelEnt[] {
  const out: ModelEnt[] = [];
  parts.forEach((g, i) => { const c: Ctx = { M, pos, b: BASES[id], off: offsets[i] ?? [0, 0, 0] }; g.prims.forEach((p) => projectPrim(p, c, out)); });
  return out;
}
export const geoView = (parts: GeoPart[], id: ViewId, name?: string): DrawView => ({ name: name ?? VIEW_NAMES[id], ents: projectGeo(parts, id) });
