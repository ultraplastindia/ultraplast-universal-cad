import type { GeoPart, Prim } from './prims.ts';

/** Builds a replicad (OpenCascade) solid from the primitives: true cylinders and spheres, planar prisms. R = replicad module. */
export function primsSolid(R: any, geo: GeoPart[]): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const add = (s: any) => { body = body ? body.fuse(s) : s; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const polyExtrude = (pts: [number, number][], z0: number, h: number) => {
    let d = R.draw(pts[0]);
    for (const p of pts.slice(1)) d = d.lineTo(p);
    return d.close().sketchOnPlane('XY', z0).extrude(h);
  };
  const one = (p: Prim) => {
    if (p.kind === 'tube') {
      const h = p.z1 - p.z0;
      let s = R.makeCylinder(p.rOut, h, [0, 0, p.z0], [0, 0, 1]);
      if (p.rIn > 1e-9) s = s.cut(R.makeCylinder(p.rIn, h + 2, [0, 0, p.z0 - 1], [0, 0, 1]));
      return s;
    }
    if (p.kind === 'sphere') return R.makeSphere(p.r).translate(p.c[0], p.c[1], p.c[2]);
    const h = p.z1 - p.z0;
    let s = polyExtrude(p.outer, p.z0, h);
    for (const hole of p.holes) {
      s = s.cut('poly' in hole ? polyExtrude(hole.poly, p.z0 - 1, h + 2) : R.makeCylinder(hole.r, h + 2, [hole.c[0], hole.c[1], p.z0 - 1], [0, 0, 1]));
    }
    return s;
  };
  for (const g of geo) for (const p of g.prims) add(one(p));
  return body;
}
