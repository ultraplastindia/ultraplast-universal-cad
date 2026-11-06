import type { CalcResult, ParamField, Params } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { hexPoly } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { num, fmt } from '../../core/util.ts';
import { keyFor } from '../../data/keys.ts';
import { material } from '../../data/materials.ts';
import { R, circ, cross, dim, done, ed, failed, rect, validate } from './common.ts';
import { line } from './common.ts';

/* ---------------- Plain washer, ISO 7089 ---------------- */
export const WASHERS: Record<string, [number, number, number]> = { M3: [3.2, 7, 0.5], M4: [4.3, 9, 0.8], M5: [5.3, 10, 1], M6: [6.4, 12, 1.6], M8: [8.4, 16, 1.6], M10: [10.5, 20, 2], M12: [13, 24, 2.5], M16: [17, 30, 3], M20: [21, 37, 3], M24: [25, 44, 4] };
export const WASHER_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6', 'Nylon PA6'];
export const WASHER_FIELDS: ParamField[] = [
  { key: 'size', label: 'Size (ISO 7089, normal series)', kind: 'select', options: [...Object.keys(WASHERS).map((k) => ({ value: k, label: k })), { value: 'CUSTOM', label: 'Custom dimensions' }] },
  { key: 'd1', label: 'Inner diameter d1', unit: 'mm', kind: 'number', min: 1, max: 100, step: 0.1, showIf: (p) => p.size === 'CUSTOM' },
  { key: 'd2', label: 'Outer diameter d2', unit: 'mm', kind: 'number', min: 2, max: 200, step: 0.1, showIf: (p) => p.size === 'CUSTOM' },
  { key: 'h', label: 'Thickness h', unit: 'mm', kind: 'number', min: 0.2, max: 20, step: 0.1, showIf: (p) => p.size === 'CUSTOM' },
  { key: 'material', label: 'Material', kind: 'select', options: WASHER_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const washerDefaults: Params = { size: 'M8', d1: 8.4, d2: 16, h: 1.6, material: 'S235 Steel' };
export interface WasherD { custom: boolean; d1: number; d2: number; h: number; massKg: number; matId: string }
export function calcWasher(p: Params): CalcResult {
  const std = WASHERS[String(p.size)], [d1, d2, h] = std ?? [num(p, 'd1'), num(p, 'd2'), num(p, 'h')], mat = material(String(p.material));
  const inputs = [R('Size', String(p.size)), R('d1', d1, 'mm'), R('d2', d2, 'mm'), R('h', h, 'mm'), R('Material', String(p.material))];
  const standards = ['ISO 7089 (plain washers, normal series)'];
  const errors = validate([['inner diameter', d1, { min: 1 }], ['outer diameter', d2, { min: 2 }], ['thickness', h, { min: 0.2 }]]);
  if (!std && p.size !== 'CUSTOM') errors.push('Unknown size.');
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && d2 < d1 + 2) errors.push('Outer diameter must exceed the inner diameter by at least 2 mm.');
  if (errors.length) return failed(inputs, errors, standards);
  const massKg = (Math.PI / 4) * (d2 * d2 - d1 * d1) * h * mat!.density;
  return done(inputs, [R('Approx. mass', massKg, 'kg', 5), R('Bearing face width (d2 - d1)/2', (d2 - d1) / 2, 'mm')], ['Plain washer without chamfer.'], [], standards, { custom: !std, d1, d2, h, massKg, matId: String(p.material) } satisfies WasherD);
}
export const washerGeo = (c: WasherD): GeoPart[] => [{ id: 'washer', name: 'Washer', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: c.d1 / 2, rOut: c.d2 / 2, z0: 0, z1: c.h }] }];
export function washerViews(c: WasherD): DrawView[] {
  const { d1, d2, h } = c, e = (k: string, v: number) => (c.custom ? ed(k, v) : undefined);
  const front: ModelEnt[] = [circ([0, 0], d2 / 2), circ([0, 0], d1 / 2), ...cross([0, 0], d2 / 2 + 4), dim([-d2 / 2, -d2 / 2], [d2 / 2, -d2 / 2], -8, `Ø${fmt(d2, 2)}`, e('d2', d2)), dim([-d1 / 2, -d2 / 2], [d1 / 2, -d2 / 2], -18, `Ø${fmt(d1, 2)}`, e('d1', d1))];
  const sec: ModelEnt[] = [rect(0, d1 / 2, h, d2 / 2), rect(0, -d2 / 2, h, -d1 / 2), { t: 'hatch', x0: 0, y0: d1 / 2, x1: h, y1: d2 / 2 }, { t: 'hatch', x0: 0, y0: -d2 / 2, x1: h, y1: -d1 / 2 }, line([-3, 0], [h + 3, 0], 'centre'), dim([0, -d2 / 2], [h, -d2 / 2], -8, `${fmt(h, 2)}`, e('h', h))];
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: sec }, geoView(washerGeo(c), 'iso')];
}

