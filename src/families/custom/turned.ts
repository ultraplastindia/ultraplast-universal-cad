import type { Family, Variant } from '../../core/family.ts';
import type { CalcResult, ParamField, Params } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { rectPoly } from '../../core/prims.ts';
import { primsSolid } from '../../core/primsSolid.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { fmt, num } from '../../core/util.ts';
import { R, dim, done, failed, line, rect, validate } from '../extra/common.ts';
import { base, f2, isCustom, kd, MATERIAL_FIELDS, matInfo, roundGeo, roundViews, V } from './custom.ts';
import type { RoundD } from './custom.ts';

/* Two more value-based families used by the Image to 3D page (and usable on their own):
 *  custom_turned  - a round part from a list of "length,diameter" sections (any number, up to 12) plus an optional bore
 *  custom_stepped - stacked rectangular blocks from a list of "width,depth,height" slabs, centred on each other */

/** "length,diameter; length,diameter" -> numbers, or an error text */
export function parseList(text: string, n: number, label: string, max: number): number[][] | string {
  const rows = text.split(/[;\n]+/).map((r) => r.trim()).filter(Boolean);
  if (!rows.length) return `Enter at least one ${label}.`;
  if (rows.length > max) return `Use at most ${max} ${label}s (you entered ${rows.length}).`;
  const out: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i].split(/[,\s]+/).filter(Boolean).map(Number);
    if (v.length !== n || v.some((x) => !Number.isFinite(x) || x <= 0)) return `${label[0].toUpperCase()}${label.slice(1)} ${i + 1} ("${rows[i]}") must be ${n} positive numbers separated by commas.`;
    out.push(v);
  }
  return out;
}
export const formatList = (rows: number[][]): string => rows.map((r) => r.map((x) => String(+x.toFixed(2))).join(',')).join('; ');

/* ---------------- turned part ---------------- */
export const TURNED_FIELDS: ParamField[] = [
  { key: 'sections', label: 'Sections: length,diameter for each step, from one end to the other', kind: 'text', rows: 4, help: 'Example: 40,25; 60,30; 40,25 means a 25 mm long-40 step, then 30 mm x 60, then 25 mm x 40. Up to 12 sections.' },
  { key: 'bore', label: 'Through bore diameter (0 = solid)', unit: 'mm', kind: 'number', min: 0, max: 2000, step: 0.1 },
  ...MATERIAL_FIELDS,
];
export const turnedDefaults: Params = { sections: '40,25; 60,30; 40,25', bore: 0, material: 'C45 Steel', density: 7.85 };

export function calcTurned(p: Params): CalcResult {
  const bore = Number.isFinite(num(p, 'bore')) ? num(p, 'bore') : NaN;
  const list = parseList(String(p.sections ?? ''), 2, 'section', 12);
  const inputs = [R('Sections', String(p.sections ?? '')), R('Bore', bore, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['bore', bore, { min: 0 }]]);
  const mi = matInfo(p);
  if (typeof mi === 'string') errors.push(mi);
  if (typeof list === 'string') errors.push(list);
  if (errors.length || typeof list === 'string' || typeof mi === 'string') return failed(inputs, errors, standards);
  const secs: RoundD['secs'] = []; let z = 0;
  for (const [len, od] of list) { secs.push({ od, len, z0: z, z1: z + len }); z += len; }
  const minOd = Math.min(...secs.map((s) => s.od));
  if (bore > 0 && bore > minOd - 1) return failed(inputs, ['The bore must be at least 0.5 mm smaller than the smallest outer diameter on each side (wall at least 0.5 mm).'], standards);
  const total = z, maxOd = Math.max(...secs.map((s) => s.od));
  const massKg = secs.reduce((a, s) => a + (Math.PI / 4) * (s.od * s.od - bore * bore) * s.len, 0) * mi.density, warnings: string[] = [];
  if (bore > 0 && secs.some((s) => (s.od - bore) / 2 < 2)) warnings.push('Wall thickness is under 2 mm in at least one section.');
  if (total > 20 * maxOd) warnings.push('Part is very slender (length over 20 x diameter); check for bending.');
  return done(inputs, [R('Overall length', total, 'mm', 2), R('Largest diameter', maxOd, 'mm', 2), R('Sections', secs.length), R('Approx. mass', massKg, 'kg', 3)], ['Plain cylinders in the order typed, square ends, no chamfers, keyways or threads.'], warnings, standards, { bore, secs, total, maxOd, massKg, color: mi.color, matId: mi.id } as RoundD);
}
/** the drawing of a turned part is the round-part drawing, without the editable-dimension links (they point at the fixed fields of the round family) */
const turnedViews = (c: RoundD): DrawView[] => roundViews(c).map((v) => ({ ...v, ents: v.ents.map((e) => (e.t === 'dim' ? { ...e, edit: undefined } : e)) }));
const turnedVariants: Variant[] = [
  V('CT-SHAFT3', 'Stepped shaft 25 / 30 / 25', turnedDefaults),
  V('CT-IDLER', 'Idler shaft with 4 steps', { ...turnedDefaults, sections: '25,20; 15,25; 300,30; 15,25; 25,20' }),
  V('CT-BUSH', 'Flanged bush, bore 20', { ...turnedDefaults, sections: '10,50; 30,36', bore: 20, material: 'Nylon PA6' }),
  V('CT-PIN', 'Headed pin', { ...turnedDefaults, sections: '6,16; 44,10', material: 'S235 Steel' }),
  V('CT-ROLLER', 'Roller with journals', { ...turnedDefaults, sections: '20,20; 200,60; 20,20', bore: 0 }),
  V('CT-SPOOL', 'Spool / grooved wheel', { ...turnedDefaults, sections: '8,70; 14,50; 8,70', bore: 20, material: 'UHMW-PE' }),
];

