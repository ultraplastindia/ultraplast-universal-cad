import type { Family, Variant } from '../../core/family.ts';
import type { CalcResult, ParamField, Params, Pt } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { circlePts, discretize, polygonArea } from '../../core/geom.ts';
import { geoView } from '../../core/project.ts';
import { primsSolid } from '../../core/primsSolid.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { fmt, num } from '../../core/util.ts';
import { material } from '../../data/materials.ts';
import { calcSprocket, SPROCKET_FIELDS, SPROCKET_MATERIALS, sprocketDefaults } from './calc.ts';
import type { SprocketDerived } from './calc.ts';
import { sprocketBorePts, sprocketViews } from './drawing.ts';

/* "Sprocket (all types)": one value-driven sprocket that covers single, duplex, triplex and multi-strand sprockets, double single
 * sprockets on one hub, bush / QD / drive (flanged hub with bolt holes), steel split, drum-type and industrial (large hub) styles.
 * The named types are presets of these values (see the Component types page). The existing single-strand "Roller chain sprocket" is not changed. */

/** Transverse pitch of multi-strand roller chain in mm (ISO 606 B series, ASME B29.1). Defaults only: check with your chain maker. */
export const TRANSVERSE_PITCH: Record<string, number> = { '06B-1': 10.24, '08B-1': 13.92, '10B-1': 16.59, '12B-1': 19.46, '16B-1': 31.88, '20B-1': 36.45, '24B-1': 48.36, 'ANSI 40': 14.38, 'ANSI 50': 18.11, 'ANSI 60': 22.78, 'ANSI 80': 29.29 };

const hasBoltFields = (p: Params) => num(p, 'boltCount') > 0;
export const MULTI_FIELDS: ParamField[] = [
  ...SPROCKET_FIELDS,
  { key: 'strands', label: 'Number of strands (tooth rows)', kind: 'number', min: 1, max: 6, step: 1, help: '1 = single, 2 = duplex, 3 = triplex, 4 to 6 = multi-strand.' },
  { key: 'strandPitch', label: 'Distance between strands (transverse pitch)', unit: 'mm', kind: 'number', min: 2, max: 400, step: 0.01, showIf: (p) => num(p, 'strands') > 1, help: 'Centre to centre of the tooth rows. Default is the standard transverse pitch of the chain; check it with your chain maker.' },
  { key: 'strandCore', label: 'Between the strands', kind: 'select', options: [{ value: 'root', label: 'Solid body up to the root diameter (duplex / triplex)' }, { value: 'hub', label: 'Hub diameter only (double single)' }], showIf: (p) => num(p, 'strands') > 1 },
  { key: 'hubSide', label: 'Hub position', kind: 'select', options: [{ value: 'one', label: 'One side' }, { value: 'both', label: 'Both sides (each side as long as the hub length)' }], showIf: (p) => num(p, 'hubLength') > 0 },
  { key: 'boltCount', label: 'Flange bolt holes in the hub (0 = none)', kind: 'number', min: 0, max: 12, step: 1, help: 'For QD, drive and bush-type hubs. Needs a hub.' },
  { key: 'boltPcd', label: 'Bolt circle diameter', unit: 'mm', kind: 'number', min: 10, max: 400, step: 0.5, showIf: hasBoltFields },
  { key: 'boltDia', label: 'Bolt hole diameter', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.1, showIf: hasBoltFields },
  { key: 'split', label: 'Split sprocket (two halves joined by bolts)', kind: 'boolean', help: 'Shown in the drawing as a split line. The 3D model is drawn as one piece.' },
];

export function multiDefaults(chainId: string, z: number, over: Params = {}): Params {
  const base = sprocketDefaults(chainId, z);
  return { ...base, strands: 1, strandPitch: TRANSVERSE_PITCH[chainId] ?? +(Number(base.pitch) * 1.1).toFixed(2), strandCore: 'root', hubSide: 'one', boltCount: 0, boltPcd: 0, boltDia: 0, split: false, ...over };
}

export interface MultiD {
  c0: SprocketDerived; n: number; pt: number; hubLen: number; hubDia: number; hubSide: string; coreR: number; z0p: number; total: number;
  bolts: { c: Pt; r: number }[]; boltPcd: number; split: boolean; massKg: number; matId: string;
  layout: { id: string; name: string; z0: number; z1: number; r: number; kind: 'plate' | 'core' | 'hub' }[];
}

