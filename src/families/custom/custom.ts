import type { Family, Variant } from '../../core/family.ts';
import type { CalcResult, ParamField, Params, Pt } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { rectPoly } from '../../core/prims.ts';
import { primsSolid } from '../../core/primsSolid.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { fmt, num } from '../../core/util.ts';
import { MATERIALS, material } from '../../data/materials.ts';
import { R, circ, cross, dim, done, ed, failed, line, rect, validate } from '../extra/common.ts';
import { buildShape, formatCutouts, formatHoles, formatPoints } from './shape.ts';
import type { Shape } from './shape.ts';

/* Custom, value-based components: the user types the sizes and the app builds the 2D drawing, 3D model, mass and exports.
 * Nothing here changes the existing families. */

export const CUSTOM_MATERIAL = 'Custom material';
const MAT_OPTIONS = [...MATERIALS.map((m) => ({ value: m.id, label: m.id })), { value: CUSTOM_MATERIAL, label: 'Other material (enter density)' }];
export const isCustom = (p: Params): boolean => p.material === CUSTOM_MATERIAL;
export const MATERIAL_FIELDS: ParamField[] = [
  { key: 'material', label: 'Material', kind: 'select', options: MAT_OPTIONS },
  { key: 'density', label: 'Density of the material', unit: 'g/cm³', kind: 'number', min: 0.1, max: 25, step: 0.01, showIf: isCustom, help: 'Only used for "Other material". Steel is about 7.85, aluminium 2.7, plastics 0.9 to 1.4.' },
];
/** density in kg/mm^3 and colour for the chosen material, or an error text */
export function matInfo(p: Params): { density: number; color: string; id: string } | string {
  if (isCustom(p)) { const d = num(p, 'density'); return Number.isFinite(d) && d >= 0.1 && d <= 25 ? { density: d * 1e-6, color: '#a9b3bd', id: CUSTOM_MATERIAL } : 'Enter a density between 0.1 and 25 g/cm³ for the other material.'; }
  const m = material(String(p.material));
  return m ? { density: m.density, color: m.color, id: m.id } : 'Unknown material.';
}
export const V = (id: string, name: string, params: Params): Variant => ({ id, name, params });
export const f2 = (n: unknown) => String(+Number(n).toFixed(2));
export const kd = (label: string, v: number, unit = 'mm') => ({ label, value: f2(v), unit });

/* ======================= 1. Custom block / plate with hole grid ======================= */
export const BLOCK_FIELDS: ParamField[] = [
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 1, max: 5000, step: 1 },
  { key: 'width', label: 'Width', unit: 'mm', kind: 'number', min: 1, max: 5000, step: 1 },
  { key: 'height', label: 'Thickness / height', unit: 'mm', kind: 'number', min: 0.5, max: 1000, step: 0.5 },
  { key: 'cols', label: 'Hole columns (along length), 0 = no holes', kind: 'number', min: 0, max: 30, step: 1 },
  { key: 'rows', label: 'Hole rows (along width)', kind: 'number', min: 0, max: 30, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'holeDia', label: 'Hole diameter', unit: 'mm', kind: 'number', min: 1, max: 500, step: 0.1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'edgeX', label: 'Edge distance along length', unit: 'mm', kind: 'number', min: 1, max: 2000, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  { key: 'edgeY', label: 'Edge distance along width', unit: 'mm', kind: 'number', min: 1, max: 2000, step: 1, showIf: (p) => num(p, 'cols') > 0 },
  ...MATERIAL_FIELDS,
];
export const blockDefaults: Params = { length: 120, width: 60, height: 10, cols: 2, rows: 2, holeDia: 8, edgeX: 15, edgeY: 15, material: 'S235 Steel', density: 7.85 };
export interface BlockD { L: number; W: number; t: number; nx: number; ny: number; dh: number; ex: number; ey: number; px: number; py: number; centres: Pt[]; massKg: number; color: string; matId: string }

