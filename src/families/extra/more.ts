import type { CalcResult, ParamField, Params, Pt } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { hexPoly, polyProps, rectPoly } from '../../core/prims.ts';
import { borePolygon, circlePts } from '../../core/geom.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { fmt, num } from '../../core/util.ts';
import { keyFor } from '../../data/keys.ts';
import { material } from '../../data/materials.ts';
import { R, circ, cross, dim, done, ed, failed, line, rect, validate } from './common.ts';

const col = (id: string) => material(id)?.color ?? '#999';
const mats = (ids: string[]) => ids.map((m) => ({ value: m, label: m }));
const keyDim = (p: Params, bore: number) => (p.keyway ? keyFor(bore) : null);

/* ======================= Hex bolt, ISO 4017 / 4014 ======================= */
export const BOLTS: Record<string, [s: number, k: number]> = { M5: [8, 3.5], M6: [10, 4], M8: [13, 5.3], M10: [16, 6.4], M12: [18, 7.5], M16: [24, 10], M20: [30, 12.5], M24: [36, 15] };
const BOLT_LEN = [10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];
export const BOLT_MATERIALS = ['C45 Steel', 'SS 304', 'Brass CuZn39Pb3'];
export const BOLT_FIELDS: ParamField[] = [
  { key: 'size', label: 'Thread size (ISO 4017)', kind: 'select', options: Object.keys(BOLTS).map((k) => ({ value: k, label: k })) },
  { key: 'length', label: 'Length under head', unit: 'mm', kind: 'number', min: 8, max: 300, step: 1 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(BOLT_MATERIALS) },
];
export const boltDefaults: Params = { size: 'M10', length: 40, material: 'C45 Steel' };
export interface BoltD { d: number; s: number; k: number; e: number; L: number; massKg: number; matId: string }
export function calcBolt(p: Params): CalcResult {
  const std = BOLTS[String(p.size)], L = num(p, 'length'), d = std ? Number(String(p.size).slice(1)) : NaN, mat = material(String(p.material));
  const inputs = [R('Size', String(p.size)), R('Length', L, 'mm'), R('Material', String(p.material))];
  const standards = ['ISO 4017 / ISO 4014 (hexagon head bolts)', 'ISO 272'];
  const errors = validate([['length', L, { min: 8 }]]);
  if (!std) errors.push('Unknown thread size.');
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && L < d) errors.push('Length must be at least the thread diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const [s, k] = std!, e = s / Math.cos(Math.PI / 6), warnings: string[] = [];
  if (!BOLT_LEN.includes(L)) warnings.push('Length is not in the ISO preferred length series.');
  const massKg = ((3 * Math.sqrt(3)) / 2 * (s / Math.sqrt(3)) ** 2 * k + (Math.PI / 4) * d * d * L) * mat!.density;
  return done(inputs, [R('Head width across flats s', s, 'mm'), R('Head height k', k, 'mm'), R('Across corners e', e, 'mm', 2), R('Approx. mass', massKg, 'kg', 4)], ['Thread not modelled: the shank is a plain cylinder of the nominal diameter. No head chamfer or washer face.'], warnings, standards, { d, s, k, e, L, massKg, matId: String(p.material) } satisfies BoltD);
}
export const boltGeo = (c: BoltD): GeoPart[] => [
  { id: 'head', name: 'Head', color: col(c.matId), explode: [0, 0, -1], prims: [{ kind: 'prism', outer: hexPoly(c.s), holes: [], z0: 0, z1: c.k }] },
  { id: 'shank', name: 'Shank', color: col(c.matId), explode: [0, 0, 1], prims: [{ kind: 'tube', rIn: 0, rOut: c.d / 2, z0: c.k, z1: c.k + c.L }] },
];
export function boltViews(c: BoltD): DrawView[] {
  const { d, s, k, e, L } = c;
  const side: ModelEnt[] = [rect(-e / 2, -k, e / 2, 0), rect(-d / 2, -k - L, d / 2, -k), line([0, 4], [0, -k - L - 4], 'centre'), dim([e / 2, -k - L], [e / 2, -k], 10 + 0, `${fmt(L, 2)}`, ed('length', L)), dim([-e / 2, -k], [-e / 2, 0], 8, `k ${fmt(k, 2)}`), dim([-d / 2, -k - L], [d / 2, -k - L], -8, `Ø${fmt(d, 2)}`)];
  const top: ModelEnt[] = [{ t: 'poly', pts: hexPoly(s), closed: true, layer: 'outline' }, circ([0, 0], d / 2, 'hidden'), ...cross([0, 0], e / 2 + 4), dim([-s / 2, -e / 2], [s / 2, -e / 2], -8, `s ${fmt(s, 2)}`)];
  return [{ name: 'SIDE VIEW', ents: side }, { name: 'TOP VIEW', ents: top }, geoView(boltGeo(c), 'iso')];
}