const volumeOf = (geo: GeoPart[]): number => geo.reduce((a, g) => a + g.prims.reduce((b, pr) => {
  if (pr.kind === 'tube') return b + Math.PI * (pr.rOut ** 2 - pr.rIn ** 2) * (pr.z1 - pr.z0);
  if (pr.kind === 'sphere') return b + (4 / 3) * Math.PI * pr.r ** 3;
  return b + (polygonArea(pr.outer) - pr.holes.reduce((s, h) => s + ('poly' in h ? polygonArea(h.poly) : Math.PI * h.r * h.r), 0)) * (pr.z1 - pr.z0);
}, 0), 0);

export function calcMulti(p: Params): CalcResult {
  const hubLen = Number.isFinite(num(p, 'hubLength')) ? num(p, 'hubLength') : 0, hubDia = num(p, 'hubDia'), n = num(p, 'strands');
  const bc = Number.isFinite(num(p, 'boltCount')) ? num(p, 'boltCount') : 0, pcd = bc > 0 ? num(p, 'boltPcd') : 0, bd = bc > 0 ? num(p, 'boltDia') : 0;
  const side = p.hubSide === 'both' ? 'both' : 'one', core = p.strandCore === 'hub' ? 'hub' : 'root', split = !!p.split;
  const c1 = calcSprocket({ ...p, hubLength: 0 });
  const inputs = [...c1.inputs, { label: 'Strands', value: String(n) }, { label: 'Hub length', value: String(hubLen), unit: 'mm' }];
  const fail = (errors: string[]): CalcResult => ({ ...c1, ok: false, inputs, calculated: [], errors: [...c1.errors, ...errors], derived: null });
  if (!c1.ok || !c1.derived) return { ...c1, inputs, ok: false, derived: null };
  const c0 = c1.derived as SprocketDerived, errors: string[] = [], warnings = [...c1.warnings.filter((w) => !/^PRELIMINARY/.test(w))];
  if (!Number.isInteger(n) || n < 1 || n > 6) errors.push('Number of strands must be a whole number from 1 to 6.');
  const pt = n > 1 ? num(p, 'strandPitch') : 0;
  if (n > 1 && !(pt >= c0.bf1 + 1)) errors.push(`Distance between strands must be at least ${fmt(c0.bf1 + 1, 2)} mm (tooth plate width + 1 mm).`);
  if (hubLen < 0 || !Number.isFinite(hubLen)) errors.push('Hub length must be 0 or greater.');
  const hubNeeded = hubLen > 0 || (n > 1 && core === 'hub');
  if (hubNeeded && !(hubDia > c0.bore + 2)) errors.push('Hub diameter must be larger than the bore by at least 2 mm.');
  if (hubNeeded && hubDia > c0.da) errors.push('Hub diameter exceeds the tooth tip diameter.');
  if (bc > 0) {
    if (!Number.isInteger(bc)) errors.push('Number of bolt holes must be a whole number.');
    if (!(hubLen > 0)) errors.push('Bolt holes need a hub: set a hub length above 0.');
    else if (!(pcd > 0) || !(bd > 0)) errors.push('Enter the bolt circle diameter and the bolt hole diameter.');
    else {
      const keyD = c0.key ? c0.key.t2 : 0;
      if (pcd / 2 - bd / 2 < c0.bore / 2 + keyD + 2) errors.push('Bolt holes are too close to the bore. Increase the bolt circle diameter or reduce the hole diameter.');
      if (pcd / 2 + bd / 2 > hubDia / 2 - 1) errors.push('Bolt holes break out of the hub. Reduce the bolt circle diameter or enlarge the hub.');
      if (bc > 1 && 2 * (pcd / 2) * Math.sin(Math.PI / bc) < bd + 2) errors.push('Bolt holes overlap each other. Use fewer or smaller holes.');
    }
  }
  if (errors.length) return fail(errors);
  const coreR = core === 'hub' ? hubDia / 2 : c0.df / 2, z0p = hubLen > 0 && side === 'both' ? hubLen : 0;
  const layout: MultiD['layout'] = [];
  if (z0p > 0) layout.push({ id: 'hubA', name: 'Hub (front)', z0: 0, z1: hubLen, r: hubDia / 2, kind: 'hub' });
  for (let i = 0; i < n; i++) {
    const a = z0p + i * pt;
    layout.push({ id: `plate${i + 1}`, name: n > 1 ? `Tooth plate ${i + 1}` : 'Tooth plate', z0: a, z1: a + c0.bf1, r: c0.da / 2, kind: 'plate' });
    if (i < n - 1 && pt - c0.bf1 > 1e-6) layout.push({ id: `core${i + 1}`, name: `Body between strands ${i + 1}-${i + 2}`, z0: a + c0.bf1, z1: a + pt, r: coreR, kind: 'core' });
  }
  const zl = z0p + (n - 1) * pt + c0.bf1;
  if (hubLen > 0) layout.push({ id: 'hub', name: 'Hub', z0: zl, z1: zl + hubLen, r: hubDia / 2, kind: 'hub' });
  const total = layout.reduce((m, l) => Math.max(m, l.z1), 0);
  const bolts = Array.from({ length: bc }, (_, i) => ({ c: [(pcd / 2) * Math.cos(Math.PI / 2 + (2 * Math.PI * i) / bc), (pcd / 2) * Math.sin(Math.PI / 2 + (2 * Math.PI * i) / bc)] as Pt, r: bd / 2 }));
  const d0 = { c0, n, pt, hubLen, hubDia, hubSide: side, coreR, z0p, total, bolts, boltPcd: pcd, split, massKg: 0, matId: c0.matId, layout } as MultiD;
  const mat = material(c0.matId);
  d0.massKg = volumeOf(multiGeo(d0)) * (mat?.density ?? 0);
  const bigHub = hubLen > 0 && hubDia > c0.df - 1;
  if (bigHub) warnings.push('Hub diameter exceeds the root diameter: chain link plates may foul the hub.');
  if (n > 1) warnings.push('Strand distance defaults come from the standard transverse pitch; confirm with your chain maker before ordering.');
  if (split) warnings.push('Split sprocket: the 3D model and mass are for the unsplit body. Split halves need clamp bolts and fitting details that are not modelled.');
  warnings.push('PRELIMINARY: tooth load, chain speed and wear life are NOT verified.');
  const assumptions = [...c1.assumptions.filter((a) => !/Single-strand|Hub is on one side|No hub/.test(a)),
    `${n} tooth row(s). Tooth plate width bf1 = ${fmt(c0.bf1, 2)} mm per strand.`, 'Hub, flange bolt holes and strand bodies are simple cylinders; chamfers, set screws and tolerances are not modelled.'];
  const calculated = [...c1.calculated.filter((r) => !/Overall width|Approx\. mass/.test(r.label)), { label: 'Strands', value: String(n) }, ...(n > 1 ? [{ label: 'Strand distance', value: fmt(pt, 2), unit: 'mm' }] : []),
    { label: 'Overall width', value: fmt(total, 2), unit: 'mm' }, ...(bc > 0 ? [{ label: 'Flange bolt holes', value: `${bc} x Ø${fmt(bd, 2)} on Ø${fmt(pcd, 2)}` }] : []), { label: 'Approx. mass', value: fmt(d0.massKg, 4), unit: 'kg' }];
  return { ok: true, inputs, calculated, assumptions, warnings, errors: [], standards: c1.standards, derived: d0 };
}