export function calcBlock(p: Params): CalcResult {
  const L = num(p, 'length'), W = num(p, 'width'), t = num(p, 'height');
  const nx = Number.isFinite(num(p, 'cols')) ? num(p, 'cols') : 0, ny = nx > 0 ? num(p, 'rows') : 0;
  const dh = nx > 0 ? num(p, 'holeDia') : 0, ex = nx > 0 ? num(p, 'edgeX') : 0, ey = nx > 0 ? num(p, 'edgeY') : 0;
  const inputs = [R('Length', L, 'mm'), R('Width', W, 'mm'), R('Thickness / height', t, 'mm'), R('Hole columns', nx), R('Hole rows', ny), R('Hole dia', dh, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['length', L, { min: 1 }], ['width', W, { min: 1 }], ['thickness / height', t, { min: 0.5 }], ['hole columns', nx, { min: 0, int: true }], ['hole rows', ny, { min: 0, int: true }]]);
  const mi = matInfo(p);
  if (typeof mi === 'string') errors.push(mi);
  if (!errors.length && nx > 0) {
    errors.push(...validate([['hole diameter', dh, { min: 1 }], ['edge distance along length', ex, { min: 1 }], ['edge distance along width', ey, { min: 1 }]]));
    if (!errors.length) {
      if (ny < 1) errors.push('Hole rows must be at least 1 when columns are set (or set columns to 0 for no holes).');
      if (nx > 1 && 2 * ex >= L) errors.push('The edge distances along the length leave no room between the holes.');
      if (ny > 1 && 2 * ey >= W) errors.push('The edge distances along the width leave no room between the holes.');
      if (dh >= Math.min(L, W)) errors.push('The hole is larger than the part.');
      if (dh / 2 > ex || dh / 2 > ey) errors.push('The hole would break through the edge. Increase the edge distance or reduce the hole diameter.');
    }
  }
  if (errors.length || typeof mi === 'string') return failed(inputs, errors, standards);
  const px = nx > 1 ? (L - 2 * ex) / (nx - 1) : 0, py = ny > 1 ? (W - 2 * ey) / (ny - 1) : 0, warnings: string[] = [];
  if (nx > 0 && (ex < 1.5 * dh || ey < 1.5 * dh)) warnings.push('Edge distance is under 1.5 x hole diameter; the edge may tear out.');
  if ((nx > 1 && px < dh + 2) || (ny > 1 && py < dh + 2)) warnings.push('Holes are very close together.');
  const centres: Pt[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) centres.push([nx > 1 ? ex + i * px : L / 2, ny > 1 ? ey + j * py : W / 2]);
  const massKg = (L * W - centres.length * (Math.PI / 4) * dh * dh) * t * mi.density;
  return done(inputs, [R('Hole pitch along length', px, 'mm', 2), R('Hole pitch along width', py, 'mm', 2), R('Number of holes', centres.length), R('Approx. mass', massKg, 'kg', 3)], ['Square corners, plain through holes, no chamfers.', 'Mass uses the density of the chosen material.'], warnings, standards, { L, W, t, nx, ny, dh, ex, ey, px, py, centres, massKg, color: mi.color, matId: mi.id } as BlockD);
}
export const blockGeo = (c: BlockD): GeoPart[] => [{ id: 'block', name: 'Part', color: c.color, explode: [0, 0, 0], prims: [{ kind: 'prism', outer: rectPoly(0, 0, c.L, c.W), holes: c.centres.map((q) => ({ c: q, r: c.dh / 2 })), z0: 0, z1: c.t }] }];
export function blockViews(c: BlockD): DrawView[] {
  const { L, W, t, nx, ny, dh, ex, ey, px, py } = c;
  const plan: ModelEnt[] = [rect(0, 0, L, W), ...c.centres.flatMap((q): ModelEnt[] => [circ(q, dh / 2), line([q[0] - dh, q[1]], [q[0] + dh, q[1]], 'centre'), line([q[0], q[1] - dh], [q[0], q[1] + dh], 'centre')]),
    dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`, ed('length', L)), dim([L, 0], [L, W], -10, `${fmt(W, 2)}`, ed('width', W))];
  if (nx > 0) plan.push(dim([0, W], [ex, W], 8, `${fmt(ex, 1)}`, ed('edgeX', ex)), dim([0, 0], [0, ey], 8, `${fmt(ey, 1)}`, ed('edgeY', ey)), { t: 'text', p: [L / 2, W + 14], s: `${nx * ny} x Ø${fmt(dh, 2)} THROUGH`, h: 3.2, layer: 'text', anchor: 'c', edit: { key: 'holeDia', value: dh } });
  if (nx > 1) plan.push(dim([ex, W], [ex + px, W], 18, `${fmt(px, 2)} pitch`));
  if (ny > 1) plan.push(dim([L, ey], [L, ey + py], -22, `${fmt(py, 2)} pitch`));
  return [{ name: 'PLAN VIEW', ents: plan }, { name: 'SIDE VIEW', ents: [rect(0, 0, L, t), dim([L, 0], [L, t], -8, `${fmt(t, 2)}`, ed('height', t))] }, geoView(blockGeo(c), 'iso')];
}

/* ======================= 2. Custom round part (up to three diameters, optional bore) ======================= */
export const ROUND_FIELDS: ParamField[] = [
  { key: 'bore', label: 'Through bore diameter (0 = solid)', unit: 'mm', kind: 'number', min: 0, max: 2000, step: 0.1 },
  { key: 'od1', label: 'Section 1 outer diameter', unit: 'mm', kind: 'number', min: 1, max: 2000, step: 0.1 },
  { key: 'len1', label: 'Section 1 length', unit: 'mm', kind: 'number', min: 0.5, max: 10000, step: 0.5 },
  { key: 'od2', label: 'Section 2 outer diameter (0 = not used)', unit: 'mm', kind: 'number', min: 0, max: 2000, step: 0.1 },
  { key: 'len2', label: 'Section 2 length', unit: 'mm', kind: 'number', min: 0, max: 10000, step: 0.5, showIf: (p) => num(p, 'od2') > 0 },
  { key: 'od3', label: 'Section 3 outer diameter (0 = not used)', unit: 'mm', kind: 'number', min: 0, max: 2000, step: 0.1, showIf: (p) => num(p, 'od2') > 0 },
  { key: 'len3', label: 'Section 3 length', unit: 'mm', kind: 'number', min: 0, max: 10000, step: 0.5, showIf: (p) => num(p, 'od2') > 0 && num(p, 'od3') > 0 },
  ...MATERIAL_FIELDS,
];
export const roundDefaults: Params = { bore: 0, od1: 25, len1: 100, od2: 20, len2: 40, od3: 0, len3: 0, material: 'C45 Steel', density: 7.85 };
export interface RoundD { bore: number; secs: { od: number; len: number; z0: number; z1: number }[]; total: number; maxOd: number; massKg: number; color: string; matId: string }

export function calcRound(p: Params): CalcResult {
  const bore = Number.isFinite(num(p, 'bore')) ? num(p, 'bore') : NaN;
  const raw = [[num(p, 'od1'), num(p, 'len1')], [Number.isFinite(num(p, 'od2')) ? num(p, 'od2') : 0, Number.isFinite(num(p, 'len2')) ? num(p, 'len2') : 0], [Number.isFinite(num(p, 'od3')) ? num(p, 'od3') : 0, Number.isFinite(num(p, 'len3')) ? num(p, 'len3') : 0]];
  const inputs = [R('Bore', bore, 'mm'), ...raw.flatMap(([od, len], i) => (od > 0 || i === 0 ? [R(`Section ${i + 1} dia`, od, 'mm'), R(`Section ${i + 1} length`, len, 'mm')] : [])), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['bore', bore, { min: 0 }], ['section 1 diameter', raw[0][0], { min: 1 }], ['section 1 length', raw[0][1], { min: 0.5 }]]);
  const mi = matInfo(p);
  if (typeof mi === 'string') errors.push(mi);
  if (!errors.length) {
    if (raw[1][0] > 0 && !(raw[1][1] > 0)) errors.push('Section 2 has a diameter but no length.');
    if (raw[1][0] <= 0 && (raw[1][1] > 0 || raw[2][0] > 0)) errors.push('Fill section 2 before using section 3 (or set its length to 0).');
    if (raw[2][0] > 0 && !(raw[2][1] > 0)) errors.push('Section 3 has a diameter but no length.');
    if (raw[2][0] <= 0 && raw[2][1] > 0) errors.push('Section 3 has a length but no diameter.');
  }
  const secs: RoundD['secs'] = [];
  if (!errors.length) {
    let z = 0;
    for (const [od, len] of raw) if (od > 0 && len > 0) { secs.push({ od, len, z0: z, z1: z + len }); z += len; }
    const minOd = Math.min(...secs.map((s) => s.od));
    if (bore > 0 && bore > minOd - 1) errors.push('The bore must be at least 0.5 mm smaller than the smallest outer diameter on each side (wall at least 0.5 mm).');
  }
  if (errors.length || typeof mi === 'string') return failed(inputs, errors, standards);
  const total = secs[secs.length - 1].z1, maxOd = Math.max(...secs.map((s) => s.od));
  const vol = secs.reduce((a, s) => a + (Math.PI / 4) * (s.od * s.od - bore * bore) * s.len, 0), massKg = vol * mi.density, warnings: string[] = [];
  if (bore > 0 && secs.some((s) => (s.od - bore) / 2 < 2)) warnings.push('Wall thickness is under 2 mm in at least one section.');
  if (total > 20 * maxOd) warnings.push('Part is very slender (length over 20 x diameter); check for bending.');
  return done(inputs, [R('Overall length', total, 'mm', 2), R('Largest diameter', maxOd, 'mm', 2), R('Sections', secs.length), R('Approx. mass', massKg, 'kg', 3)], ['Plain cylinders, square ends, no chamfers, keyways or threads.', 'Sections are stacked in order along the axis.'], warnings, standards, { bore, secs, total, maxOd, massKg, color: mi.color, matId: mi.id } as RoundD);
}
export const roundGeo = (c: RoundD): GeoPart[] => [{ id: 'round', name: 'Part', color: c.color, explode: [0, 0, 0], prims: c.secs.map((s) => ({ kind: 'tube' as const, rIn: c.bore / 2, rOut: s.od / 2, z0: s.z0, z1: s.z1 })) }];
export function roundViews(c: RoundD): DrawView[] {
  const { bore, secs, total, maxOd } = c, mr = maxOd / 2;
  const side: ModelEnt[] = [...secs.map((s): ModelEnt => ({ t: 'poly', closed: true, layer: 'outline', pts: [[-s.od / 2, s.z0], [s.od / 2, s.z0], [s.od / 2, s.z1], [-s.od / 2, s.z1]] })), line([0, -6], [0, total + 6], 'centre')];
  if (bore > 0) side.push(line([-bore / 2, 0], [-bore / 2, total], 'hidden'), line([bore / 2, 0], [bore / 2, total], 'hidden'));
  secs.forEach((s, i) => side.push(dim([mr, s.z0], [mr, s.z1], -12, `${fmt(s.len, 2)}`, ed(`len${i + 1}`, s.len))));
  if (secs.length > 1) side.push(dim([-mr, 0], [-mr, total], 14, `${fmt(total, 2)} overall`));
  const end: ModelEnt[] = [...secs.map((s) => circ([0, 0], s.od / 2)), ...(bore > 0 ? [circ([0, 0], bore / 2, 'hidden')] : []), ...cross([0, 0], mr + 4)];
  secs.forEach((s, i) => end.push(dim([-s.od / 2, 0], [s.od / 2, 0], -(mr + 8 + 10 * i), `Ø${fmt(s.od, 2)}`, ed(`od${i + 1}`, s.od))));
  if (bore > 0) end.push(dim([-bore / 2, 0], [bore / 2, 0], mr + 8, `Ø${fmt(bore, 2)} BORE`, ed('bore', bore)));
  return [{ name: 'SIDE VIEW', ents: side }, { name: 'END VIEW', ents: end }, geoView(roundGeo(c), 'iso')];
}

/* ======================= 3. Custom outline part (flat shape typed as x,y values, extruded) ======================= */
export const OUTLINE_FIELDS: ParamField[] = [
  { key: 'outline', label: 'Outline points (x,y in mm)', kind: 'text', rows: 4, help: 'Go once around the edge, for example: 0,0; 80,0; 80,20; 20,20; 20,60; 0,60. The shape is moved so its lower-left corner is at 0,0.' },
  { key: 'thickness', label: 'Thickness', unit: 'mm', kind: 'number', min: 0.5, max: 500, step: 0.5 },
  { key: 'roundHoles', label: 'Round holes (x,y,diameter)', kind: 'text', rows: 2, help: 'Optional. For example: 10,45,6; 60,10,6. Positions use the same corner as the outline.' },
  { key: 'cutouts', label: 'Inner cut-outs (points, use | between shapes)', kind: 'text', rows: 2, help: 'Optional. For example a slot: 30,15; 170,15; 170,25; 30,25' },
  ...MATERIAL_FIELDS,
];
export const outlineDefaults: Params = { outline: '0,0; 80,0; 80,20; 20,20; 20,60; 0,60', thickness: 5, roundHoles: '10,45,6; 60,10,6', cutouts: '', material: 'S235 Steel', density: 7.85 };
export interface OutlineD extends Shape { t: number; massKg: number; color: string; matId: string }

export function calcOutline(p: Params): CalcResult {
  const t = num(p, 'thickness');
  const inputs = [R('Outline points', String(p.outline ?? '').split(/[;\n]+/).filter((s) => s.trim()).length), R('Thickness', t, 'mm'), R('Material', String(p.material))];
  const standards = ['User-specified dimensions'];
  const errors = validate([['thickness', t, { min: 0.5, max: 500 }]]);
  const mi = matInfo(p);
  if (typeof mi === 'string') errors.push(mi);
  const built = buildShape(String(p.outline ?? ''), String(p.cutouts ?? ''), String(p.roundHoles ?? ''));
  errors.push(...built.errors);
  if (errors.length || !built.shape || typeof mi === 'string') return failed(inputs, errors, standards);
  const s = built.shape, warnings: string[] = [];
  if (s.outline.length > 400) warnings.push(`The outline has ${s.outline.length} points. Very detailed outlines make heavy drawings; simplify it if the drawing is slow.`);
  const massKg = s.area * t * mi.density;
  const calculated = [R('Overall length', s.L, 'mm', 2), R('Overall width', s.W, 'mm', 2), R('Area (net)', s.area, 'mm²', 1), R('Outline length', s.perim, 'mm', 1), R('Round holes', s.holes.length), R('Inner cut-outs', s.cutouts.length), R('Approx. mass', massKg, 'kg', 3),
    ...s.holes.map((q, i) => R(`Hole ${i + 1} (x, y, dia)`, `${fmt(q.c[0], 2)}, ${fmt(q.c[1], 2)}, ${fmt(q.r * 2, 2)}`, 'mm'))];
  return done(inputs, calculated, ['The part is the outline extruded straight to the thickness: no bends, chamfers or radii other than what the points describe.', 'Curves are represented by short straight segments.'], warnings, standards, { ...s, t, massKg, color: mi.color, matId: mi.id } as OutlineD);
}
export const outlineGeo = (c: OutlineD): GeoPart[] => [{ id: 'outline', name: 'Part', color: c.color, explode: [0, 0, 0], prims: [{ kind: 'prism', outer: c.outline, holes: [...c.cutouts.map((poly) => ({ poly })), ...c.holes.map((q) => ({ c: q.c, r: q.r }))], z0: 0, z1: c.t }] }];
export function outlineViews(c: OutlineD): DrawView[] {
  const { L, W, t } = c;
  const plan: ModelEnt[] = [{ t: 'poly', closed: true, layer: 'outline', pts: c.outline }, ...c.cutouts.map((pts): ModelEnt => ({ t: 'poly', closed: true, layer: 'outline', pts })),
    ...c.holes.flatMap((q): ModelEnt[] => [circ(q.c, q.r), line([q.c[0] - q.r - 2, q.c[1]], [q.c[0] + q.r + 2, q.c[1]], 'centre'), line([q.c[0], q.c[1] - q.r - 2], [q.c[0], q.c[1] + q.r + 2], 'centre')]),
    dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`), dim([L, 0], [L, W], -10, `${fmt(W, 2)}`)];
  const groups = new Map<number, number>();
  for (const q of c.holes) groups.set(+(q.r * 2).toFixed(3), (groups.get(+(q.r * 2).toFixed(3)) ?? 0) + 1);
  [...groups].forEach(([d, n], i) => plan.push({ t: 'text', p: [L / 2, W + 8 + 6 * i], s: `${n} x Ø${fmt(d, 2)} THROUGH`, h: 3.2, layer: 'text', anchor: 'c' }));
  return [{ name: 'PLAN VIEW', ents: plan }, { name: 'SIDE VIEW', ents: [rect(0, 0, L, t), dim([L, 0], [L, t], -8, `${fmt(t, 2)}`, ed('thickness', t))] }, geoView(outlineGeo(c), 'iso')];
}
const boundsOf = (p: Params): string => { const b = buildShape(String(p.outline ?? ''), '', ''); return b.shape ? `${Math.round(b.shape.L)}x${Math.round(b.shape.W)}` : 'X'; };