/* ---------------- Hexagon nut, ISO 4032 ---------------- */
export const NUTS: Record<string, [number, number]> = { M5: [8, 4.7], M6: [10, 5.2], M8: [13, 6.8], M10: [16, 8.4], M12: [18, 10.8], M16: [24, 14.8], M20: [30, 18], M24: [36, 21.5] };
export const NUT_MATERIALS = ['C45 Steel', 'SS 304', 'Brass CuZn39Pb3'];
export const NUT_FIELDS: ParamField[] = [
  { key: 'size', label: 'Thread size (ISO 4032, style 1)', kind: 'select', options: [...Object.keys(NUTS).map((k) => ({ value: k, label: k })), { value: 'CUSTOM', label: 'Custom dimensions' }] },
  { key: 'dia', label: 'Nominal thread diameter d', unit: 'mm', kind: 'number', min: 2, max: 64, step: 0.5, showIf: (p) => p.size === 'CUSTOM' },
  { key: 's', label: 'Width across flats s', unit: 'mm', kind: 'number', min: 4, max: 100, step: 0.5, showIf: (p) => p.size === 'CUSTOM' },
  { key: 'm', label: 'Nut height m', unit: 'mm', kind: 'number', min: 2, max: 60, step: 0.1, showIf: (p) => p.size === 'CUSTOM' },
  { key: 'material', label: 'Material', kind: 'select', options: NUT_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const nutDefaults: Params = { size: 'M10', dia: 10, s: 16, m: 8.4, material: 'C45 Steel' };
export interface NutD { custom: boolean; d: number; s: number; m: number; e: number; massKg: number; matId: string }
export function calcNut(p: Params): CalcResult {
  const std = NUTS[String(p.size)], d = std ? Number(String(p.size).slice(1)) : num(p, 'dia'), [s, m] = std ?? [num(p, 's'), num(p, 'm')], mat = material(String(p.material));
  const inputs = [R('Size', String(p.size)), R('Thread diameter d', d, 'mm'), R('Across flats s', s, 'mm'), R('Height m', m, 'mm'), R('Material', String(p.material))];
  const standards = ['ISO 4032 (hexagon nuts, style 1)', 'ISO 272 (widths across flats)'];
  const errors = validate([['thread diameter', d, { min: 2 }], ['across flats', s, { min: 4 }], ['height', m, { min: 2 }]]);
  if (!std && p.size !== 'CUSTOM') errors.push('Unknown size.');
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && s <= d * 1.2) errors.push('Width across flats must be clearly larger than the thread diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const e = s / Math.cos(Math.PI / 6), area = (3 * Math.sqrt(3) / 2) * (s / Math.sqrt(3)) ** 2 - (Math.PI / 4) * d * d;
  const massKg = area * m * mat!.density;
  return done(inputs, [R('Width across corners e = s / cos30', e, 'mm', 2), R('Approx. mass', massKg, 'kg', 5)], ['Thread is NOT modelled: the hole is the nominal diameter. No chamfers.'], [], standards, { custom: !std, d, s, m, e, massKg, matId: String(p.material) } satisfies NutD);
}
export const nutGeo = (c: NutD): GeoPart[] => [{ id: 'nut', name: 'Hex nut', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: hexPoly(c.s), holes: [{ c: [0, 0], r: c.d / 2 }], z0: 0, z1: c.m }] }];
export function nutViews(c: NutD): DrawView[] {
  const { s, m, e, d } = c, ex = (k: string, v: number) => (c.custom ? ed(k, v) : undefined);
  const hex = hexPoly(s);
  const top: ModelEnt[] = [{ t: 'poly', pts: hex, closed: true, layer: 'outline' }, circ([0, 0], d / 2), ...cross([0, 0], e / 2 + 4), dim([-s / 2, -e / 2], [s / 2, -e / 2], -8, `s ${fmt(s, 2)}`, ex('s', s)), dim([0, -d / 2], [0, d / 2], 8 + e / 2, `Ø${fmt(d, 2)} (nominal)`)];
  const side: ModelEnt[] = [rect(-e / 2, 0, e / 2, m), dim([-e / 2, 0], [-e / 2, m], 8, `m ${fmt(m, 2)}`, ex('m', m)), line([0, -3], [0, m + 3], 'centre')];
  return [{ name: 'TOP VIEW', ents: top }, { name: 'SIDE VIEW', ents: side }, geoView(nutGeo(c), 'iso')];
}

