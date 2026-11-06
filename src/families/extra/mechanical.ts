import type { CalcResult, ParamField, Params } from '../../core/types.ts';
import type { GeoPart } from '../../core/prims.ts';
import { hexPoly } from '../../core/prims.ts';
import { geoView } from '../../core/project.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { num, fmt } from '../../core/util.ts';
import { material } from '../../data/materials.ts';
import { R, circ, cross, dim, done, ed, failed, line, rect, validate } from './common.ts';

/* ---------------- Bushing / sleeve / spacer ---------------- */
export const BUSH_MATERIALS = ['C45 Steel', 'SS 304', 'Brass CuZn39Pb3', 'Al 6061-T6', 'Nylon PA6', 'Acetal POM', 'UHMW-PE'];
export const BUSH_FIELDS: ParamField[] = [
  { key: 'boreDia', label: 'Bore diameter', unit: 'mm', kind: 'number', min: 2, max: 300, step: 0.5 },
  { key: 'outerDia', label: 'Outside diameter', unit: 'mm', kind: 'number', min: 4, max: 400, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 1, max: 500, step: 0.5 },
  { key: 'flangeDia', label: 'Flange diameter', unit: 'mm', kind: 'number', min: 0, max: 500, step: 0.5, help: '0 = plain sleeve / spacer (no flange)' },
  { key: 'flangeThk', label: 'Flange thickness', unit: 'mm', kind: 'number', min: 0, max: 50, step: 0.5, showIf: (p) => num(p, 'flangeDia') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: BUSH_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const bushDefaults: Params = { boreDia: 25, outerDia: 32, length: 30, flangeDia: 0, flangeThk: 4, material: 'Brass CuZn39Pb3' };
export interface BushD { bore: number; od: number; L: number; fd: number; ft: number; massKg: number; matId: string }
export function calcBushing(p: Params): CalcResult {
  const bore = num(p, 'boreDia'), od = num(p, 'outerDia'), L = num(p, 'length'), fd = num(p, 'flangeDia') || 0, ft = fd > 0 ? num(p, 'flangeThk') : 0, mat = material(String(p.material));
  const inputs = [R('Bore', bore, 'mm'), R('Outside dia', od, 'mm'), R('Length', L, 'mm'), R('Flange dia', fd, 'mm'), R('Flange thickness', ft, 'mm'), R('Material', String(p.material))];
  const standards = ['Dimensions are user-specified (no standard table applies)'];
  const errors = validate([['bore', bore, { min: 2 }], ['outside diameter', od, { min: 4 }], ['length', L, { min: 1 }], ['flange thickness', ft, { min: 0 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length) {
    if (od <= bore) errors.push('Outside diameter must exceed the bore.');
    if (fd > 0 && fd <= od) errors.push('Flange diameter must exceed the outside diameter.');
    if (fd > 0 && (ft <= 0 || ft >= L)) errors.push('Flange thickness must be above 0 and below the length.');
  }
  if (errors.length) return failed(inputs, errors, standards);
  const wall = (od - bore) / 2, warnings: string[] = [];
  if (wall < 1.5) warnings.push(`Wall thickness ${fmt(wall, 2)} mm is very thin; risk of distortion when pressed on a shaft.`);
  const vol = (Math.PI / 4) * (od * od - bore * bore) * (L - ft) + (fd > 0 ? (Math.PI / 4) * (fd * fd - bore * bore) * ft : 0), massKg = vol * mat!.density;
  return done(inputs, [R('Wall thickness', wall, 'mm', 2), R('Approx. mass', massKg, 'kg', 4)], ['Plain bore: no chamfers, grooves or keyways. Fits/tolerances are not specified.'], warnings, standards, { bore, od, L, fd, ft, massKg, matId: String(p.material) } satisfies BushD);
}
export const bushGeo = (c: BushD): GeoPart[] => [{ id: 'bush', name: c.fd > 0 ? 'Flanged bushing' : 'Sleeve / spacer', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0],
  prims: c.fd > 0 ? [{ kind: 'tube', rIn: c.bore / 2, rOut: c.od / 2, z0: c.ft, z1: c.L }, { kind: 'tube', rIn: c.bore / 2, rOut: c.fd / 2, z0: 0, z1: c.ft }] : [{ kind: 'tube', rIn: c.bore / 2, rOut: c.od / 2, z0: 0, z1: c.L }] }];
export function bushViews(c: BushD): DrawView[] {
  const { bore, od, L, fd, ft } = c, Ro = Math.max(od, fd) / 2, b = bore / 2;
  const front: ModelEnt[] = [circ([0, 0], od / 2), circ([0, 0], b), ...(fd > 0 ? [circ([0, 0], fd / 2)] : []), ...cross([0, 0], Ro + 4), dim([-Ro, -Ro], [Ro, -Ro], -8, `Ø${fmt(Math.max(od, fd), 2)}`), dim([-b, -Ro], [b, -Ro], -18, `Ø${fmt(bore, 2)}`, ed('boreDia', bore))];
  const prof = (s: 1 | -1): ModelEnt => ({ t: 'poly', closed: true, layer: 'outline', pts: fd > 0 ? [[0, s * b], [0, s * fd / 2], [ft, s * fd / 2], [ft, s * od / 2], [L, s * od / 2], [L, s * b]] : [[0, s * b], [0, s * od / 2], [L, s * od / 2], [L, s * b]] });
  const sec: ModelEnt[] = [prof(1), prof(-1), { t: 'hatch', x0: 0, y0: b, x1: L, y1: od / 2 }, { t: 'hatch', x0: 0, y0: -od / 2, x1: L, y1: -b }, line([-4, 0], [L + 4, 0], 'centre'),
    dim([0, -Ro], [L, -Ro], -8, `${fmt(L, 2)}`, ed('length', L)), dim([L, -od / 2], [L, od / 2], -10, `Ø${fmt(od, 2)}`, ed('outerDia', od))];
  if (fd > 0) { sec.push({ t: 'hatch', x0: 0, y0: od / 2, x1: ft, y1: fd / 2 }, { t: 'hatch', x0: 0, y0: -fd / 2, x1: ft, y1: -od / 2 }, dim([0, fd / 2], [ft, fd / 2], 8, `${fmt(ft, 2)}`, ed('flangeThk', ft))); }
  return [{ name: 'FRONT VIEW', ents: front }, { name: 'SECTION A-A', ents: sec }, geoView(bushGeo(c), 'iso')];
}

/* ---------------- Conveyor roller (tube with end caps and stub shafts) ---------------- */
export const ROLLER_MATERIALS = ['S235 Steel', 'SS 304', 'Al 6061-T6', 'Nylon PA6', 'Acetal POM', 'UHMW-PE'];
export const ROLLER_FIELDS: ParamField[] = [
  { key: 'tubeOD', label: 'Tube outside diameter', unit: 'mm', kind: 'number', min: 20, max: 300, step: 0.5 },
  { key: 'wall', label: 'Tube wall thickness', unit: 'mm', kind: 'number', min: 1, max: 30, step: 0.1 },
  { key: 'tubeLength', label: 'Tube length', unit: 'mm', kind: 'number', min: 50, max: 3000, step: 1 },
  { key: 'capThk', label: 'End cap thickness', unit: 'mm', kind: 'number', min: 3, max: 40, step: 0.5 },
  { key: 'stubDia', label: 'Stub shaft diameter', unit: 'mm', kind: 'number', min: 6, max: 100, step: 0.5 },
  { key: 'stubLength', label: 'Stub length (each end)', unit: 'mm', kind: 'number', min: 5, max: 200, step: 0.5 },
  { key: 'load', label: 'Distributed load on roller (optional)', unit: 'N', kind: 'number', min: 0, max: 100000, step: 10, help: '0 = skip bending check' },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'load') > 0 },
  { key: 'material', label: 'Tube material', kind: 'select', options: ROLLER_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export const rollerDefaults: Params = { tubeOD: 50, wall: 2.5, tubeLength: 400, capThk: 6, stubDia: 12, stubLength: 25, load: 0, sf: 2, material: 'S235 Steel' };
export interface RollerD { od: number; wall: number; L: number; cap: number; stub: number; sl: number; id: number; massKg: number; matId: string }
export function calcRoller(p: Params): CalcResult {
  const od = num(p, 'tubeOD'), t = num(p, 'wall'), L = num(p, 'tubeLength'), cap = num(p, 'capThk'), stub = num(p, 'stubDia'), sl = num(p, 'stubLength'), F = num(p, 'load') || 0, sf = num(p, 'sf') || 2, mat = material(String(p.material));
  const inputs = [R('Tube OD', od, 'mm'), R('Wall', t, 'mm'), R('Length', L, 'mm'), R('Cap thickness', cap, 'mm'), R('Stub dia', stub, 'mm'), R('Stub length', sl, 'mm'), R('Load', F, 'N'), R('Material', String(p.material))];
  const standards = ['Beam theory (simply supported tube); no roller standard applied'];
  const errors = validate([['tube OD', od, { min: 20 }], ['wall', t, { min: 1 }], ['length', L, { min: 50 }], ['cap thickness', cap, { min: 3 }], ['stub diameter', stub, { min: 6 }], ['stub length', sl, { min: 5 }]]);
  if (!mat) errors.push('Unknown material.');
  if (!errors.length) {
    if (od - 2 * t < 8) errors.push('Wall is too thick for this outside diameter.');
    if (stub > od - 2 * t - 4) errors.push('Stub shaft must be at least 4 mm smaller than the tube inside diameter.');
    if (2 * cap >= L) errors.push('End caps are longer than the tube.');
  }
  if (errors.length) return failed(inputs, errors, standards);
  const id = od - 2 * t, I = (Math.PI / 64) * (od ** 4 - id ** 4), warnings: string[] = [];
  const vol = (Math.PI / 4) * (od * od - id * id) * L + 2 * (Math.PI / 4) * id * id * cap + 2 * (Math.PI / 4) * stub * stub * sl, massKg = vol * mat!.density;
  const calc = [R('Tube inside diameter', id, 'mm'), R('Second moment of area I', I, 'mm⁴', 0), R('Approx. mass (tube, caps, stubs)', massKg, 'kg', 3)];
  if (t < 2 && mat!.metal) warnings.push('Wall under 2 mm: dents easily; check impact and wear.');
  if (F > 0) {
    if (!mat!.E) warnings.push('No modulus on file; bending check skipped.');
    else {
      const E = mat!.E * 1000, defl = (5 * F * L ** 3) / (384 * E * I), sigma = ((F * L) / 8) * (od / 2) / I;
      calc.push(R('Mid-span deflection 5FL³/(384EI)', defl, 'mm', 3), R('Bending stress F L c / (8 I)', sigma, 'MPa', 1));
      if (defl > L / 1000) warnings.push(`Deflection ${fmt(defl, 2)} mm exceeds L/1000 (${fmt(L / 1000, 2)} mm); belts/chains may mistrack.`);
      if (mat!.yieldMPa && sigma > mat!.yieldMPa / sf) warnings.push('Tube FAILS the preliminary bending-stress check.');
    }
  }
  return done(inputs, calc, ['Simply supported at the tube ends with a uniformly distributed load. Caps and stubs fused to the tube; bearing seats/tolerances not modelled.'], warnings, standards, { od, wall: t, L, cap, stub, sl, id, massKg, matId: String(p.material) } satisfies RollerD);
}
export function rollerGeo(c: RollerD): GeoPart[] {
  const color = material(c.matId)?.color ?? '#999';
  return [
    { id: 'tube', name: 'Tube', color, explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: c.id / 2, rOut: c.od / 2, z0: 0, z1: c.L }] },
    { id: 'caps', name: 'End caps', color: '#7f8a96', explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: 0, rOut: c.id / 2, z0: 0, z1: c.cap }, { kind: 'tube', rIn: 0, rOut: c.id / 2, z0: c.L - c.cap, z1: c.L }] },
    { id: 'stubs', name: 'Stub shafts', color: '#b9c2cc', explode: [0, 0, 0], prims: [{ kind: 'tube', rIn: 0, rOut: c.stub / 2, z0: -c.sl, z1: c.cap }, { kind: 'tube', rIn: 0, rOut: c.stub / 2, z0: c.L - c.cap, z1: c.L + c.sl }] },
  ];
}
export function rollerViews(c: RollerD): DrawView[] {
  const { od, id, L, cap, stub, sl } = c, T = L + sl;
  const half = (s: 1 | -1): ModelEnt[] => [
    { t: 'poly', closed: true, layer: 'outline', pts: [[0, s * id / 2], [0, s * od / 2], [L, s * od / 2], [L, s * id / 2]] },
    { t: 'poly', closed: true, layer: 'outline', pts: [[0, 0], [0, s * id / 2], [cap, s * id / 2], [cap, s * stub / 2], [-sl, s * stub / 2], [-sl, 0]] },
    { t: 'poly', closed: true, layer: 'outline', pts: [[L, 0], [L, s * id / 2], [L - cap, s * id / 2], [L - cap, s * stub / 2], [L + sl, s * stub / 2], [L + sl, 0]] },
    { t: 'hatch', x0: 0, y0: s > 0 ? id / 2 : -od / 2, x1: L, y1: s > 0 ? od / 2 : -id / 2 },
  ];
  const sec: ModelEnt[] = [...half(1), ...half(-1), line([-sl - 6, 0], [T + 6, 0], 'centre'),
    dim([0, -od / 2], [L, -od / 2], -10, `${fmt(L, 2)}`, ed('tubeLength', L)), dim([-sl, -od / 2], [0, -od / 2], -10, `${fmt(sl, 2)}`, ed('stubLength', sl)),
    dim([L, -od / 2], [L, od / 2], -10, `Ø${fmt(od, 2)}`, ed('tubeOD', od)), dim([-sl, -stub / 2], [-sl, stub / 2], 12, `Ø${fmt(stub, 2)}`, ed('stubDia', stub))];
  const end: ModelEnt[] = [circ([0, 0], od / 2), circ([0, 0], id / 2, 'hidden'), circ([0, 0], stub / 2), ...cross([0, 0], od / 2 + 4)];
  return [{ name: 'SECTION A-A', ents: sec }, { name: 'END VIEW', ents: end }, geoView(rollerGeo(c), 'iso')];
}