/* ======================= variants ======================= */
const blockVariants: Variant[] = [[60, 40, 10], [100, 50, 10], [120, 60, 10], [150, 80, 12], [200, 100, 16], [250, 120, 20]].map(([L, W, t]) => V(`CB-${L}x${W}x${t}`, `Custom block ${L} x ${W} x ${t} mm`, { ...blockDefaults, length: L, width: W, height: t, edgeX: 15, edgeY: 15 }));
const roundVariants: Variant[] = [
  V('CR-D25-L100', 'Custom round bar Ø25 x 100 with Ø20 x 40 step', roundDefaults),
  V('CR-D40-B20-L60', 'Custom sleeve Ø40, bore 20, length 60', { ...roundDefaults, bore: 20, od1: 40, len1: 60, od2: 0, len2: 0 }),
  V('CR-D60-W30', 'Custom wheel / disc Ø60 x 30', { ...roundDefaults, od1: 60, len1: 30, od2: 0, len2: 0, material: 'Nylon PA6' }),
  V('CR-D30-L200', 'Custom spindle Ø30 x 200', { ...roundDefaults, od1: 30, len1: 200, od2: 0, len2: 0 }),
  V('CR-3STEP', 'Custom 3-step shaft 30 / 25 / 20', { ...roundDefaults, od1: 30, len1: 60, od2: 25, len2: 80, od3: 20, len3: 40 }),
  V('CR-D80-B30', 'Custom hub Ø80, bore 30, length 40', { ...roundDefaults, bore: 30, od1: 80, len1: 40, od2: 50, len2: 20, material: 'C45 Steel' }),
];
const outlineVariants: Variant[] = [
  V('CO-LBRACKET', 'L-shaped bracket plate 80 x 60', outlineDefaults),
  V('CO-NOTCH', 'Notched transfer plate 150 x 80', { ...outlineDefaults, outline: '0,0; 150,0; 150,80; 100,80; 100,60; 50,60; 50,80; 0,80', thickness: 6, roundHoles: '15,15,6.5; 135,15,6.5' }),
  V('CO-TRAP', 'Trapezoid guide plate 120 x 30', { ...outlineDefaults, outline: '0,0; 120,0; 100,30; 20,30', thickness: 8, roundHoles: '20,10,5; 100,10,5', material: 'UHMW-PE' }),
  V('CO-GUSSET', 'Triangular gusset 100 x 100', { ...outlineDefaults, outline: '0,0; 100,0; 0,100', thickness: 10, roundHoles: '20,20,8' }),
  V('CO-SLOT', 'Flat bar with slot 200 x 40', { ...outlineDefaults, outline: '0,0; 200,0; 200,40; 0,40', thickness: 8, roundHoles: '', cutouts: '30,15; 170,15; 170,25; 30,25' }),
  V('CO-WEDGE', 'Chain guide wedge 300 x 25', { ...outlineDefaults, outline: '0,0; 300,0; 300,12; 0,25', thickness: 10, roundHoles: '30,8,6; 270,6,4', material: 'UHMW-PE' }),
  V('CO-WINDOW', 'Window plate 120 x 90', { ...outlineDefaults, outline: '0,0; 120,0; 120,90; 0,90', thickness: 5, roundHoles: '10,10,5; 110,10,5; 10,80,5; 110,80,5', cutouts: '30,25; 90,25; 90,65; 30,65' }),
];

