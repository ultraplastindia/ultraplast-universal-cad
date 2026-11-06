import type { ShaftDerived } from './calc.ts';

export function shaftSolid(R: any, c: ShaftDerived): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const s of c.sections) {
    const cyl = R.makeCylinder(s.d / 2, s.l, [0, 0, s.x0], [0, 0, 1]);
    body = body ? body.fuse(cyl) : cyl;
  }
  return body;
}