export function multiGeo(c: MultiD): GeoPart[] {
  const color = material(c.c0.matId)?.color ?? '#999', bore = sprocketBorePts(c.c0), tooth = discretize(c.c0.start, c.c0.path);
  return c.layout.map((l) => ({
    id: l.id, name: l.name, color, explode: [0, 0, 0] as [number, number, number],
    prims: [{ kind: 'prism' as const, outer: l.kind === 'plate' ? tooth : circlePts(l.r), holes: [{ poly: bore }, ...(l.kind === 'hub' ? c.bolts.map((b) => ({ c: b.c, r: b.r })) : [])], z0: l.z0, z1: l.z1 }],
  }));
}

export function multiViews(c: MultiD): DrawView[] {
  const s = sprocketViews(c.c0), R = c.c0.da / 2, b = c.c0.bore / 2, W = c.total;
  const front = [...s[0].ents];
  if (c.hubLen > 0) front.push({ t: 'circle', c: [0, 0], r: c.hubDia / 2, layer: 'hidden' });
  for (const k of c.bolts) front.push({ t: 'circle', c: k.c, r: k.r, layer: 'outline' });
  if (c.bolts.length) front.push({ t: 'circle', c: [0, 0], r: c.boltPcd / 2, layer: 'centre' });
  if (c.split) front.push({ t: 'line', a: [-R - 4, 0], b: [R + 4, 0], layer: 'hidden' }, { t: 'text', p: [R + 6, 2], s: 'SPLIT LINE', h: 3, layer: 'text', anchor: 'l' });
  const section: ModelEnt[] = [{ t: 'line', a: [-6, 0], b: [W + 6, 0], layer: 'centre' }, { t: 'line', a: [0, b], b: [W, b], layer: 'outline' }, { t: 'line', a: [0, -b], b: [W, -b], layer: 'outline' }];
  for (const l of c.layout) for (const sg of [1, -1]) {
    section.push({ t: 'poly', closed: true, layer: 'outline', pts: [[l.z0, sg * b], [l.z1, sg * b], [l.z1, sg * l.r], [l.z0, sg * l.r]] });
    section.push(sg === 1 ? { t: 'hatch', x0: l.z0, y0: b, x1: l.z1, y1: l.r } : { t: 'hatch', x0: l.z0, y0: -l.r, x1: l.z1, y1: -b });
  }
  section.push({ t: 'dim', a: [0, -R], b: [W, -R], off: -10, text: `${fmt(W, 2)}` }, { t: 'dim', a: [c.z0p, -R], b: [c.z0p + c.c0.bf1, -R], off: -20, text: `${fmt(c.c0.bf1, 2)}` },
    { t: 'dim', a: [0, -b], b: [0, b], off: 12, text: `Ø${fmt(c.c0.bore, 2)} (bore)`, edit: { key: 'bore', value: c.c0.bore } }, { t: 'dim', a: [0, -R], b: [0, R], off: 24, text: `Ø${fmt(c.c0.da, 2)}` });
  if (c.n > 1) section.push({ t: 'dim', a: [c.z0p, -R], b: [c.z0p + c.pt, -R], off: -30, text: `${fmt(c.pt, 2)} strand distance`, edit: { key: 'strandPitch', value: c.pt } });
  if (c.hubLen > 0) {
    const hr = c.hubDia / 2, h0 = W - c.hubLen;
    section.push({ t: 'dim', a: [W, -hr], b: [W, hr], off: -12, text: `Ø${fmt(c.hubDia, 2)} (hub)`, edit: { key: 'hubDia', value: c.hubDia } }, { t: 'dim', a: [h0, hr], b: [W, hr], off: 8, text: `${fmt(c.hubLen, 2)}`, edit: { key: 'hubLength', value: c.hubLen } });
  }
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: section }, s[2], geoView(multiGeo(c), 'iso')];
}

