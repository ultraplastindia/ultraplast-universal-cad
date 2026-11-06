import type { CalcResult, ParamField, Params, Row } from '../../core/types.ts';
import { fmt, num } from '../../core/util.ts';
import { BEARINGS } from '../../data/bearings.ts';
import { material } from '../../data/materials.ts';

export const BEARING_MATERIALS = ['Chrome Steel 100Cr6', 'SS 440C'];
const isCustom = (p: Params) => p.designation === 'CUSTOM';
export const BEARING_FIELDS: ParamField[] = [
  { key: 'designation', label: 'Designation (deep groove ball)', kind: 'select', options: [...BEARINGS.map((b) => ({ value: b.id, label: `${b.id}  (${b.d} x ${b.D} x ${b.B})` })), { value: 'CUSTOM', label: 'Custom dimensions' }] },
  { key: 'd', label: 'Bore d', unit: 'mm', kind: 'number', min: 3, max: 200, step: 0.5, showIf: isCustom },
  { key: 'D', label: 'Outside diameter D', unit: 'mm', kind: 'number', min: 8, max: 400, step: 0.5, showIf: isCustom },
  { key: 'B', label: 'Width B', unit: 'mm', kind: 'number', min: 2, max: 100, step: 0.5, showIf: isCustom },
  { key: 'material', label: 'Material', kind: 'select', options: BEARING_MATERIALS.map((m) => ({ value: m, label: m })) },
];
export interface BearingDerived { custom: boolean; d: number; D: number; B: number; dm: number; Dw: number; Z: number; riO: number; roI: number; massKg: number; matId: string }
const row = (label: string, v: number | string, unit?: string, dp = 3): Row => ({ label, value: typeof v === 'number' ? fmt(v, dp) : v, unit });

export function calcBearing(p: Params): CalcResult {
  const errors: string[] = [], warnings: string[] = [], assumptions: string[] = [];
  const std = BEARINGS.find((b) => b.id === p.designation);
  const d = std ? std.d : num(p, 'd'), D = std ? std.D : num(p, 'D'), B = std ? std.B : num(p, 'B');
  const mat = material(String(p.material));
  const inputs: Row[] = [row('Designation', String(p.designation)), row('Bore d', d, 'mm'), row('Outside dia D', D, 'mm'), row('Width B', B, 'mm'), row('Material', String(p.material))];
  const standards = ['ISO 15 (radial bearings, boundary dimensions)'];
  const fail = (): CalcResult => ({ ok: false, inputs, calculated: [], assumptions, warnings, errors, standards, derived: null });
  if (!std && p.designation !== 'CUSTOM') errors.push('Unknown designation.');
  ([['bore d', d], ['outside diameter D', D], ['width B', B]] as [string, number][]).forEach(([n, v]) => { if (!Number.isFinite(v) || v <= 0) errors.push(`Missing or invalid value: ${n}.`); });
  if (!mat) errors.push('Unknown material.');
  if (errors.length) return fail();
  if (D - d < 6) errors.push('Outside diameter must exceed bore by at least 6 mm.');
  if (B > D - d) warnings.push('Width exceeds radial section height; unusual for a deep-groove bearing.');
  if (errors.length) return fail();
  const dm = (D + d) / 2, Dw = 0.3 * (D - d), Z = Math.max(6, Math.floor((Math.PI * dm) / (1.65 * Dw)));
  const riO = dm / 2 - 0.3 * Dw, roI = dm / 2 + 0.3 * Dw;
  const ringVol = Math.PI * B * ((riO ** 2 - (d / 2) ** 2) + ((D / 2) ** 2 - roI ** 2));
  const ballVol = Z * (Math.PI / 6) * Dw ** 3;
  const massKg = (ringVol + ballVol) * mat!.density;
  assumptions.push('Outer dimensions (d, D, B) follow ISO 15. Ball size (0.3 x radial section), ball count and ring sections are ILLUSTRATIVE only.');
  assumptions.push('No raceway grooves, cage, seals or corner radii modelled; balls slightly overlap the rings to suggest groove depth.');
  warnings.push('Load ratings, clearances and life are NOT calculated: use manufacturer data for selection.');
  warnings.push('PRELIMINARY: envelope model for layout and assembly only.');
  const derived: BearingDerived = { custom: !std, d, D, B, dm, Dw, Z, riO, roI, massKg, matId: String(p.material) };
  return { ok: true, inputs, calculated: [row('Pitch (mean) diameter dm', dm, 'mm'), row('Ball diameter (illustrative)', Dw, 'mm'), row('Ball count (illustrative)', Z), row('Approx. mass', massKg, 'kg', 4)], assumptions, warnings, errors, standards, derived };
}
