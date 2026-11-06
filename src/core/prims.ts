import type { Pt } from './types.ts';
import type { V3 } from './xform.ts';

/** Component geometry as a few exact primitives. The same description feeds 3D meshes, B-rep (STEP) solids,
 *  projected 2D views and assembly envelopes, so every output is consistent. Axis of revolution/extrusion is local Z. */
export type Hole = { c: Pt; r: number } | { poly: Pt[] };
export type Prim =
  | { kind: 'tube'; rIn: number; rOut: number; z0: number; z1: number }
  | { kind: 'prism'; outer: Pt[]; holes: Hole[]; z0: number; z1: number }
  | { kind: 'sphere'; c: V3; r: number };
export interface GeoPart { id: string; name: string; color: string; prims: Prim[]; explode: V3 }

export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Regular hexagon with across-flats s, flats parallel to X (corners on the Y axis). */
export const hexPoly = (s: number): Pt[] => { const R = s / Math.sqrt(3); return Array.from({ length: 6 }, (_, i) => [R * Math.sin((i * Math.PI) / 3), R * Math.cos((i * Math.PI) / 3)] as Pt); };

/** Area, centroid and second moments (about the centroid) of a simple polygon. */
export function polyProps(pts: Pt[]): { A: number; cx: number; cy: number; Ix: number; Iy: number } {
  let a = 0, cx = 0, cy = 0, ix = 0, iy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    ix += (y0 * y0 + y0 * y1 + y1 * y1) * c; iy += (x0 * x0 + x0 * x1 + x1 * x1) * c;
  }
  const A = a / 2, sg = Math.sign(A) || 1;
  const gx = cx / (6 * A), gy = cy / (6 * A);
  return { A: Math.abs(A), cx: gx, cy: gy, Ix: sg * (ix / 12) - Math.abs(A) * gy * gy, Iy: sg * (iy / 12) - Math.abs(A) * gx * gx };
}