/* ---------------- Parallel key, DIN 6885-1 form B ---------------- */
export const KEY_MATERIALS = ['C45 Steel', 'SS 304'];
export const KEY_FIELDS: ParamField[] = [
  { key: 'shaftDia', label: 'Shaft diameter', unit: 'mm', kind: 'number', min: 7, max: 95, step: 0.5, help: 'Selects the key cross-section (DIN 6885-1)' },
  { key: 'length', label: 'Key length L', unit: 'mm', kind: 'number', min: 6, max: 400, step: 1 },
  { key: 'torque', label: 'Transmitted torque (optional)', unit: 'N·m', kind: 'number', min: 0, max: 100000, step: 1 },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'torque') > 0 },
  { key: 'material', label: 'Key material', kind: 'select', options: KEY_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const keyDefaults: Params = { shaftDia: 25, length: 32, torque: 0, sf: 2, material: 'C45 Steel' };
export interface KeyD { d: number; b: number; h: number; t1: number; t2: number; L: number; massKg: number; matId: string }
export function calcKey(p: Params): CalcResult {
  const d = num(p, 'shaftDia'), L = num(p, 'length'), T = num(p, 'torque') || 0, sf = num(p, 'sf') || 2, mat = material(String(p.material));
  const inputs = [R('Shaft diameter', d, 'mm'), R('Key length', L, 'mm'), R('Torque', T, 'N·m'), R('Material', String(p.material))];
  const standards = ['DIN 6885-1 / ISO 773 (parallel keys, form B)'];
  const errors = validate([['shaft diameter', d, { min: 7, max: 95 }], ['length', L, { min: 6 }]]);
  if (!mat) errors.push('Unknown material.');
  const k = Number.isFinite(d) ? keyFor(d) : null;
  if (!errors.length && !k) errors.push('No standard key for this shaft diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const warnings: string[] = [], calc = [R('Key cross-section b x h', `${k!.b} x ${k!.h}`, 'mm'), R('Shaft keyway depth t1', k!.t1, 'mm'), R('Hub keyway depth t2', k!.t2, 'mm')];
  if (L < 0.8 * d) warnings.push('Key is shorter than 0.8 x shaft diameter; check the hub length and load capacity.');
  if (L > 2 * d) warnings.push('Key is longer than 2 x shaft diameter; load sharing along the key becomes uneven.');
  const massKg = k!.b * k!.h * L * mat!.density;
  calc.push(R('Approx. mass', massKg, 'kg', 5));
  if (T > 0 && mat!.yieldMPa) {
    const Fm = (2 * T * 1000) / d, tau = Fm / (k!.b * L), pr = Fm / ((k!.h - k!.t1) * L), tauA = (0.577 * mat!.yieldMPa) / sf, pA = mat!.yieldMPa / sf;
    calc.push(R('Shear stress 2T/(d b L)', tau, 'MPa', 1), R('Allowable shear', tauA, 'MPa', 1), R('Contact pressure 2T/(d (h - t1) L)', pr, 'MPa', 1), R('Allowable pressure', pA, 'MPa', 1));
    if (tau > tauA) warnings.push('Key FAILS the preliminary shear check.');
    if (pr > pA) warnings.push('Key FAILS the preliminary contact-pressure check (hub/shaft may be weaker than the key).');
  }
  return done(inputs, calc, ['Form B (square ends). One key carries the full torque with uniform load; yield strengths are typical values.'], warnings, standards, { d, b: k!.b, h: k!.h, t1: k!.t1, t2: k!.t2, L, massKg, matId: String(p.material) } satisfies KeyD);
}
export const keyGeo = (c: KeyD): GeoPart[] => [{ id: 'key', name: 'Parallel key', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: [[0, -c.b / 2], [c.L, -c.b / 2], [c.L, c.b / 2], [0, c.b / 2]], holes: [], z0: 0, z1: c.h }] }];
export function keyViews(c: KeyD): DrawView[] {
  const { L, b, h } = c;
  return [
    { name: 'TOP VIEW', ents: [rect(0, -b / 2, L, b / 2), dim([0, -b / 2], [L, -b / 2], -8, `${fmt(L, 2)}`, ed('length', L)), dim([L, -b / 2], [L, b / 2], -8, `b ${fmt(b, 2)}`)] },
    { name: 'SIDE VIEW', ents: [rect(0, 0, L, h), dim([L, 0], [L, h], -8, `h ${fmt(h, 2)}`)] },
    geoView(keyGeo(c), 'iso'),
  ];
}