/* ---------------- stepped block ---------------- */
export const STEPPED_FIELDS: ParamField[] = [
  { key: 'slabs', label: 'Blocks from the bottom up: width,depth,height', kind: 'text', rows: 4, help: 'Example: 100,60,10; 70,40,20 is a 100 x 60 x 10 base with a 70 x 40 x 20 block centred on top. Up to 8 blocks.' },
  { key: 'holeDia', label: 'Hole diameter through every block at the centre (0 = none)', unit: 'mm', kind: 'number', min: 0, max: 1000, step: 0.1 },
  ...MATERIAL_FIELDS,
];
export const steppedDefaults: Params = { slabs: '100,60,10; 70,40,20', holeDia: 0, material: 'S235 Steel', density: 7.85 };
export interface SteppedD { slabs: { w: number; d: number; h: number; z0: number; z1: number }[]; hole: number; W: number; D: number; H: number; massKg: number; color: string; matId: string }

export function calcStepped(p: Params): CalcResult {
  const hole = Number.isFinite(num(p, 'holeDia')) ? num(p, 'holeDia') : NaN;
  const list = parseList(String(p.slabs ?? ''), 3, 'block', 8);
  const inputs = [R('Blocks', String(p.slabs ?? '')), R('Hole', hole, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['hole diameter', hole, { min: 0 }]]);
  const mi = matInfo(p);
  if (typeof mi === 'string') errors.push(mi);
  if (typeof list === 'string') errors.push(list);
  if (errors.length || typeof list === 'string' || typeof mi === 'string') return failed(inputs, errors, standards);
  const slabs: SteppedD['slabs'] = []; let z = 0;
  for (const [w, d, h] of list) { slabs.push({ w, d, h, z0: z, z1: z + h }); z += h; }
  if (hole > 0 && hole > Math.min(...slabs.map((s) => Math.min(s.w, s.d))) - 2) return failed(inputs, ['The hole must leave at least 1 mm of wall in the smallest block.'], standards);
  const W = Math.max(...slabs.map((s) => s.w)), D = Math.max(...slabs.map((s) => s.d)), H = z;
  const massKg = slabs.reduce((a, s) => a + (s.w * s.d - (hole > 0 ? Math.PI * hole * hole / 4 : 0)) * s.h, 0) * mi.density;
  return done(inputs, [R('Overall width', W, 'mm', 2), R('Overall depth', D, 'mm', 2), R('Overall height', H, 'mm', 2), R('Blocks', slabs.length), R('Approx. mass', massKg, 'kg', 3)], ['Blocks are stacked in the order typed and centred on each other, square edges, no chamfers.'], [], standards, { slabs, hole, W, D, H, massKg, color: mi.color, matId: mi.id } as SteppedD);
}
/** centred on x = y = 0 in 3D; the part's own height is Z (as for every other family) */
export const steppedGeo = (c: SteppedD): GeoPart[] => [{ id: 'stepped', name: 'Part', color: c.color, explode: [0, 0, 0],
  prims: c.slabs.map((s) => ({ kind: 'prism' as const, outer: rectPoly(-s.w / 2, -s.d / 2, s.w / 2, s.d / 2), holes: c.hole > 0 ? [{ c: [0, 0] as [number, number], r: c.hole / 2 }] : [], z0: s.z0, z1: s.z1 })) }];
