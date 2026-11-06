import type { CalcResult, ParamField, Params, Pt } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { polyProps, rectPoly } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { num, fmt } from '../../core/util.ts';
import { material } from '../../data/materials.ts';
import { R, circ, cross, dim, done, ed, failed, line, rect, validate } from './common.ts';

/* ---------------- Wear strip with mounting holes ---------------- */
export const STRIP_MATERIALS = ['UHMW-PE', 'Nylon PA6', 'Acetal POM', 'SS 304'];
export const STRIP_FIELDS: ParamField[] = [
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 6000, step: 1 },
  { key: 'width', label: 'Width', unit: 'mm', kind: 'number', min: 8, max: 300, step: 0.5 },
  { key: 'thickness', label: 'Thickness', unit: 'mm', kind: 'number', min: 2, max: 40, step: 0.5 },
  { key: 'holes', label: 'Number of mounting holes', kind: 'number', min: 0, max: 40, step: 1 },
  { key: 'holeDia', label: 'Hole diameter', unit: 'mm', kind: 'number', min: 2, max: 30, step: 0.1, showIf: (p) => num(p, 'holes') > 0 },
  { key: 'edge', label: 'Edge distance to first hole', unit: 'mm', kind: 'number', min: 3, max: 500, step: 1, showIf: (p) => num(p, 'holes') > 1 },
  { key: 'material', label: 'Material', kind: 'select', options: STRIP_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const stripDefaults: Params = { length: 1000, width: 25, thickness: 8, holes: 10, holeDia: 6.5, edge: 50, material: 'UHMW-PE' };
export interface StripD { L: number; W: number; t: number; n: number; dh: number; edge: number; pitch: number; centres: Pt[]; massKg: number; matId: string }
export function calcStrip(p: Params): CalcResult {
  const L = num(p, 'length'), W = num(p, 'width'), t = num(p, 'thickness'), n = num(p, 'holes'), dh = n > 0 ? num(p, 'holeDia') : 0, e = n > 1 ? num(p, 'edge') : L / 2, mat = material(String(p.material));
  const inputs = [R('Length', L, 'mm'), R('Width', W, 'mm'), R('Thickness', t, 'mm'), R('Holes', n), R('Hole dia', dh, 'mm'), R('Edge distance', e, 'mm'), R('Material', String(p.material))];
  const standards = ['Dimensions are user-specified'];
  const errors = validate([['length', L, { min: 20 }], ['width', W, { min: 8 }], ['thickness', t, { min: 2 }], ['number of holes', n, { min: 0, int: true }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && n > 0) {
    errors.push(...validate([['hole diameter', dh, { min: 2 }], ['edge distance', e, { min: 3 }]]));
    if (!errors.length) {
      if (dh > W - 6) errors.push('Hole is too large for the strip width (needs 3 mm of material each side).');
      if (n > 1 && 2 * e >= L) errors.push('Edge distances leave no room between the end holes.');
    }
  }
  if (errors.length) return failed(inputs, errors, standards);
  const pitch = n > 1 ? (L - 2 * e) / (n - 1) : 0, warnings: string[] = [];
  if (n > 0 && e < 1.5 * dh) warnings.push('Edge distance is under 1.5 x hole diameter; edge may tear out.');
  if (n > 1 && pitch < 3 * dh) warnings.push('Hole pitch is under 3 x hole diameter.');
  if (n > 0 && t < dh * 0.8) warnings.push('Thickness is small relative to the hole diameter; use a washer or countersunk screw.');
  const centres: Pt[] = Array.from({ length: n }, (_, i) => [n > 1 ? e + i * pitch : L / 2, W / 2] as Pt);
  const massKg = (L * W - n * (Math.PI / 4) * dh * dh) * t * mat!.density;
  return done(inputs, [R('Hole pitch', pitch, 'mm', 2), R('Approx. mass', massKg, 'kg', 4)], ['Plain through holes (no countersink). Thermal expansion of plastics is not accounted for: allow slotted holes on long strips.'], [...warnings, ...(mat!.metal ? [] : ['Plastic strips expand noticeably with temperature; use slotted holes or fix at one point only.'])], standards, { L, W, t, n, dh, edge: e, pitch, centres, massKg, matId: String(p.material) } satisfies StripD);
}
export const stripGeo = (c: StripD): GeoPart[] => [{ id: 'strip', name: 'Wear strip', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: rectPoly(0, 0, c.L, c.W), holes: c.centres.map((q) => ({ c: q, r: c.dh / 2 })), z0: 0, z1: c.t }] }];
export function stripViews(c: StripD): DrawView[] {
  const { L, W, t, n, dh, edge, pitch } = c;
  const plan: ModelEnt[] = [rect(0, 0, L, W), ...c.centres.flatMap((q): ModelEnt[] => [circ(q, dh / 2), line([q[0], q[1] - dh], [q[0], q[1] + dh], 'centre')]),
    dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`, ed('length', L)), dim([L, 0], [L, W], -10, `${fmt(W, 2)}`, ed('width', W))];
  if (n > 1) { plan.push(dim([0, W], [edge, W], 8, `${fmt(edge, 1)}`, ed('edge', edge)), dim([edge, W], [edge + pitch, W], 18, `${fmt(pitch, 2)} pitch`)); }
  if (n > 0) plan.push({ t: 'text', p: [L / 2, W + 30], s: `${n} x Ø${fmt(dh, 2)} THROUGH`, h: 3.2, layer: 'text', anchor: 'c', edit: { key: 'holeDia', value: dh } });
  return [{ name: 'PLAN VIEW', ents: plan }, { name: 'SIDE VIEW', ents: [rect(0, 0, L, t), dim([L, 0], [L, t], -8, `${fmt(t, 2)}`, ed('thickness', t))] }, geoView(stripGeo(c), 'iso')];
}

/* ---------------- Equal / unequal angle (guide rail, side guide) ---------------- */
export const ANGLE_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6'];
export const ANGLE_FIELDS: ParamField[] = [
  { key: 'a', label: 'Leg A (horizontal)', unit: 'mm', kind: 'number', min: 10, max: 300, step: 0.5 },
  { key: 'b', label: 'Leg B (vertical)', unit: 'mm', kind: 'number', min: 10, max: 300, step: 0.5 },
  { key: 't', label: 'Thickness', unit: 'mm', kind: 'number', min: 1, max: 30, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 8000, step: 1 },
  { key: 'material', label: 'Material', kind: 'select', options: ANGLE_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const angleDefaults: Params = { a: 40, b: 40, t: 4, length: 1000, material: 'S235 Steel' };
export interface AngleD { a: number; b: number; t: number; L: number; A: number; cx: number; cy: number; Ix: number; Iy: number; massKg: number; matId: string; pts: Pt[] }
export function calcAngle(p: Params): CalcResult {
  const a = num(p, 'a'), b = num(p, 'b'), t = num(p, 't'), L = num(p, 'length'), mat = material(String(p.material));
  const inputs = [R('Leg A', a, 'mm'), R('Leg B', b, 'mm'), R('Thickness', t, 'mm'), R('Length', L, 'mm'), R('Material', String(p.material))];
  const standards = ['Section properties by polygon integration (no profile standard applied)'];
  const errors = validate([['leg A', a, { min: 10 }], ['leg B', b, { min: 10 }], ['thickness', t, { min: 1 }], ['length', L, { min: 20 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && t >= Math.min(a, b) / 2) errors.push('Thickness must be less than half of the shorter leg.');
  if (errors.length) return failed(inputs, errors, standards);
  const pts: Pt[] = [[0, 0], [a, 0], [a, t], [t, t], [t, b], [0, b]], pr = polyProps(pts), massKg = pr.A * L * mat!.density;
  return done(inputs, [R('Cross-section area', pr.A, 'mm²', 1), R('Centroid x, y', `${fmt(pr.cx, 2)}, ${fmt(pr.cy, 2)}`, 'mm'), R('Ix about centroid', pr.Ix, 'mm⁴', 0), R('Iy about centroid', pr.Iy, 'mm⁴', 0), R('Approx. mass', massKg, 'kg', 3)],
    ['Sharp inner and outer corners (no root or toe radii). Principal axes are not computed.'], [], standards, { a, b, t, L, ...pr, massKg, matId: String(p.material), pts } satisfies AngleD);
}
export const angleGeo = (c: AngleD): GeoPart[] => [{ id: 'angle', name: 'Angle profile', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: c.pts, holes: [], z0: 0, z1: c.L }] }];
export function angleViews(c: AngleD): DrawView[] {
  const { a, b, t, L } = c;
  return [
    { name: 'END VIEW (PROFILE)', ents: [{ t: 'poly', pts: c.pts, closed: true, layer: 'outline' }, dim([0, 0], [a, 0], -8, `A ${fmt(a, 2)}`, ed('a', a)), dim([0, 0], [0, b], 8, `B ${fmt(b, 2)}`, ed('b', b)), dim([a, 0], [a, t], -8, `t ${fmt(t, 2)}`, ed('t', t)), { t: 'text', p: [c.cx, c.cy], s: '+', h: 3, layer: 'centre', anchor: 'c' }] },
    { name: 'SIDE VIEW', ents: [rect(0, 0, L, b), dim([0, 0], [L, 0], -10, `${fmt(L, 2)}`, ed('length', L)), line([0, t], [L, t], 'hidden')] },
    geoView(angleGeo(c), 'iso'),
  ];
}

/* ---------------- Rectangular hollow section (structural / aluminium profile) ---------------- */
export const RHS_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6'];
export const RHS_FIELDS: ParamField[] = [
  { key: 'w', label: 'Width', unit: 'mm', kind: 'number', min: 10, max: 400, step: 1 },
  { key: 'h', label: 'Height', unit: 'mm', kind: 'number', min: 10, max: 400, step: 1 },
  { key: 't', label: 'Wall thickness', unit: 'mm', kind: 'number', min: 1, max: 30, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 20, max: 12000, step: 1 },
  { key: 'load', label: 'Mid-span point load (optional)', unit: 'N', kind: 'number', min: 0, max: 1000000, step: 10, help: '0 = skip beam check' },
  { key: 'span', label: 'Span between supports', unit: 'mm', kind: 'number', min: 20, max: 12000, step: 1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: RHS_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const rhsDefaults: Params = { w: 40, h: 40, t: 3, length: 1000, load: 0, span: 1000, sf: 1.5, material: 'S235 Steel' };
export interface RhsD { w: number; h: number; t: number; L: number; A: number; Ix: number; Iy: number; massKg: number; matId: string }
export function calcRhs(p: Params): CalcResult {
  const w = num(p, 'w'), h = num(p, 'h'), t = num(p, 't'), L = num(p, 'length'), F = num(p, 'load') || 0, span = num(p, 'span') || L, sf = num(p, 'sf') || 1.5, mat = material(String(p.material));
  const inputs = [R('Width', w, 'mm'), R('Height', h, 'mm'), R('Wall', t, 'mm'), R('Length', L, 'mm'), R('Load', F, 'N'), R('Span', span, 'mm'), R('Material', String(p.material))];
  const standards = ['Euler-Bernoulli beam theory (simply supported, central point load)'];
  const errors = validate([['width', w, { min: 10 }], ['height', h, { min: 10 }], ['wall thickness', t, { min: 1 }], ['length', L, { min: 20 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length && 2 * t >= Math.min(w, h)) errors.push('Wall thickness is too large for the section size.');
  if (errors.length) return failed(inputs, errors, standards);
  const A = w * h - (w - 2 * t) * (h - 2 * t), Ix = (w * h ** 3 - (w - 2 * t) * (h - 2 * t) ** 3) / 12, Iy = (h * w ** 3 - (h - 2 * t) * (w - 2 * t) ** 3) / 12, massKg = A * L * mat!.density, warnings: string[] = [];
  const calc = [R('Cross-section area', A, 'mm²', 1), R('Ix (strong axis)', Ix, 'mm⁴', 0), R('Iy', Iy, 'mm⁴', 0), R('Section modulus Wx', Ix / (h / 2), 'mm³', 0), R('Approx. mass', massKg, 'kg', 3)];
  if (w / t > 40 || h / t > 40) warnings.push('Slender walls (b/t > 40): local buckling is not checked.');
  if (F > 0 && mat!.E) {
    const M = (F * span) / 4, sigma = (M * (h / 2)) / Ix, defl = (F * span ** 3) / (48 * mat!.E * 1000 * Ix);
    calc.push(R('Max bending moment F·span/4', M / 1000, 'N·m', 1), R('Bending stress', sigma, 'MPa', 1), R('Mid-span deflection', defl, 'mm', 2));
    if (mat!.yieldMPa && sigma > mat!.yieldMPa / sf) warnings.push('Section FAILS the preliminary bending-stress check.');
    if (defl > span / 250) warnings.push(`Deflection exceeds span/250 (${fmt(span / 250, 2)} mm).`);
  }
  return done(inputs, calc, ['Sharp corners (no corner radii). Self-weight, lateral-torsional buckling, welds and connections are ignored.'], warnings, standards, { w, h, t, L, A, Ix, Iy, massKg, matId: String(p.material) } satisfies RhsD);
}
export const rhsGeo = (c: RhsD): GeoPart[] => [{ id: 'rhs', name: 'Hollow section', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: rectPoly(-c.w / 2, -c.h / 2, c.w / 2, c.h / 2), holes: [{ poly: rectPoly(-c.w / 2 + c.t, -c.h / 2 + c.t, c.w / 2 - c.t, c.h / 2 - c.t) }], z0: 0, z1: c.L }] }];
export function rhsViews(c: RhsD): DrawView[] {
  const { w, h, t, L } = c;
  return [
    { name: 'END VIEW (PROFILE)', ents: [rect(-w / 2, -h / 2, w / 2, h / 2), rect(-w / 2 + t, -h / 2 + t, w / 2 - t, h / 2 - t), { t: 'hatch', x0: -w / 2, y0: -h / 2, x1: w / 2, y1: -h / 2 + t }, { t: 'hatch', x0: -w / 2, y0: h / 2 - t, x1: w / 2, y1: h / 2 },
      dim([-w / 2, -h / 2], [w / 2, -h / 2], -8, `${fmt(w, 2)}`, ed('w', w)), dim([-w / 2, -h / 2], [-w / 2, h / 2], 8, `${fmt(h, 2)}`, ed('h', h)), dim([w / 2 - t, h / 2], [w / 2, h / 2], 8, `t ${fmt(t, 2)}`, ed('t', t)), ...cross([0, 0], Math.max(w, h) / 2 + 3)] },
    { name: 'SIDE VIEW', ents: [rect(0, -h / 2, L, h / 2), dim([0, -h / 2], [L, -h / 2], -10, `${fmt(L, 2)}`, ed('length', L))] },
    geoView(rhsGeo(c), 'iso'),
  ];
}