const allMats = MATERIALS.map((m) => m.id);
export const base = { category: 'J', subcategory: 'Custom parts (value-based)', materials: allMats, standards: ['User-specified dimensions'], related: ['plate', 'bushing', 'shaft'] };

export const CUSTOM_FAMILIES: Omit<Family, 'basic' | 'autofill'>[] = [
  { ...base, id: 'custom_block', name: 'Custom block / plate (enter sizes)', description: 'Any rectangular part: type length, width, thickness, an optional hole grid and the material. Drawing, 3D model, mass and all exports are created from those values.',
    keywords: ['custom', 'block', 'plate', 'bar', 'flat bar', 'rectangular', 'bracket', 'spacer block', 'own size', 'any size', 'values'], applications: ['any conveyor component made from flat or square stock'],
    fields: BLOCK_FIELDS, defaults: blockDefaults, variants: blockVariants, calculate: calcBlock, views: blockViews, geo: blockGeo, solid: (Rr, c) => primsSolid(Rr, blockGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `CB-${p.length}x${p.width}x${p.height}`, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (c) => [kd('Length', c.L), kd('Width', c.W), kd('Thickness', c.t)], notes: (c) => [c.centres.length ? `${c.centres.length} x Ø${f2(c.dh)} THROUGH HOLES` : 'NO HOLES', 'SQUARE CORNERS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'custom_round', name: 'Custom round part (enter diameters and lengths)', description: 'Any turned part with up to three diameters and an optional through bore: shafts, spindles, sleeves, hubs, discs and wheels. Type the values; the app does the rest.',
    keywords: ['custom', 'round', 'cylinder', 'shaft', 'sleeve', 'disc', 'wheel', 'hub', 'spindle', 'turned part', 'own size', 'any size', 'values'], applications: ['any turned or round conveyor component'],
    fields: ROUND_FIELDS, defaults: roundDefaults, variants: roundVariants, calculate: calcRound, views: roundViews, geo: roundGeo, solid: (Rr, c) => primsSolid(Rr, roundGeo(c)),
    asm: (c) => (c.bore > 0 ? { role: 'bore', bore: c.bore, sections: c.secs.map((s: RoundD['secs'][number]) => ({ d: s.od, z0: s.z0, z1: s.z1 })) } : { role: 'shaft', sections: c.secs.map((s: RoundD['secs'][number]) => ({ d: s.od, z0: s.z0, z1: s.z1 })) }),
    partNo: (p) => `CR-D${p.od1}-L${p.len1}`, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (c) => [kd('Overall length', c.total), kd('Largest dia', c.maxOd), ...(c.bore > 0 ? [kd('Bore', c.bore)] : [])], notes: (c) => [`${c.secs.length} SECTION(S)${c.bore > 0 ? `, BORE Ø${f2(c.bore)}` : ', SOLID'}`, 'NO CHAMFERS, KEYWAYS OR THREADS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'custom_outline', name: 'Custom outline part (enter shape points)', description: 'Any flat part of any shape: type the corner points of the outline (and optional holes or cut-outs) and a thickness. This is also what the Image to 3D page creates from a photo.',
    keywords: ['custom', 'outline', 'profile', 'bracket', 'guide', 'flat part', 'laser cut', 'image', 'photo', 'trace', 'own shape', 'any shape', 'values', 'points'], applications: ['brackets, guides, cut plates, traced parts'],
    fields: OUTLINE_FIELDS, defaults: outlineDefaults, variants: outlineVariants, calculate: calcOutline, views: outlineViews, geo: outlineGeo, solid: (Rr, c) => primsSolid(Rr, outlineGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `CO-${boundsOf(p)}x${p.thickness}`, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (c) => [kd('Length', c.L), kd('Width', c.W), kd('Thickness', c.t)],
    notes: (c) => [`OUTLINE OF ${c.outline.length} POINTS, ${c.holes.length} ROUND HOLE(S), ${c.cutouts.length} CUT-OUT(S)`, 'EXTRUDED STRAIGHT, NO BENDS OR CHAMFERS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
];

/** Builds the text parameters for a custom_outline part from already-measured shapes (used by the Image to 3D page). */
export function outlineParams(shape: Pick<Shape, 'outline' | 'cutouts' | 'holes'>, thickness: number, materialId: string): Params {
  return { ...outlineDefaults, outline: formatPoints(shape.outline), cutouts: formatCutouts(shape.cutouts), roundHoles: formatHoles(shape.holes), thickness, material: materialId };
}