/* ---------------- Hexagonal shaft ---------------- */
export const HEXSHAFT_FIELDS: ParamField[] = [
  { key: 'af', label: 'Width across flats', unit: 'mm', kind: 'number', min: 5, max: 100, step: 0.5 },
  { key: 'length', label: 'Length', unit: 'mm', kind: 'number', min: 10, max: 4000, step: 1 },
  { key: 'torque', label: 'Transmitted torque (optional)', unit: 'N·m', kind: 'number', min: 0, max: 100000, step: 1 },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'torque') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: ['C45 Steel', 'SS 304', 'Al 6061-T6'].map((m) => ({ value: m, label: m })) },
];
export const hexShaftDefaults: Params = { af: 22, length: 500, torque: 0, sf: 3, material: 'C45 Steel' };
export interface HexD { s: number; e: number; L: number; massKg: number; matId: string }
export function calcHexShaft(p: Params): CalcResult {
  const s = num(p, 'af'), L = num(p, 'length'), T = num(p, 'torque') || 0, sf = num(p, 'sf') || 3, mat = material(String(p.material));
  const inputs = [R('Across flats', s, 'mm'), R('Length', L, 'mm'), R('Torque', T, 'N·m'), R('Material', String(p.material))];
  const standards = ['ISO 272 (across-flats series)'];
  const errors = validate([['across flats', s, { min: 5 }], ['length', L, { min: 10 }]]);
  if (!mat) errors.push('Unknown material.');
  if (errors.length) return failed(inputs, errors, standards);
  const area = (Math.sqrt(3) / 2) * s * s, e = s / Math.cos(Math.PI / 6), massKg = area * L * mat!.density, warnings: string[] = [];
  const calc = [R('Width across corners', e, 'mm', 2), R('Cross-section area', area, 'mm²', 1), R('Approx. mass', massKg, 'kg', 3)];
  if (L / s > 25) warnings.push('Slenderness L/s above 25: check deflection and critical speed.');
  if (T > 0 && mat!.yieldMPa) {
    const tau = (16 * T * 1000) / (Math.PI * s ** 3), tauA = (0.577 * mat!.yieldMPa) / sf;
    calc.push(R('Shear stress (inscribed-circle estimate)', tau, 'MPa', 1), R('Allowable shear', tauA, 'MPa', 1));
    if (tau > tauA) warnings.push('Hex shaft FAILS the preliminary torsion check (conservative inscribed-circle estimate).');
  }
  return done(inputs, calc, ['Torsion estimated with the inscribed circle (conservative). Bending, fatigue and corner stress ignored.'], warnings, standards, { s, e, L, massKg, matId: String(p.material) } satisfies HexD);
}
export const hexShaftGeo = (c: HexD): GeoPart[] => [{ id: 'hex', name: 'Hex shaft', color: material(c.matId)?.color ?? '#999', explode: [0, 0, 0], prims: [{ kind: 'prism', outer: hexPoly(c.s), holes: [], z0: 0, z1: c.L }] }];
export function hexShaftViews(c: HexD): DrawView[] {
  const { s, e, L } = c;
  return [
    { name: 'END VIEW', ents: [{ t: 'poly', pts: hexPoly(s), closed: true, layer: 'outline' }, ...cross([0, 0], e / 2 + 4), dim([-s / 2, -e / 2], [s / 2, -e / 2], -8, `s ${fmt(s, 2)}`, ed('af', s))] },
    { name: 'SIDE VIEW', ents: [rect(0, -s / 2, L, s / 2), line([-4, 0], [L + 4, 0], 'centre'), dim([0, -s / 2], [L, -s / 2], -10, `${fmt(L, 2)}`, ed('length', L))] },
    geoView(hexShaftGeo(c), 'iso'),
  ];
}