export function steppedViews(c: SteppedD): DrawView[] {
  const { slabs, W, D, H } = c, hw = W / 2, hd = D / 2;
  const front: ModelEnt[] = slabs.map((s) => rect(-s.w / 2, s.z0, s.w / 2, s.z1));
  const side: ModelEnt[] = slabs.map((s) => rect(-s.d / 2, s.z0, s.d / 2, s.z1));
  slabs.forEach((s, i) => { front.push(dim([hw, s.z0], [hw, s.z1], -12 - (i % 2) * 0, f2(s.h))); front.push(dim([-s.w / 2, s.z1], [s.w / 2, s.z1], 8 + 8 * i, f2(s.w))); });
  if (slabs.length > 1) front.push(dim([-hw, 0], [-hw, H], 14, `${fmt(H, 2)} overall`));
  slabs.forEach((s, i) => side.push(dim([-s.d / 2, s.z1], [s.d / 2, s.z1], 8 + 8 * i, f2(s.d))));
  const plan: ModelEnt[] = [...slabs.map((s) => rect(-s.w / 2, -s.d / 2, s.w / 2, s.d / 2))];
  if (c.hole > 0) plan.push({ t: 'circle', c: [0, 0], r: c.hole / 2, layer: 'hidden' }, line([-hw - 4, 0], [hw + 4, 0], 'centre'), line([0, -hd - 4], [0, hd + 4], 'centre'), dim([-c.hole / 2, 0], [c.hole / 2, 0], hd + 8, `Ø${fmt(c.hole, 2)}`));
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SIDE VIEW', ents: side }, { name: 'PLAN VIEW', ents: plan }, geoView(steppedGeo(c), 'iso')];
}
const steppedVariants: Variant[] = [
  V('CS-2STEP', 'Two-step block 100 x 60', steppedDefaults),
  V('CS-PLINTH', 'Plinth with riser', { ...steppedDefaults, slabs: '120,80,12; 80,50,30', holeDia: 18 }),
  V('CS-3STEP', 'Three-step block', { ...steppedDefaults, slabs: '150,100,10; 110,70,15; 70,40,20' }),
  V('CS-BEARBLOCK', 'Bearing pedestal', { ...steppedDefaults, slabs: '140,60,12; 60,60,40', holeDia: 20, material: 'C45 Steel' }),
  V('CS-SPACER', 'Stepped spacer block', { ...steppedDefaults, slabs: '60,60,8; 40,40,8; 25,25,8', holeDia: 8, material: 'Al 6061-T6' }),
  V('CS-WEAR', 'Wear block', { ...steppedDefaults, slabs: '80,40,6; 60,25,14', material: 'UHMW-PE' }),
];

export const TURNED_FAMILIES: Omit<Family, 'basic' | 'autofill'>[] = [
  { ...base, id: 'custom_turned', name: 'Custom turned part (enter any number of steps)', description: 'A round part with up to 12 steps: type length and diameter of each step (and an optional bore). The Image to 3D page fills these values from a photo of a shaft, roller or bush.',
    keywords: ['custom', 'turned', 'shaft', 'stepped shaft', 'roller', 'bush', 'pin', 'photo', 'image', 'profile', 'values', 'own size'], applications: ['any turned conveyor component'],
    fields: TURNED_FIELDS, defaults: turnedDefaults, variants: turnedVariants, calculate: calcTurned, views: turnedViews, geo: roundGeo, solid: (Rr, c) => primsSolid(Rr, roundGeo(c)),
    asm: (c) => (c.bore > 0 ? { role: 'bore', bore: c.bore, sections: c.secs.map((s: RoundD['secs'][number]) => ({ d: s.od, z0: s.z0, z1: s.z1 })) } : { role: 'shaft', sections: c.secs.map((s: RoundD['secs'][number]) => ({ d: s.od, z0: s.z0, z1: s.z1 })) }),
    partNo: (p) => `CT-${String(p.sections ?? '').split(';').length}S`, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (c) => [kd('Overall length', c.total), kd('Largest dia', c.maxOd), ...(c.bore > 0 ? [kd('Bore', c.bore)] : [])], notes: (c) => [`${c.secs.length} STEP(S)${c.bore > 0 ? `, BORE Ø${f2(c.bore)}` : ', SOLID'}`, 'NO CHAMFERS, KEYWAYS OR THREADS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'custom_stepped', name: 'Custom stepped block (enter blocks)', description: 'Stacked rectangular blocks centred on each other, each typed as width, depth and height, with an optional centre hole. The Image to 3D page fills these values from a front-view photo.',
    keywords: ['custom', 'stepped', 'block', 'pedestal', 'plinth', 'stack', 'photo', 'image', 'values', 'own size'], applications: ['stepped blocks, pedestals, spacers'],
    fields: STEPPED_FIELDS, defaults: steppedDefaults, variants: steppedVariants, calculate: calcStepped, views: steppedViews, geo: steppedGeo, solid: (Rr, c) => primsSolid(Rr, steppedGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `CS-${String(p.slabs ?? '').split(';').length}B`, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (c) => [kd('Width', c.W), kd('Depth', c.D), kd('Height', c.H)], notes: (c) => [`${c.slabs.length} BLOCK(S) STACKED AND CENTRED${c.hole > 0 ? `, CENTRE HOLE Ø${f2(c.hole)}` : ''}`, 'SQUARE EDGES, NO CHAMFERS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
];