const V = (id: string, name: string, params: Params): Variant => ({ id, name, params });
const f2 = (n: unknown) => String(+Number(n).toFixed(2));
const kd = (label: string, v: number, unit = 'mm') => ({ label, value: f2(v), unit });
const mk = (chain: string, z: number, over: Params = {}) => multiDefaults(chain, z, over);

export const MULTI_VARIANTS: Variant[] = [
  V('SPM-SIMPLEX', 'Single stand sprocket 08B-1, 17 teeth', mk('08B-1', 17)),
  V('SPM-DUPLEX', 'Duplex sprocket 08B-2, 17 teeth', mk('08B-1', 17, { strands: 2 })),
  V('SPM-TRIPLEX', 'Triplex sprocket 08B-3, 17 teeth', mk('08B-1', 17, { strands: 3 })),
  V('SPM-MULTI4', 'Multi stand sprocket, 4 strands, 10B, 19 teeth', mk('10B-1', 19, { strands: 4 })),
  V('SPM-DOUBLE-SINGLE', 'Double single sprocket 08B, 17 teeth (two rows, 40 mm apart)', mk('08B-1', 17, { strands: 2, strandPitch: 40, strandCore: 'hub' })),
  V('SPM-BUSH', 'Bush sprocket 10B-1, 19 teeth, long hub', mk('10B-1', 19, { hubLength: 40, hubDia: 50 })),
  V('SPM-QD', 'QD-type sprocket 12B-1, 21 teeth, flange bolts', mk('12B-1', 21, { bore: 28, hubDia: 70, hubLength: 35, boltCount: 3, boltPcd: 52, boltDia: 8, keyway: true })),
  V('SPM-SPLIT', 'Steel split sprocket 16B-1, 25 teeth', mk('16B-1', 25, { bore: 40, hubDia: 80, hubLength: 30, boltCount: 4, boltPcd: 62, boltDia: 9, split: true })),
  V('SPM-DRIVE', 'Drive sprocket ANSI 50, 21 teeth, flanged hub', mk('ANSI 50', 21, { bore: 25, hubDia: 60, hubLength: 28, boltCount: 4, boltPcd: 45, boltDia: 7 })),
  V('SPM-DRUM', 'Drum-type sprocket 16B-1, 20 teeth, wide drum', mk('16B-1', 20, { bore: 35, hubDia: 90, hubLength: 80, hubSide: 'both' })),
  V('SPM-INDUSTRIAL', 'Industrial heavy sprocket 20B-1, 25 teeth', mk('20B-1', 25, { bore: 50, hubDia: 100, hubLength: 60 })),
];

