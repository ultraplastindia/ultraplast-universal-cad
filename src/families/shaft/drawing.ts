import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { crossLines } from '../../cad2d/sheet.ts';
import { fmt } from '../../core/util.ts';
import type { GeoPart } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import { material } from '../../data/materials.ts';
import type { ShaftDerived } from './calc.ts';

export function shaftViews(c: ShaftDerived): DrawView[] {
  const S = c.sections, top: [number, number][] = [], bot: [number, number][] = [];
  S.forEach((s) => { top.push([s.x0, s.d / 2], [s.x0 + s.l, s.d / 2]); bot.push([s.x0, -s.d / 2], [s.x0 + s.l, -s.d / 2]); });
  const dMax = Math.max(...S.map((s) => s.d));
  const side: ModelEnt[] = [
    { t: 'poly', closed: true, layer: 'outline', pts: [...top, ...bot.reverse()] },
    { t: 'line', a: [-8, 0], b: [c.total + 8, 0], layer: 'centre' },
    { t: 'dim', a: [0, -dMax / 2], b: [c.total, -dMax / 2], off: -22, text: `${fmt(c.total, 2)}` },
    { t: 'dim', a: [0, -S[0].d / 2], b: [0, S[0].d / 2], off: 12, text: `Ø${fmt(S[0].d, 2)}`, edit: { key: `d${S[0].idx}`, value: S[0].d } },
  ];
  S.forEach((s) => {
    if (s.x0 > 0) side.push({ t: 'line', a: [s.x0, -s.d / 2], b: [s.x0, s.d / 2], layer: 'outline' });
    side.push({ t: 'dim', a: [s.x0, -dMax / 2], b: [s.x0 + s.l, -dMax / 2], off: -10, text: `${fmt(s.l, 2)}`, edit: { key: `l${s.idx}`, value: s.l } });
    side.push({ t: 'text', p: [s.x0 + s.l / 2, dMax / 2 + 3], s: `Ø${fmt(s.d, 2)}`, h: 3.2, layer: 'dim', anchor: 'c', edit: { key: `d${s.idx}`, value: s.d } });
  });
  const end: ModelEnt[] = [...new Set(S.map((s) => s.d))].map((d) => ({ t: 'circle', c: [0, 0], r: d / 2, layer: 'outline' }) as ModelEnt);
  end.push(...crossLines([0, 0], dMax / 2 + 5));
  return [{ name: 'SIDE ELEVATION', ents: side }, { name: 'END VIEW', ents: end }, geoView(shaftGeo(c), 'iso')];
}

export function shaftGeo(c: ShaftDerived): GeoPart[] {
  return [{ id: 'shaft', name: 'Shaft', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: c.sections.map((s) => ({ kind: 'tube' as const, rIn: 0, rOut: s.d / 2, z0: s.x0, z1: s.x0 + s.l })) }];
}