/* ======================= Socket head cap screw, ISO 4762 ======================= */
export const CAPS: Record<string, [dk: number, k: number, s: number, t: number]> = { M3: [5.5, 3, 2.5, 1.3], M4: [7, 4, 3, 2], M5: [8.5, 5, 4, 2.5], M6: [10, 6, 5, 3], M8: [13, 8, 6, 4], M10: [16, 10, 8, 5], M12: [18, 12, 10, 6], M16: [24, 16, 14, 8], M20: [30, 20, 17, 10] };
export const CAP_FIELDS: ParamField[] = [
  { key: 'size', label: 'Thread size (ISO 4762)', kind: 'select', options: Object.keys(CAPS).map((k) => ({ value: k, label: k })) },
  { key: 'length', label: 'Length under head', unit: 'mm', kind: 'number', min: 5, max: 200, step: 1 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(BOLT_MATERIALS) },
];
export const capDefaults: Params = { size: 'M6', length: 20, material: 'C45 Steel' };
export interface CapD { d: number; dk: number; k: number; s: number; t: number; L: number; massKg: number; matId: string }
export function calcCap(p: Params): CalcResult {
  const std = CAPS[String(p.size)], L = num(p, 'length'), d = std ? Number(String(p.size).slice(1)) : NaN, mat = material(String(p.material));
  const inputs = [R('Size', String(p.size)), R('Length', L, 'mm'), R('Material', String(p.material))];
  const standards = ['ISO 4762 (hexagon socket head cap screws)'];
  const errors = validate([['length', L, { min: 5 }]]);
  if (!std) errors.push('Unknown thread size.');
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && L < d) errors.push('Length must be at least the thread diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const [dk, k, s, t] = std!, hexA = ((3 * Math.sqrt(3)) / 2) * (s / Math.sqrt(3)) ** 2;
  const massKg = ((Math.PI / 4) * dk * dk * k - hexA * t + (Math.PI / 4) * d * d * L) * mat!.density;
  return done(inputs, [R('Head diameter dk', dk, 'mm'), R('Head height k', k, 'mm'), R('Socket width s', s, 'mm'), R('Socket depth t (min.)', t, 'mm'), R('Approx. mass', massKg, 'kg', 4)], ['Thread not modelled; head is a plain cylinder with a flat-bottom hexagon socket, no chamfers or knurling.'], BOLT_LEN.includes(L) ? [] : ['Length is not in the ISO preferred length series.'], standards, { d, dk, k, s, t, L, massKg, matId: String(p.material) } satisfies CapD);
}
export const capGeo = (c: CapD): GeoPart[] => [
  { id: 'head', name: 'Head', color: col(c.matId), explode: [0, 0, -1], prims: [{ kind: 'prism', outer: circlePts(c.dk / 2), holes: [{ poly: hexPoly(c.s) }], z0: 0, z1: c.t }, { kind: 'tube', rIn: 0, rOut: c.dk / 2, z0: c.t, z1: c.k }] },
  { id: 'shank', name: 'Shank', color: col(c.matId), explode: [0, 0, 1], prims: [{ kind: 'tube', rIn: 0, rOut: c.d / 2, z0: c.k, z1: c.k + c.L }] },
];
export function capViews(c: CapD): DrawView[] {
  const { d, dk, k, s, t, L } = c, e = s / Math.cos(Math.PI / 6);
  const side: ModelEnt[] = [rect(-dk / 2, -k, dk / 2, 0), rect(-d / 2, -k - L, d / 2, -k), line([-e / 2, 0], [-e / 2, -t], 'hidden'), line([e / 2, 0], [e / 2, -t], 'hidden'), line([-e / 2, -t], [e / 2, -t], 'hidden'), line([0, 4], [0, -k - L - 4], 'centre'),
    dim([dk / 2, -k - L], [dk / 2, -k], 10, `${fmt(L, 2)}`, ed('length', L)), dim([-dk / 2, -k], [-dk / 2, 0], 8, `k ${fmt(k, 2)}`), dim([-d / 2, -k - L], [d / 2, -k - L], -8, `Ø${fmt(d, 2)}`)];
  const top: ModelEnt[] = [circ([0, 0], dk / 2), { t: 'poly', pts: hexPoly(s), closed: true, layer: 'outline' }, ...cross([0, 0], dk / 2 + 4), dim([-dk / 2, -dk / 2], [dk / 2, -dk / 2], -8, `Ø${fmt(dk, 2)}`)];
  return [{ name: 'SIDE VIEW', ents: side }, { name: 'TOP VIEW', ents: top }, geoView(capGeo(c), 'iso')];
}