export const SPROCKET_ALL: Omit<Family, 'basic' | 'autofill'> = {
  id: 'sprocket_types', name: 'Sprocket (all types: single, duplex, triplex, multi, QD, split, drum)', category: 'B', subcategory: 'Sprocket types (single to multi-strand, hub styles)',
  description: 'One sprocket for every style: enter the number of strands, the hub and any flange bolt holes. Single, duplex, triplex, multi-strand, double single, bush, QD, split, drive, drum and industrial sprockets are all created from values.',
  keywords: ['sprocket', 'duplex', 'triplex', 'simplex', 'single', 'multi strand', 'double single', 'bush', 'taper bush', 'qd', 'quick detachable', 'split', 'steel split', 'drive', 'drum', 'industrial', 'shaft', 'chain wheel', 'tooth'],
  materials: SPROCKET_MATERIALS, applications: ['chain drive', 'conveyor drive', 'multi-strand drives'], standards: ['ISO 606', 'ASME B29.1', 'DIN 6885-1 / ISO 773'], related: ['sprocket', 'shaft', 'bearing', 'key'],
  fields: MULTI_FIELDS, defaults: multiDefaults('08B-1', 17), variants: MULTI_VARIANTS, calculate: calcMulti, views: multiViews, geo: multiGeo, solid: (R, c) => primsSolid(R, multiGeo(c)),
  asm: (c) => ({ role: 'bore', bore: c.c0.bore, chainPitch: c.c0.p, chain: `p${f2(c.c0.p)}-d${f2(c.c0.d1)}` }),
  partNo: (p) => `SPM-${String(p.chain).replace(/[^A-Za-z0-9]+/g, '')}-Z${p.teeth}-S${p.strands}-B${p.bore}`, materialOf: (p) => String(p.material),
  keyDims: (c) => [kd('Pitch dia', c.c0.d), kd('Tip dia', c.c0.da), kd('Bore', c.c0.bore), kd('Width', c.total)],
  notes: (c) => [`ROLLER CHAIN PITCH ${f2(c.c0.p)} MM, ${c.c0.z} TEETH, ${c.n} STRAND(S), TOOTH FORM PER ISO 606`, c.c0.key ? `KEYWAY ${c.c0.key.b} x ${c.c0.key.h} PER ISO 773` : 'NO KEYWAY', ...(c.bolts.length ? [`${c.bolts.length} x Ø${f2(c.bolts[0].r * 2)} FLANGE HOLES ON Ø${f2(c.boltPcd)}`] : []), ...(c.split ? ['SPLIT TYPE (TWO HALVES)'] : []), 'ALL DIMENSIONS IN MM UNLESS STATED'],
};
