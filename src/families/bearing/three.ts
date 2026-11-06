import type { BearingDerived } from './calc.ts';

export function bearingSolid(R: any, c: BearingDerived): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const mk = (ri: number, ro: number) => R.makeCylinder(ro, c.B, [0, 0, 0], [0, 0, 1]).cut(R.makeCylinder(ri, c.B + 2, [0, 0, -1], [0, 0, 1]));
  let body = mk(c.d / 2, c.riO).fuse(mk(c.roI, c.D / 2));
  for (let i = 0; i < c.Z; i++) {
    const a = (2 * Math.PI * i) / c.Z;
    body = body.fuse(R.makeSphere(c.Dw / 2).translate((c.dm / 2) * Math.cos(a), (c.dm / 2) * Math.sin(a), c.B / 2));
  }
  return body;
}