/* ======================= Dowel pin, ISO 2338 ======================= */
export const DOWEL_FIELDS: ParamField[] = [
  { key: 'dia', label: 'Pin diameter', unit: 'mm', kind: 'number', min: 1, max: 30, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 4, max: 200, step: 1 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(['C45 Steel', 'SS 304', 'Brass CuZn39Pb3']) },
];
export const dowelDefaults: Params = { dia: 6, length: 24, material: 'C45 Steel' };
export interface DowelD { d: number; L: number; massKg: number; matId: string }
export function calcDowel(p: Params): CalcResult {
  const d = num(p, 'dia'), L = num(p, 'length'), mat = material(String(p.material));
  const inputs = [R('Diameter', d, 'mm'), R('Length', L, 'mm'), R('Material', String(p.material))];
  const standards = ['ISO 2338 (parallel pins, tolerance m6 or h8)'];
  const errors = validate([['diameter', d, { min: 1 }], ['length', L, { min: 4 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && L < 1.5 * d) errors.push('Length must be at least 1.5 x the diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const warnings: string[] = [];
  if (L > 10 * d) warnings.push('Length above 10 x diameter: unusual for a dowel pin; check the application.');
  const massKg = (Math.PI / 4) * d * d * L * mat!.density;
  return done(inputs, [R('Approx. mass', massKg, 'kg', 5)], ['Plain cylinder without end chamfers; fit tolerance is not specified.'], warnings, standards, { d, L, massKg, matId: String(p.material) } satisfies DowelD);
}
export const dowelGeo = (c: DowelD): GeoPart[] => [{ id: 'pin', name: 'Dowel pin', color: col(c.matId), explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: 0, rOut: c.d / 2, z0: 0, z1: c.L }] }];
export function dowelViews(c: DowelD): DrawView[] {
  const { d, L } = c;
  return [{ name: 'SIDE VIEW', ents: [rect(0, -d / 2, L, d / 2), line([-4, 0], [L + 4, 0], 'centre'), dim([0, -d / 2], [L, -d / 2], -8, `${fmt(L, 2)}`, ed('length', L)), dim([0, -d / 2], [0, d / 2], 8, `Ø${fmt(d, 2)}`, ed('dia', d))] },
    { name: 'END VIEW', ents: [circ([0, 0], d / 2), ...cross([0, 0], d / 2 + 3)] }, geoView(dowelGeo(c), 'iso')];
}

/* ======================= Belt pulley (drive / tail / idler) ======================= */
export const PULLEY_MATERIALS = ['C45 Steel', 'SS 304', 'Al 6061-T6', 'Nylon PA6', 'Acetal POM'];
export const PULLEY_FIELDS: ParamField[] = [
  { key: 'outerDia', label: 'Pulley outside diameter', unit: 'mm', kind: 'number', min: 30, max: 800, step: 1 },
  { key: 'faceWidth', label: 'Face width', unit: 'mm', kind: 'number', min: 10, max: 800, step: 1 },
  { key: 'bore', label: 'Bore diameter', unit: 'mm', kind: 'number', min: 6, max: 150, step: 0.5 },
  { key: 'keyway', label: 'Keyway (DIN 6885)', kind: 'boolean' },
  { key: 'hubDia', label: 'Hub diameter', unit: 'mm', kind: 'number', min: 0, max: 400, step: 0.5 },
  { key: 'hubLength', label: 'Hub length (beyond face)', unit: 'mm', kind: 'number', min: 0, max: 200, step: 0.5, help: '0 = no hub' },
  { key: 'rpm', label: 'Speed (optional)', unit: 'rpm', kind: 'number', min: 0, max: 5000, step: 1, help: '0 = skip belt speed' },
  { key: 'material', label: 'Material', kind: 'select', options: mats(PULLEY_MATERIALS) },
];
export const pulleyDefaults: Params = { outerDia: 120, faceWidth: 60, bore: 25, keyway: true, hubDia: 46, hubLength: 20, rpm: 0, material: 'C45 Steel' };
export interface PulleyD { D: number; W: number; bore: number; hubDia: number; hubLen: number; key: { b: number; h: number; t2: number } | null; massKg: number; matId: string }
export function calcPulley(p: Params): CalcResult {
  const D = num(p, 'outerDia'), W = num(p, 'faceWidth'), bore = num(p, 'bore'), hubLen = num(p, 'hubLength') || 0, hubDia = hubLen > 0 ? num(p, 'hubDia') : 0, rpm = num(p, 'rpm') || 0, mat = material(String(p.material));
  const inputs = [R('Outside dia', D, 'mm'), R('Face width', W, 'mm'), R('Bore', bore, 'mm'), R('Keyway', p.keyway ? 'Yes' : 'No'), R('Hub dia', hubDia, 'mm'), R('Hub length', hubLen, 'mm'), R('Speed', rpm, 'rpm'), R('Material', String(p.material))];
  const standards = ['DIN 6885-1 / ISO 773 (keyways)'];
  const errors = validate([['outside diameter', D, { min: 30 }], ['face width', W, { min: 10 }], ['bore', bore, { min: 6 }], ['hub length', hubLen, { min: 0 }]]);
  if (!mat) errors.push('Unknown material.');
  const key = Number.isFinite(bore) ? keyDim(p, bore) : null;
  if (!errors.length) {
    if (p.keyway && !key) errors.push('No standard keyway for this bore (supported 6 to 95 mm).');
    if (bore >= D - 20) errors.push('Bore leaves less than 10 mm of rim.');
    if (hubLen > 0 && hubDia <= bore + 4) errors.push('Hub diameter must exceed the bore by at least 4 mm.');
    if (hubLen > 0 && hubDia >= D) errors.push('Hub diameter must be smaller than the pulley diameter.');
  }
  if (errors.length) return failed(inputs, errors, standards);
  const area = (Math.PI / 4) * (D * D - bore * bore), vol = area * W + (hubLen > 0 ? (Math.PI / 4) * (hubDia ** 2 - bore ** 2) * hubLen : 0) - (key ? key.b * key.t2 * (W + hubLen) : 0), massKg = vol * mat!.density;
  const calc = [R('Approx. mass', massKg, 'kg', 3)];
  if (key) calc.push(R('Keyway b x h', `${key.b} x ${key.h}`, 'mm'));
  const warnings: string[] = [];
  if (rpm > 0) { const v = (Math.PI * D * rpm) / 60000; calc.push(R('Belt speed π D n / 60000', v, 'm/s', 2)); if (v > 4) warnings.push('Belt speed above 4 m/s: check balancing and belt data.'); }
  return done(inputs, calc, ['Solid disc (no spokes, lagging or crown). Hub on one side.'], warnings, standards, { D, W, bore, hubDia: hubLen > 0 ? hubDia : bore, hubLen, key: key ? { b: key.b, h: key.h, t2: key.t2 } : null, massKg, matId: String(p.material) } satisfies PulleyD);
}
export function pulleyGeo(c: PulleyD): GeoPart[] {
  const bore = borePolygon(c.bore / 2, c.key ? { b: c.key.b, t2: c.key.t2 } : null), color = col(c.matId);
  const out: GeoPart[] = [{ id: 'rim', name: 'Pulley body', color, explode: [0, 0, -1], prims: [{ kind: 'prism', outer: circlePts(c.D / 2), holes: [{ poly: bore }], z0: 0, z1: c.W }] }];
  if (c.hubLen > 0) out.push({ id: 'hub', name: 'Hub', color, explode: [0, 0, 1], prims: [{ kind: 'prism', outer: circlePts(c.hubDia / 2), holes: [{ poly: bore }], z0: c.W, z1: c.W + c.hubLen }] });
  return out;
}
export function pulleyViews(c: PulleyD): DrawView[] {
  const { D, W, bore, hubDia, hubLen } = c, b = bore / 2, T = W + hubLen, hub = hubLen > 0;
  const front: ModelEnt[] = [circ([0, 0], D / 2), { t: 'poly', pts: borePolygon(b, c.key ? { b: c.key.b, t2: c.key.t2 } : null), closed: true, layer: 'outline' }, ...(hub ? [circ([0, 0], hubDia / 2, 'hidden')] : []), ...cross([0, 0], D / 2 + 5), dim([-D / 2, -D / 2], [D / 2, -D / 2], -8, `Ø${fmt(D, 2)}`, ed('outerDia', D))];
  const half = (s: 1 | -1): ModelEnt => ({ t: 'poly', closed: false, layer: 'outline', pts: hub ? [[0, s * b], [0, s * D / 2], [W, s * D / 2], [W, s * hubDia / 2], [T, s * hubDia / 2], [T, s * b]] : [[0, s * b], [0, s * D / 2], [W, s * D / 2], [W, s * b]] });
  const sec: ModelEnt[] = [half(1), half(-1), line([0, b], [T, b]), line([0, -b], [T, -b]), { t: 'hatch', x0: 0, y0: b, x1: W, y1: D / 2 }, { t: 'hatch', x0: 0, y0: -D / 2, x1: W, y1: -b }, line([-6, 0], [T + 6, 0], 'centre'),
    dim([0, -D / 2], [W, -D / 2], -8, `${fmt(W, 2)}`, ed('faceWidth', W)), dim([0, -b], [0, b], 10, `Ø${fmt(bore, 2)} (bore)`, ed('bore', bore)), dim([0, -D / 2], [0, D / 2], 22, `Ø${fmt(D, 2)}`)];
  if (hub) sec.push({ t: 'hatch', x0: W, y0: b, x1: T, y1: hubDia / 2 }, { t: 'hatch', x0: W, y0: -hubDia / 2, x1: T, y1: -b }, dim([W, hubDia / 2], [T, hubDia / 2], 8, `${fmt(hubLen, 2)}`, ed('hubLength', hubLen)), dim([T, -hubDia / 2], [T, hubDia / 2], -10, `Ø${fmt(hubDia, 2)} (hub)`, ed('hubDia', hubDia)));
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: sec }, geoView(pulleyGeo(c), 'iso')];
}

