import type { CalcResult, ParamField, Params, Row } from '../../core/types.ts';
import { fmt, num } from '../../core/util.ts';
import { material } from '../../data/materials.ts';

export const SHAFT_MATERIALS = ['C45 Steel', 'SS 304', 'Al 6061-T6'];
export const SHAFT_FIELDS: ParamField[] = [
  { key: 'd1', label: 'Section 1 diameter', unit: 'mm', kind: 'number', min: 3, max: 300, step: 0.5 },
  { key: 'l1', label: 'Section 1 length', unit: 'mm', kind: 'number', min: 1, max: 3000, step: 1 },
  { key: 'd2', label: 'Section 2 diameter', unit: 'mm', kind: 'number', min: 0, max: 300, step: 0.5, help: 'Length 0 = section not used' },
  { key: 'l2', label: 'Section 2 length', unit: 'mm', kind: 'number', min: 0, max: 3000, step: 1 },
  { key: 'd3', label: 'Section 3 diameter', unit: 'mm', kind: 'number', min: 0, max: 300, step: 0.5 },
  { key: 'l3', label: 'Section 3 length', unit: 'mm', kind: 'number', min: 0, max: 3000, step: 1 },
  { key: 'torque', label: 'Transmitted torque (optional)', unit: 'N·m', kind: 'number', min: 0, max: 100000, step: 1, help: '0 = skip torsion check' },
  { key: 'sf', label: 'Safety factor on yield', kind: 'number', min: 1, max: 10, step: 0.1, showIf: (p) => num(p, 'torque') > 0 },
  { key: 'material', label: 'Material', kind: 'select', options: SHAFT_MATERIALS.map((m) => ({ value: m, label: m })) },
];

export interface ShaftSection { d: number; l: number; x0: number; idx: number }
export interface ShaftDerived { sections: ShaftSection[]; total: number; massKg: number; matId: string }
const row = (label: string, v: number | string, unit?: string, dp = 3): Row => ({ label, value: typeof v === 'number' ? fmt(v, dp) : v, unit });

export function calcShaft(p: Params): CalcResult {
  const errors: string[] = [], warnings: string[] = [], assumptions: string[] = [];
  const raw = [[num(p, 'd1'), num(p, 'l1')], [num(p, 'd2'), num(p, 'l2')], [num(p, 'd3'), num(p, 'l3')]];
  const T = num(p, 'torque') || 0, sf = num(p, 'sf') || 3, mat = material(String(p.material));
  const inputs: Row[] = [...raw.flatMap(([d, l], i) => [row(`Section ${i + 1} dia`, d, 'mm'), row(`Section ${i + 1} length`, l, 'mm')]), row('Torque', T, 'N·m'), row('Material', String(p.material))];
  const standards = ['ISO 286 (limits and fits, user-specified tolerances only)'];
  const fail = (): CalcResult => ({ ok: false, inputs, calculated: [], assumptions, warnings, errors, standards, derived: null });
  if (!mat || !mat.metal) errors.push('Unknown or unsupported shaft material.');
  const sections: ShaftSection[] = [];
  let x = 0;
  raw.forEach(([d, l], i) => {
    if (i > 0 && (!Number.isFinite(l) || l === 0) ) return;
    if (!Number.isFinite(d) || d <= 0) errors.push(`Section ${i + 1}: diameter missing or invalid.`);
    else if (!Number.isFinite(l) || l <= 0) errors.push(`Section ${i + 1}: length missing or invalid.`);
    else { sections.push({ d, l, x0: x, idx: i + 1 }); x += l; }
  });
  if (errors.length) return fail();
  const total = x;
  sections.forEach((s, i) => {
    if (i > 0) {
      const r = Math.max(s.d, sections[i - 1].d) / Math.min(s.d, sections[i - 1].d);
      if (r > 1.5) warnings.push(`Shoulder ${i}->${i + 1} diameter ratio ${fmt(r, 2)} is large; check stress concentration.`);
      if (r === 1) warnings.push(`Sections ${i} and ${i + 1} have equal diameter (no shoulder).`);
    }
  });
  const dMax = Math.max(...sections.map((s) => s.d)), dMin = Math.min(...sections.map((s) => s.d));
  if (total / dMax > 20) warnings.push('Slenderness L/d > 20: check deflection and critical speed.');
  const massKg = sections.reduce((a, s) => a + (Math.PI / 4) * s.d ** 2 * s.l, 0) * mat!.density;
  const calculated: Row[] = [row('Overall length', total, 'mm'), row('Largest diameter', dMax, 'mm'), row('Smallest diameter', dMin, 'mm'), row('Approx. mass', massKg, 'kg', 4)];
  assumptions.push('Plain stepped cylinder: no chamfers, keyways, threads or grooves modelled.');
  if (T > 0) {
    if (mat!.yieldMPa === null) warnings.push('No yield strength on file for this material; torsion check skipped.');
    else {
      const tauAllow = (0.577 * mat!.yieldMPa) / sf, dReq = Math.cbrt((16 * T * 1000) / (Math.PI * tauAllow));
      const tau = (16 * T * 1000) / (Math.PI * dMin ** 3);
      calculated.push(row('Allowable shear stress 0.577·Sy/SF', tauAllow, 'MPa', 1), row('Min. dia for pure torsion', dReq, 'mm', 2), row('Shear stress at smallest section', tau, 'MPa', 1));
      assumptions.push(`Pure torsion only, typical yield ${mat!.yieldMPa} MPa (verify with material certificate). Bending, keyways and fatigue ignored.`);
      if (tau > tauAllow) warnings.push(`Smallest section FAILS the preliminary torsion check (${fmt(tau, 1)} > ${fmt(tauAllow, 1)} MPa).`);
    }
  }
  warnings.push('PRELIMINARY: no bending, fatigue or critical-speed verification.');
  return { ok: true, inputs, calculated, assumptions, warnings, errors, standards, derived: { sections, total, massKg, matId: String(p.material) } satisfies ShaftDerived };
}
