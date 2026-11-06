import type { Pt } from '../../core/types.ts';
import { arcPoints, borePolygon, circlePts, discretize } from '../../core/geom.ts';
import type { GeoPart } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { crossLines } from '../../cad2d/sheet.ts';
import { fmt } from '../../core/util.ts';
import { material } from '../../data/materials.ts';
import type { SprocketDerived } from './calc.ts';

export function sprocketBorePts(c: SprocketDerived): Pt[] {
  return borePolygon(c.bore / 2, c.key ? { b: c.key.b, t2: c.key.t2 } : null);
}

export function sprocketGeo(c: SprocketDerived): GeoPart[] {
  const color = material(c.matId)?.color ?? '#999', bore = sprocketBorePts(c);
  const parts: GeoPart[] = [{ id: 'plate', name: 'Tooth plate', color, explode: [0, 0, -1], prims: [{ kind: 'prism', outer: discretize(c.start, c.path), holes: [{ poly: bore }], z0: 0, z1: c.bf1 }] }];
  if (c.hubLen > 0) parts.push({ id: 'hub', name: 'Hub', color, explode: [0, 0, 1], prims: [{ kind: 'prism', outer: circlePts(c.hubDia / 2), holes: [{ poly: bore }], z0: c.bf1, z1: c.width }] });
  return parts;
}

/** Polyline of the tooth/gap region around gap 0 (for the magnified detail view). */
function detailPolyline(c: SprocketDerived): Pt[] {
  const L = c.path.length, k = L / c.z, pointed = k === 3;
  const starts: Pt[] = []; let cur = c.start;
  for (const s of c.path) { starts.push(cur); cur = s.to; }
  const idx = pointed ? [L - 1, 0, 1, k - 1] : [L - 2, L - 1, 0, 1, 2, k - 1];
  const pts: Pt[] = [starts[idx[0]]];
  for (const i of idx) {
    const s = c.path[i];
    if (s.t === 'L') pts.push(s.to); else pts.push(...arcPoints(starts[i], s.mid, s.to));
  }
  return pts;
}

export function sprocketViews(c: SprocketDerived): DrawView[] {
  const R = c.da / 2, hub = c.hubLen > 0;
  const front: ModelEnt[] = [
    { t: 'poly', pts: discretize(c.start, c.path), closed: true, layer: 'outline' },
    { t: 'circle', c: [0, 0], r: c.d / 2, layer: 'centre' },
    { t: 'circle', c: [0, 0], r: c.df / 2, layer: 'hidden' },
    { t: 'poly', pts: sprocketBorePts(c), closed: true, layer: 'outline' },
    ...crossLines([0, 0], R + 6),
    { t: 'dim', a: [-R, -R], b: [R, -R], off: -10, text: `Ø${fmt(c.da, 2)} (tip)` },
    { t: 'dim', a: [-c.d / 2, -R], b: [c.d / 2, -R], off: -20, text: `Ø${fmt(c.d, 2)} (pitch)` },
  ];
  if (hub) front.push({ t: 'circle', c: [0, 0], r: c.hubDia / 2, layer: 'hidden' });
  const W = c.width, b = c.bore / 2, hr = c.hubDia / 2;
  const half = (s: 1 | -1): ModelEnt => ({
    t: 'poly', closed: false, layer: 'outline',
    pts: hub ? [[0, s * b], [0, s * R], [c.bf1, s * R], [c.bf1, s * hr], [W, s * hr], [W, s * b]] : [[0, s * b], [0, s * R], [c.bf1, s * R], [c.bf1, s * b]],
  });
  const section: ModelEnt[] = [
    half(1), half(-1),
    { t: 'line', a: [0, b], b: [W, b], layer: 'outline' }, { t: 'line', a: [0, -b], b: [W, -b], layer: 'outline' },
    { t: 'hatch', x0: 0, y0: b, x1: c.bf1, y1: R }, { t: 'hatch', x0: 0, y0: -R, x1: c.bf1, y1: -b },
    { t: 'line', a: [-6, 0], b: [W + 6, 0], layer: 'centre' },
    { t: 'dim', a: [0, -R], b: [W, -R], off: -10, text: `${fmt(W, 2)}` },
    { t: 'dim', a: [0, -R], b: [c.bf1, -R], off: -20, text: `${fmt(c.bf1, 2)}` },
    { t: 'dim', a: [0, -b], b: [0, b], off: 12, text: `Ø${fmt(c.bore, 2)} (bore)`, edit: { key: 'bore', value: c.bore } },
    { t: 'dim', a: [0, -R], b: [0, R], off: 24, text: `Ø${fmt(c.da, 2)}` },
  ];
  if (hub) {
    section.push({ t: 'hatch', x0: c.bf1, y0: b, x1: W, y1: hr }, { t: 'hatch', x0: c.bf1, y0: -hr, x1: W, y1: -b });
    section.push({ t: 'dim', a: [W, -hr], b: [W, hr], off: -12, text: `Ø${fmt(c.hubDia, 2)} (hub)`, edit: { key: 'hubDia', value: c.hubDia } });
    section.push({ t: 'dim', a: [c.bf1, hr], b: [W, hr], off: 8, text: `${fmt(c.hubLen, 2)}`, edit: { key: 'hubLength', value: c.hubLen } });
  }
  // DETAIL A: magnified roller seat and tooth (3x relative to the other views)
  const K = 3, S = (p: Pt): Pt => [p[0] * K, p[1] * K], pl = detailPolyline(c).map(S), R0 = c.d / 2;
  const ymin = Math.min(...pl.map((p) => p[1])), ymax = Math.max(...pl.map((p) => p[1]));
  const detail: ModelEnt[] = [
    { t: 'poly', pts: pl, closed: false, layer: 'outline' },
    { t: 'circle', c: S([R0, 0]), r: (c.d1 / 2) * K, layer: 'hidden' },
    { t: 'line', a: S([c.df / 2 - 4, 0]), b: S([R + 3, 0]), layer: 'centre' },
    { t: 'dim', a: [R0 * K, -(c.d1 / 2) * K], b: [R0 * K, (c.d1 / 2) * K], off: 24, text: `Ø${fmt(c.d1, 2)} roller` },
    { t: 'dim', a: [(c.df / 2) * K, ymin], b: [R * K, ymin], off: -9, text: `${fmt(R - c.df / 2, 2)} tooth depth` },
    { t: 'text', p: [(c.df / 2) * K, ymax + 6], s: `ri ${fmt(c.ri, 2)}  seat angle ${fmt(c.alphaSeat, 1)}°  re ${fmt(c.re, 1)}`, h: 3, layer: 'text', anchor: 'l' },
  ];
  return [
    { name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: section },
    { name: 'DETAIL A (TOOTH, 3x REL.)', ents: detail }, geoView(sprocketGeo(c), 'iso'),
  ];
}
