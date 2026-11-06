import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { crossLines } from '../../cad2d/sheet.ts';
import { fmt } from '../../core/util.ts';
import type { GeoPart } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import { material } from '../../data/materials.ts';
import type { BearingDerived } from './calc.ts';

export function bearingViews(c: BearingDerived): DrawView[] {
  const { d, D, B, dm, Dw, riO, roI } = c;
  const front: ModelEnt[] = [
    { t: 'circle', c: [0, 0], r: D / 2, layer: 'outline' }, { t: 'circle', c: [0, 0], r: d / 2, layer: 'outline' },
    { t: 'circle', c: [0, 0], r: roI, layer: 'hidden' }, { t: 'circle', c: [0, 0], r: riO, layer: 'hidden' },
    { t: 'circle', c: [0, 0], r: dm / 2, layer: 'centre' }, ...crossLines([0, 0], D / 2 + 5),
    { t: 'dim', a: [-D / 2, -D / 2], b: [D / 2, -D / 2], off: -10, text: `Ø${fmt(D, 2)}`, edit: c.custom ? { key: 'D', value: D } : undefined },
    { t: 'dim', a: [-d / 2, -D / 2], b: [d / 2, -D / 2], off: -20, text: `Ø${fmt(d, 2)}`, edit: c.custom ? { key: 'd', value: d } : undefined },
  ];
  const sec: ModelEnt[] = [];
  for (const s of [1, -1] as const) {
    sec.push({ t: 'poly', closed: true, layer: 'outline', pts: [[0, s * d / 2], [B, s * d / 2], [B, s * riO], [0, s * riO]] });
    sec.push({ t: 'poly', closed: true, layer: 'outline', pts: [[0, s * roI], [B, s * roI], [B, s * D / 2], [0, s * D / 2]] });
    sec.push({ t: 'circle', c: [B / 2, s * dm / 2], r: Dw / 2, layer: 'outline' });
  }
  sec.push({ t: 'hatch', x0: 0, y0: d / 2, x1: B, y1: riO }, { t: 'hatch', x0: 0, y0: roI, x1: B, y1: D / 2 });
  sec.push({ t: 'hatch', x0: 0, y0: -riO, x1: B, y1: -d / 2 }, { t: 'hatch', x0: 0, y0: -D / 2, x1: B, y1: -roI });
  sec.push({ t: 'line', a: [-6, 0], b: [B + 6, 0], layer: 'centre' });
  sec.push({ t: 'dim', a: [0, -D / 2], b: [B, -D / 2], off: -10, text: `${fmt(B, 2)}`, edit: c.custom ? { key: 'B', value: B } : undefined });
  sec.push({ t: 'dim', a: [0, -d / 2], b: [0, d / 2], off: 12, text: `Ø${fmt(d, 2)}` }, { t: 'dim', a: [0, -D / 2], b: [0, D / 2], off: 24, text: `Ø${fmt(D, 2)}` });
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: sec }, geoView(bearingGeo(c), 'iso')];
}

export function bearingGeo(c: BearingDerived): GeoPart[] {
  const color = material(c.matId)?.color ?? '#999';
  return [
    { id: 'inner', name: 'Inner ring', color, explode: [0, 0, -1], prims: [{ kind: 'tube', rIn: c.d / 2, rOut: c.riO, z0: 0, z1: c.B }] },
    { id: 'outer', name: 'Outer ring', color, explode: [0, 0, 1], prims: [{ kind: 'tube', rIn: c.roI, rOut: c.D / 2, z0: 0, z1: c.B }] },
    { id: 'balls', name: `Balls (x${c.Z})`, color: '#d8dde3', explode: [0, 0, 0], prims: Array.from({ length: c.Z }, (_, i) => ({ kind: 'sphere' as const, c: [(c.dm / 2) * Math.cos((2 * Math.PI * i) / c.Z), (c.dm / 2) * Math.sin((2 * Math.PI * i) / c.Z), c.B / 2] as [number, number, number], r: c.Dw / 2 })) },
  ];
}