/* ======================= Guide / wear wheel ======================= */
export const WHEEL_MATERIALS = ['Nylon PA6', 'Acetal POM', 'UHMW-PE', 'C45 Steel', 'SS 304', 'Al 6061-T6'];
export const WHEEL_FIELDS: ParamField[] = [
  { key: 'trackDia', label: 'Track (running) diameter', unit: 'mm', kind: 'number', min: 10, max: 400, step: 0.5 },
  { key: 'trackWidth', label: 'Track width', unit: 'mm', kind: 'number', min: 4, max: 200, step: 0.5 },
  { key: 'bore', label: 'Bore diameter', unit: 'mm', kind: 'number', min: 3, max: 150, step: 0.5 },
  { key: 'flangeDia', label: 'Flange diameter', unit: 'mm', kind: 'number', min: 0, max: 500, step: 0.5, help: '0 = no flanges' },
  { key: 'flangeThk', label: 'Flange thickness (each side)', unit: 'mm', kind: 'number', min: 0, max: 50, step: 0.5, showIf: (p) => num(p, 'flangeDia') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(WHEEL_MATERIALS) },
];
export const wheelDefaults: Params = { trackDia: 60, trackWidth: 20, bore: 12, flangeDia: 75, flangeThk: 5, material: 'Nylon PA6' };
export interface WheelD { D: number; Wt: number; bore: number; fd: number; ft: number; total: number; massKg: number; matId: string }
export function calcWheel(p: Params): CalcResult {
  const D = num(p, 'trackDia'), Wt = num(p, 'trackWidth'), bore = num(p, 'bore'), fd = num(p, 'flangeDia') || 0, ft = fd > 0 ? num(p, 'flangeThk') : 0, mat = material(String(p.material));
  const inputs = [R('Track dia', D, 'mm'), R('Track width', Wt, 'mm'), R('Bore', bore, 'mm'), R('Flange dia', fd, 'mm'), R('Flange thickness', ft, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['track diameter', D, { min: 10 }], ['track width', Wt, { min: 4 }], ['bore', bore, { min: 3 }], ['flange thickness', ft, { min: 0 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length) {
    if (bore >= D - 4) errors.push('Bore leaves less than 2 mm of wall under the track.');
    if (fd > 0 && fd <= D) errors.push('Flange diameter must exceed the track diameter.');
    if (fd > 0 && ft <= 0) errors.push('Flange thickness must be above 0.');
  }
  if (errors.length) return failed(inputs, errors, standards);
  const total = Wt + 2 * ft, vol = (Math.PI / 4) * ((D * D - bore * bore) * Wt + (fd > 0 ? 2 * (fd * fd - bore * bore) * ft : 0)), massKg = vol * mat!.density;
  return done(inputs, [R('Overall width', total, 'mm'), R('Approx. mass', massKg, 'kg', 4)], ['Plain bore; no bearing seat, groove or keyway.'], [], standards, { D, Wt, bore, fd, ft, total, massKg, matId: String(p.material) } satisfies WheelD);
}
export function wheelGeo(c: WheelD): GeoPart[] {
  const color = col(c.matId), prims: GeoPart['prims'] = [{ kind: 'tube', rIn: c.bore / 2, rOut: c.D / 2, z0: c.ft, z1: c.ft + c.Wt }];
  if (c.fd > 0) prims.push({ kind: 'tube', rIn: c.bore / 2, rOut: c.fd / 2, z0: 0, z1: c.ft }, { kind: 'tube', rIn: c.bore / 2, rOut: c.fd / 2, z0: c.ft + c.Wt, z1: c.total });
  return [{ id: 'wheel', name: 'Wheel', color, explode: [0, 0, 0], prims }];
}
export function wheelViews(c: WheelD): DrawView[] {
  const { D, Wt, bore, fd, ft, total } = c, b = bore / 2, Ro = Math.max(D, fd) / 2;
  const front: ModelEnt[] = [circ([0, 0], D / 2), circ([0, 0], b), ...(fd > 0 ? [circ([0, 0], fd / 2)] : []), ...cross([0, 0], Ro + 4), dim([-Ro, -Ro], [Ro, -Ro], -8, `Ø${fmt(Math.max(D, fd), 2)}`), dim([-b, -Ro], [b, -Ro], -18, `Ø${fmt(bore, 2)}`, ed('bore', bore))];
  const prof = (s: 1 | -1): ModelEnt => ({ t: 'poly', closed: true, layer: 'outline', pts: fd > 0 ? [[0, s * b], [0, s * fd / 2], [ft, s * fd / 2], [ft, s * D / 2], [ft + Wt, s * D / 2], [ft + Wt, s * fd / 2], [total, s * fd / 2], [total, s * b]] : [[0, s * b], [0, s * D / 2], [Wt, s * D / 2], [Wt, s * b]] });
  const sec: ModelEnt[] = [prof(1), prof(-1), { t: 'hatch', x0: 0, y0: b, x1: total, y1: D / 2 }, { t: 'hatch', x0: 0, y0: -D / 2, x1: total, y1: -b }, line([-4, 0], [total + 4, 0], 'centre'),
    dim([ft, -Ro], [ft + Wt, -Ro], -8, `${fmt(Wt, 2)}`, ed('trackWidth', Wt)), dim([total, -D / 2], [total, D / 2], -10, `Ø${fmt(D, 2)}`, ed('trackDia', D))];
  if (fd > 0) sec.push({ t: 'hatch', x0: 0, y0: D / 2, x1: ft, y1: fd / 2 }, { t: 'hatch', x0: 0, y0: -fd / 2, x1: ft, y1: -D / 2 }, { t: 'hatch', x0: ft + Wt, y0: D / 2, x1: total, y1: fd / 2 }, { t: 'hatch', x0: ft + Wt, y0: -fd / 2, x1: total, y1: -D / 2 }, dim([0, fd / 2], [ft, fd / 2], 8, `${fmt(ft, 2)}`, ed('flangeThk', ft)));
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: sec }, geoView(wheelGeo(c), 'iso')];
}

/* ======================= U-channel (chain guide, side frame) ======================= */
export const CH_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6'];
export const CHANNEL_FIELDS: ParamField[] = [
  { key: 'height', label: 'Web height H', unit: 'mm', kind: 'number', min: 15, max: 400, step: 0.5 },
  { key: 'flange', label: 'Flange width B', unit: 'mm', kind: 'number', min: 10, max: 200, step: 0.5 },
  { key: 'thickness', label: 'Thickness', unit: 'mm', kind: 'number', min: 1, max: 20, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 8000, step: 1 },
  { key: 'load', label: 'Mid-span point load (optional)', unit: 'N', kind: 'number', min: 0, max: 1000000, step: 10 },
  { key: 'span', label: 'Span between supports', unit: 'mm', kind: 'number', min: 20, max: 8000, step: 1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(CH_MATERIALS) },
];
export const channelDefaults: Params = { height: 80, flange: 40, thickness: 3, length: 1000, load: 0, span: 1000, sf: 1.5, material: 'S235 Steel' };
export interface ChannelD { H: number; B: number; t: number; L: number; A: number; cx: number; cy: number; Ix: number; Iy: number; massKg: number; matId: string; pts: Pt[] }
export function beamChecks(F: number, span: number, sf: number, Ix: number, cmax: number, mat: { E: number | null; yieldMPa: number | null }) {
  const out: { rows: ReturnType<typeof R>[]; warnings: string[] } = { rows: [], warnings: [] };
  if (!(F > 0) || !mat.E) return out;
  const M = (F * span) / 4, sigma = (M * cmax) / Ix, defl = (F * span ** 3) / (48 * mat.E * 1000 * Ix);
  out.rows.push(R('Max bending moment F·span/4', M / 1000, 'N·m', 1), R('Bending stress', sigma, 'MPa', 1), R('Mid-span deflection', defl, 'mm', 2));
  if (mat.yieldMPa && sigma > mat.yieldMPa / sf) out.warnings.push('Section FAILS the preliminary bending-stress check.');
  if (defl > span / 250) out.warnings.push(`Deflection exceeds span/250 (${fmt(span / 250, 2)} mm).`);
  return out;
}
export function calcChannel(p: Params): CalcResult {
  const H = num(p, 'height'), B = num(p, 'flange'), t = num(p, 'thickness'), L = num(p, 'length'), F = num(p, 'load') || 0, span = num(p, 'span') || L, sf = num(p, 'sf') || 1.5, mat = material(String(p.material));
  const inputs = [R('Height H', H, 'mm'), R('Flange B', B, 'mm'), R('Thickness', t, 'mm'), R('Length', L, 'mm'), R('Load', F, 'N'), R('Span', span, 'mm'), R('Material', String(p.material))];
  const standards = ['Section properties by polygon integration', 'Euler-Bernoulli beam theory'];
  const errors = validate([['height', H, { min: 15 }], ['flange width', B, { min: 10 }], ['thickness', t, { min: 1 }], ['length', L, { min: 20 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && (2 * t >= H || t >= B)) errors.push('Thickness is too large for the section size.');
  if (errors.length) return failed(inputs, errors, standards);
  const pts: Pt[] = [[0, 0], [B, 0], [B, t], [t, t], [t, H - t], [B, H - t], [B, H], [0, H]], pr = polyProps(pts), massKg = pr.A * L * mat!.density;
  const bc = beamChecks(F, span, sf, pr.Ix, Math.max(pr.cy, H - pr.cy), mat!);
  return done(inputs, [R('Cross-section area', pr.A, 'mm²', 1), R('Centroid x, y', `${fmt(pr.cx, 2)}, ${fmt(pr.cy, 2)}`, 'mm'), R('Ix (strong axis)', pr.Ix, 'mm⁴', 0), R('Iy', pr.Iy, 'mm⁴', 0), R('Approx. mass', massKg, 'kg', 3), ...bc.rows],
    ['Sharp corners (no root radii). Shear centre, torsion and lateral-torsional buckling are ignored; load assumed through the shear centre.'], bc.warnings, standards, { H, B, t, L, ...pr, massKg, matId: String(p.material), pts } satisfies ChannelD);
}
export const channelGeo = (c: ChannelD): GeoPart[] => [{ id: 'channel', name: 'U-channel', color: col(c.matId), explode: [0, 0, 0], prims: [{ kind: 'prism', outer: c.pts, holes: [], z0: 0, z1: c.L }] }];
export function channelViews(c: ChannelD): DrawView[] {
  const { H, B, t, L } = c;
  return [{ name: 'END VIEW (PROFILE)', ents: [{ t: 'poly', pts: c.pts, closed: true, layer: 'outline' }, dim([0, 0], [B, 0], -8, `B ${fmt(B, 2)}`, ed('flange', B)), dim([0, 0], [0, H], 8, `H ${fmt(H, 2)}`, ed('height', H)), dim([0, H - t], [t, H - t], 8, `t ${fmt(t, 2)}`, ed('thickness', t))] },
    { name: 'SIDE VIEW', ents: [rect(0, 0, L, H), dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`, ed('length', L))] }, geoView(channelGeo(c), 'iso')];
}

/* ======================= Round tube ======================= */
export const TUBE_FIELDS: ParamField[] = [
  { key: 'od', label: 'Outside diameter', unit: 'mm', kind: 'number', min: 8, max: 400, step: 0.5 },
  { key: 'wall', label: 'Wall thickness', unit: 'mm', kind: 'number', min: 0.8, max: 30, step: 0.1 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 12000, step: 1 },
  { key: 'load', label: 'Mid-span point load (optional)', unit: 'N', kind: 'number', min: 0, max: 1000000, step: 10 },
  { key: 'span', label: 'Span between supports', unit: 'mm', kind: 'number', min: 20, max: 12000, step: 1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(CH_MATERIALS) },
];
export const tubeDefaults: Params = { od: 48.3, wall: 3, length: 1000, load: 0, span: 1000, sf: 1.5, material: 'S235 Steel' };
export interface TubeD { od: number; id: number; t: number; L: number; A: number; I: number; massKg: number; matId: string }
export function calcTube(p: Params): CalcResult {
  const od = num(p, 'od'), t = num(p, 'wall'), L = num(p, 'length'), F = num(p, 'load') || 0, span = num(p, 'span') || L, sf = num(p, 'sf') || 1.5, mat = material(String(p.material));
  const inputs = [R('Outside dia', od, 'mm'), R('Wall', t, 'mm'), R('Length', L, 'mm'), R('Load', F, 'N'), R('Span', span, 'mm'), R('Material', String(p.material))];
  const standards = ['Euler-Bernoulli beam theory'];
  const errors = validate([['outside diameter', od, { min: 8 }], ['wall thickness', t, { min: 0.8 }], ['length', L, { min: 20 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && 2 * t >= od) errors.push('Wall thickness must be less than half the outside diameter.');
  if (errors.length) return failed(inputs, errors, standards);
  const id = od - 2 * t, A = (Math.PI / 4) * (od * od - id * id), I = (Math.PI / 64) * (od ** 4 - id ** 4), massKg = A * L * mat!.density, bc = beamChecks(F, span, sf, I, od / 2, mat!), w: string[] = [...bc.warnings];
  if (od / t > 50) w.push('Thin wall (D/t > 50): local buckling and denting are not checked.');
  return done(inputs, [R('Inside diameter', id, 'mm'), R('Cross-section area', A, 'mm²', 1), R('Second moment I', I, 'mm⁴', 0), R('Approx. mass', massKg, 'kg', 3), ...bc.rows], ['Plain tube; end cuts square, no weld seam.'], w, standards, { od, id, t, L, A, I, massKg, matId: String(p.material) } satisfies TubeD);
}
export const tubeGeo = (c: TubeD): GeoPart[] => [{ id: 'tube', name: 'Round tube', color: col(c.matId), explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: c.id / 2, rOut: c.od / 2, z0: 0, z1: c.L }] }];
export function tubeViews(c: TubeD): DrawView[] {
  const { od, id, t, L } = c;
  return [{ name: 'END VIEW', ents: [circ([0, 0], od / 2), circ([0, 0], id / 2), { t: 'hatch', x0: -od / 2, y0: -0.0001, x1: -id / 2, y1: 0.0001 }, ...cross([0, 0], od / 2 + 4), dim([-od / 2, -od / 2], [od / 2, -od / 2], -8, `Ø${fmt(od, 2)}`, ed('od', od)), dim([id / 2, od / 2], [od / 2, od / 2], 8, `t ${fmt(t, 2)}`, ed('wall', t))] },
    { name: 'SIDE VIEW', ents: [rect(0, -od / 2, L, od / 2), line([0, -id / 2], [L, -id / 2], 'hidden'), line([0, id / 2], [L, id / 2], 'hidden'), line([-4, 0], [L + 4, 0], 'centre'), dim([0, -od / 2], [L, -od / 2], -10, `${fmt(L, 2)}`, ed('length', L))] }, geoView(tubeGeo(c), 'iso')];
}

/* ======================= Adjustable leg (conveyor stand) ======================= */
export const LEG_FIELDS: ParamField[] = [
  { key: 'tubeOD', label: 'Leg tube outside diameter', unit: 'mm', kind: 'number', min: 20, max: 150, step: 0.5 },
  { key: 'wall', label: 'Tube wall thickness', unit: 'mm', kind: 'number', min: 1.5, max: 10, step: 0.1 },
  { key: 'height', label: 'Tube height', unit: 'mm', kind: 'number', min: 100, max: 2000, step: 1 },
  { key: 'studDia', label: 'Adjusting stud diameter', unit: 'mm', kind: 'number', min: 6, max: 36, step: 1 },
  { key: 'exposed', label: 'Stud exposed below tube', unit: 'mm', kind: 'number', min: 5, max: 200, step: 1 },
  { key: 'footDia', label: 'Foot diameter', unit: 'mm', kind: 'number', min: 30, max: 250, step: 1 },
  { key: 'footThk', label: 'Foot thickness', unit: 'mm', kind: 'number', min: 3, max: 30, step: 0.5 },
  { key: 'load', label: 'Vertical load per leg (optional)', unit: 'N', kind: 'number', min: 0, max: 500000, step: 50, help: '0 = skip buckling check' },
  { key: 'material', label: 'Tube material', kind: 'select', options: mats(CH_MATERIALS) },
];
export const legDefaults: Params = { tubeOD: 40, wall: 2.5, height: 700, studDia: 10, exposed: 30, footDia: 64, footThk: 6, load: 0, material: 'S235 Steel' };
export interface LegD { od: number; id: number; wall: number; H: number; stud: number; E: number; insert: number; fd: number; ft: number; total: number; massKg: number; matId: string }
export function calcLeg(p: Params): CalcResult {
  const od = num(p, 'tubeOD'), t = num(p, 'wall'), H = num(p, 'height'), stud = num(p, 'studDia'), E = num(p, 'exposed'), fd = num(p, 'footDia'), ft = num(p, 'footThk'), F = num(p, 'load') || 0, mat = material(String(p.material));
  const inputs = [R('Tube OD', od, 'mm'), R('Wall', t, 'mm'), R('Height', H, 'mm'), R('Stud dia', stud, 'mm'), R('Exposed stud', E, 'mm'), R('Foot dia', fd, 'mm'), R('Foot thickness', ft, 'mm'), R('Load', F, 'N'), R('Material', String(p.material))];
  const standards = ['Euler column buckling (pinned-pinned, K = 1)'];
  const errors = validate([['tube OD', od, { min: 20 }], ['wall', t, { min: 1.5 }], ['height', H, { min: 100 }], ['stud diameter', stud, { min: 6 }], ['exposed length', E, { min: 5 }], ['foot diameter', fd, { min: 30 }], ['foot thickness', ft, { min: 3 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length) {
    if (2 * t >= od - 10) errors.push('Wall is too thick for the tube diameter.');
    if (stud > od - 2 * t - 2) errors.push('Stud must be at least 2 mm smaller than the tube inside diameter.');
    if (fd < od) errors.push('Foot must be at least as wide as the tube.');
  }
  if (errors.length) return failed(inputs, errors, standards);
  const id = od - 2 * t, insert = Math.min(60, H / 2), total = ft + E + H, A = (Math.PI / 4) * (od * od - id * id), I = (Math.PI / 64) * (od ** 4 - id ** 4), warnings: string[] = [];
  if (insert < 1.5 * stud) warnings.push('Stud engagement inside the tube is under 1.5 x stud diameter.');
  const vol = A * H + (Math.PI / 4) * stud * stud * (E + insert) + (Math.PI / 4) * fd * fd * ft, massKg = vol * mat!.density;
  const calc = [R('Overall height (foot to tube top)', total, 'mm'), R('Stud engagement in tube', insert, 'mm'), R('Approx. mass', massKg, 'kg', 3)];
  if (F > 0 && mat!.E) {
    const Pcr = (Math.PI ** 2 * mat!.E * 1000 * I) / (H + E) ** 2, allow = Pcr / 3, sigma = F / A;
    calc.push(R('Euler critical load', Pcr, 'N', 0), R('Allowable load (critical / 3)', allow, 'N', 0), R('Compressive stress', sigma, 'MPa', 1));
    if (F > allow) warnings.push('Leg FAILS the preliminary buckling check (load above critical load / 3). Check bracing and stud strength separately.');
    if (mat!.yieldMPa && sigma > mat!.yieldMPa / 2) warnings.push('Compressive stress exceeds half of yield strength.');
  }
  return done(inputs, calc, ['Stud treated as a plain cylinder (thread not modelled); stud and foot strength are not checked. Euler check uses K = 1 and a safety factor of 3.'], warnings, standards, { od, id, wall: t, H, stud, E, insert, fd, ft, total, massKg, matId: String(p.material) } satisfies LegD);
}
export function legGeo(c: LegD): GeoPart[] {
  const color = col(c.matId);
  return [
    { id: 'foot', name: 'Foot', color: '#3a3f45', explode: [0, 0, -1], prims: [{ kind: 'tube', rIn: 0, rOut: c.fd / 2, z0: 0, z1: c.ft }] },
    { id: 'stud', name: 'Adjusting stud', color: '#b9c2cc', explode: [0, 0, -0.4], prims: [{ kind: 'tube', rIn: 0, rOut: c.stud / 2, z0: c.ft, z1: c.ft + c.E + c.insert }] },
    { id: 'tube', name: 'Leg tube', color, explode: [0, 0, 1], prims: [{ kind: 'tube', rIn: c.id / 2, rOut: c.od / 2, z0: c.ft + c.E, z1: c.total }] },
  ];
}
export function legViews(c: LegD): DrawView[] {
  const { od, id, H, stud, E, fd, ft, total, insert } = c, z0 = ft + E;
  const side: ModelEnt[] = [rect(-fd / 2, 0, fd / 2, ft), rect(-stud / 2, ft, stud / 2, z0 + insert), { t: 'poly', closed: true, layer: 'outline', pts: [[-od / 2, z0], [od / 2, z0], [od / 2, total], [-od / 2, total]] }, line([-id / 2, z0], [-id / 2, total], 'hidden'), line([id / 2, z0], [id / 2, total], 'hidden'), line([0, -4], [0, total + 6], 'centre'),
    dim([od / 2, z0], [od / 2, total], 12, `${fmt(H, 2)}`, ed('height', H)), dim([fd / 2, ft], [fd / 2, z0], 12, `${fmt(E, 2)}`, ed('exposed', E)), dim([-fd / 2, 0], [-fd / 2, ft], 10, `${fmt(ft, 2)}`, ed('footThk', ft)), dim([-fd / 2, 0], [fd / 2, 0], -8, `Ø${fmt(fd, 2)}`, ed('footDia', fd)), dim([-od / 2, total], [od / 2, total], 8, `Ø${fmt(od, 2)}`, ed('tubeOD', od))];
  return [{ name: 'SIDE VIEW', ents: side }, { name: 'TOP VIEW', ents: [circ([0, 0], fd / 2, 'hidden'), circ([0, 0], od / 2), circ([0, 0], id / 2, 'hidden'), ...cross([0, 0], fd / 2 + 4)] }, geoView(legGeo(c), 'iso')];
}

/* ======================= Mounting / transfer / dead plate ======================= */
export const PLATE_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6', 'UHMW-PE', 'Nylon PA6', 'Acetal POM'];
export const PLATE_FIELDS: ParamField[] = [
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 3000, step: 1 },
  { key: 'width', label: 'Width', unit: 'mm', kind: 'number', min: 20, max: 3000, step: 1 },
  { key: 'thickness', label: 'Thickness', unit: 'mm', kind: 'number', min: 1, max: 50, step: 0.5 },
  { key: 'cols', label: 'Hole columns (along length)', kind: 'number', min: 0, max: 20, step: 1 },
  { key: 'rows', label: 'Hole rows (along width)', kind: 'number', min: 0, max: 20, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'holeDia', label: 'Hole diameter', unit: 'mm', kind: 'number', min: 2, max: 60, step: 0.1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'edgeX', label: 'Edge distance along length', unit: 'mm', kind: 'number', min: 3, max: 500, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'edgeY', label: 'Edge distance along width', unit: 'mm', kind: 'number', min: 3, max: 500, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: mats(PLATE_MATERIALS) },
];
export const plateDefaults: Params = { length: 200, width: 100, thickness: 6, cols: 3, rows: 2, holeDia: 6.5, edgeX: 16, edgeY: 16, material: 'S235 Steel' };
export interface PlateD { L: number; W: number; t: number; nx: number; ny: number; dh: number; ex: number; ey: number; px: number; py: number; centres: Pt[]; massKg: number; matId: string }
export function calcPlate(p: Params): CalcResult {
  const L = num(p, 'length'), W = num(p, 'width'), t = num(p, 'thickness'), nx = num(p, 'cols') || 0, ny = nx > 0 ? num(p, 'rows') || 0 : 0, dh = nx > 0 ? num(p, 'holeDia') : 0, ex = nx > 0 ? num(p, 'edgeX') : 0, ey = nx > 0 ? num(p, 'edgeY') : 0, mat = material(String(p.material));
  const inputs = [R('Length', L, 'mm'), R('Width', W, 'mm'), R('Thickness', t, 'mm'), R('Columns', nx), R('Rows', ny), R('Hole dia', dh, 'mm'), R('Edge X', ex, 'mm'), R('Edge Y', ey, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['length', L, { min: 20 }], ['width', W, { min: 20 }], ['thickness', t, { min: 1 }], ['columns', nx, { min: 0, int: true }], ['rows', ny, { min: 0, int: true }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && nx > 0) {
    errors.push(...validate([['hole diameter', dh, { min: 2 }], ['edge distance X', ex, { min: 3 }], ['edge distance Y', ey, { min: 3 }]]));
    if (!errors.length) {
      if (ny === 0) errors.push('Rows must be at least 1 when columns are set (or set columns to 0 for a plain plate).');
      if (nx > 1 && 2 * ex >= L) errors.push('Edge distances along the length leave no room between holes.');
      if (ny > 1 && 2 * ey >= W) errors.push('Edge distances along the width leave no room between holes.');
      if (dh > Math.min(L, W) - 6) errors.push('Hole is too large for the plate.');
    }
  }
  if (errors.length) return failed(inputs, errors, standards);
  const px = nx > 1 ? (L - 2 * ex) / (nx - 1) : 0, py = ny > 1 ? (W - 2 * ey) / (ny - 1) : 0, warnings: string[] = [];
  if (nx > 0 && (ex < 1.5 * dh || ey < 1.5 * dh)) warnings.push('Edge distance is under 1.5 x hole diameter; edge may tear out.');
  if ((nx > 1 && px < 3 * dh) || (ny > 1 && py < 3 * dh)) warnings.push('Hole pitch is under 3 x hole diameter.');
  const centres: Pt[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) centres.push([nx > 1 ? ex + i * px : L / 2, ny > 1 ? ey + j * py : W / 2]);
  const massKg = (L * W - centres.length * (Math.PI / 4) * dh * dh) * t * mat!.density;
  return done(inputs, [R('Hole pitch X', px, 'mm', 2), R('Hole pitch Y', py, 'mm', 2), R('Holes', centres.length), R('Approx. mass', massKg, 'kg', 3)], ['Plain through holes, square corners, no chamfers. Plate is flat (no bends).'], warnings, standards, { L, W, t, nx, ny, dh, ex, ey, px, py, centres, massKg, matId: String(p.material) } satisfies PlateD);
}
export const plateGeo = (c: PlateD): GeoPart[] => [{ id: 'plate', name: 'Plate', color: col(c.matId), explode: [0, 0, 0], prims: [{ kind: 'prism', outer: rectPoly(0, 0, c.L, c.W), holes: c.centres.map((q) => ({ c: q, r: c.dh / 2 })), z0: 0, z1: c.t }] }];
export function plateViews(c: PlateD): DrawView[] {
  const { L, W, t, nx, ny, dh, ex, ey, px, py } = c;
  const plan: ModelEnt[] = [rect(0, 0, L, W), ...c.centres.flatMap((q): ModelEnt[] => [circ(q, dh / 2), line([q[0] - dh, q[1]], [q[0] + dh, q[1]], 'centre'), line([q[0], q[1] - dh], [q[0], q[1] + dh], 'centre')]), dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`, ed('length', L)), dim([L, 0], [L, W], -10, `${fmt(W, 2)}`, ed('width', W))];
  if (nx > 0) plan.push(dim([0, W], [ex, W], 8, `${fmt(ex, 1)}`, ed('edgeX', ex)), dim([0, 0], [0, ey], 8, `${fmt(ey, 1)}`, ed('edgeY', ey)), { t: 'text', p: [L / 2, W + 14], s: `${nx * ny} x Ø${fmt(dh, 2)} THROUGH`, h: 3.2, layer: 'text', anchor: 'c', edit: { key: 'holeDia', value: dh } });
  if (nx > 1) plan.push(dim([ex, W], [ex + px, W], 18, `${fmt(px, 2)} pitch`));
  if (ny > 1) plan.push(dim([L, ey], [L, ey + py], -22, `${fmt(py, 2)} pitch`));
  return [{ name: 'PLAN VIEW', ents: plan }, { name: 'SIDE VIEW', ents: [rect(0, 0, L, t), dim([L, 0], [L, t], -8, `${fmt(t, 2)}`, ed('thickness', t))] }, geoView(plateGeo(c), 'iso')];
}
