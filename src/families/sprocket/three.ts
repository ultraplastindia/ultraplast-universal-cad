import type { SprocketDerived } from './calc.ts';

/** B-rep solid for STEP export: true arcs for roller seats, true circles for hub and bore. */
export function sprocketSolid(R: any, c: SprocketDerived): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  let d = R.draw(c.start);
  for (const s of c.path.slice(0, -1)) d = s.t === 'L' ? d.lineTo(s.to) : d.threePointsArcTo(s.to, s.mid);
  const last = c.path[c.path.length - 1];
  d = last.t === 'A' ? d.threePointsArcTo(c.start, last.mid) : d;
  let body = d.close().sketchOnPlane('XY').extrude(c.bf1);
  if (c.hubLen > 0) body = body.fuse(R.drawCircle(c.hubDia / 2).sketchOnPlane('XY', c.bf1).extrude(c.hubLen));
  body = body.cut(R.drawCircle(c.bore / 2).sketchOnPlane('XY', -1).extrude(c.width + 2));
  if (c.key) body = body.cut(R.makeBaseBox(c.key.b, c.bore / 2 + c.key.t2, c.width + 2).translate(-c.key.b / 2, 0, -1));
  return body;
}
