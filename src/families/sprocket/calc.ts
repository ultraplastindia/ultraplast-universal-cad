import type { CalcResult, ParamField, Params, Pt, Row } from '../../core/types.ts';
import type { Seg } from '../../core/geom.ts';
import { discretize, polygonArea } from '../../core/geom.ts';
import { fmt, num } from '../../core/util.ts';
import { ROLLER_CHAINS } from '../../data/chains.ts';
import { keyFor } from '../../data/keys.ts';
import { material } from '../../data/materials.ts';

export const SPROCKET_MATERIALS = ['C45 Steel', 'SS 304', 'Nylon PA6', 'Acetal POM', 'UHMW-PE', 'Al 6061-T6'];
const isCustom = (p: Params) => p.chain === 'CUSTOM';

export const SPROCKET_FIELDS: ParamField[] = [
  { key: 'chain', label: 'Roller chain', kind: 'select', options: [...ROLLER_CHAINS.map((c) => ({ value: c.id, label: `${c.id} (${c.std}, p ${c.pitch})` })), { value: 'CUSTOM', label: 'Custom chain (enter data)' }] },
  { key: 'pitch', label: 'Chain pitch p', unit: 'mm', kind: 'number', min: 3, max: 100, step: 0.001, showIf: isCustom },
  { key: 'rollerDia', label: 'Roller diameter d1', unit: 'mm', kind: 'number', min: 1, max: 60, step: 0.01, showIf: isCustom },
  { key: 'innerWidth', label: 'Inner width b1', unit: 'mm', kind: 'number', min: 1, max: 60, step: 0.01, showIf: isCustom },
  { key: 'teeth', label: 'Number of teeth z', kind: 'number', min: 6, max: 150, step: 1 },
  { key: 'bore', label: 'Bore diameter', unit: 'mm', kind: 'number', min: 5, max: 200, step: 0.5 },
  { key: 'keyway', label: 'Keyway (DIN 6885 / ISO 773)', kind: 'boolean' },
  { key: 'hubDia', label: 'Hub diameter', unit: 'mm', kind: 'number', min: 0, max: 300, step: 0.5 },
  { key: 'hubLength', label: 'Hub length (beyond tooth plate)', unit: 'mm', kind: 'number', min: 0, max: 200, step: 0.5, help: '0 = plain plate sprocket, no hub' },
  { key: 'tipMode', label: 'Tip diameter within ISO limits', kind: 'select', options: [{ value: 'min', label: 'Minimum' }, { value: 'mid', label: 'Mid' }, { value: 'max', label: 'Maximum' }] },
  { key: 'material', label: 'Material', kind: 'select', options: SPROCKET_MATERIALS.map((m) => ({ value: m, label: m })) },
];

export interface SprocketDerived {
  z: number; p: number; d1: number; b1: number; d: number; df: number; da: number; daMin: number; daMax: number;
  ri: number; bf1: number; alpha: number; alphaSeat: number; re: number; tipAngle: number; bore: number; hubDia: number; hubLen: number; width: number;
  key: { b: number; h: number; t1: number; t2: number } | null;
  start: Pt; path: Seg[]; massKg: number | null; matId: string;
}

export interface ToothResult { ok: boolean; reason?: string; start: Pt; path: Seg[]; tipAngleDeg: number; pointed: boolean; tipR: number }
const TWO_PI = 2 * Math.PI;
const mod2pi = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

/** ISO 606 tooth form, built from true arcs (all in one closed path):
 *  roller seat arc ri (included angle alpha), tangent convex flank arc re (S-curve), and a tip arc on da.
 *  alpha, ri, re are given by ISO 606 limit formulas (see calcSprocket). Tooth side chamfer/radius not modelled. */
export function toothPath(z: number, d: number, d1: number, ri: number, da: number, alphaDeg: number, re: number): ToothResult {
  const R = d / 2, Rc = R + (ri - d1 / 2), beta = (alphaDeg * Math.PI) / 360, pa = TWO_PI / z, Rt = da / 2;
  const fail = (reason: string): ToothResult => ({ ok: false, reason, start: [0, 0], path: [], tipAngleDeg: 0, pointed: false, tipR: 0 });
  const C: Pt = [Rc, 0];
  const seat = (t: number): Pt => [C[0] + ri * Math.cos(Math.PI + t), C[1] + ri * Math.sin(Math.PI + t)];
  const Pm = seat(-beta), u: Pt = [Math.cos(Math.PI - beta), Math.sin(Math.PI - beta)];
  const F: Pt = [Pm[0] + re * u[0], Pm[1] + re * u[1]];
  const dF = Math.hypot(F[0], F[1]);
  if (dF > Rt + re || dF < Math.abs(Rt - re)) return fail('The tooth flank arc does not reach the tip circle.');
  const a = (dF * dF + Rt * Rt - re * re) / (2 * dF), h = Math.sqrt(Math.max(0, Rt * Rt - a * a));
  const base: Pt = [(a / dF) * F[0], (a / dF) * F[1]], perp: Pt = [-F[1] / dF, F[0] / dF];
  const tan: Pt = [u[1], -u[0]];
  const sense = Math.sign((Pm[0] - F[0]) * tan[1] - (Pm[1] - F[1]) * tan[0]) || 1;
  const aP = Math.atan2(Pm[1] - F[1], Pm[0] - F[0]);
  let best: { q: Pt; sweep: number } | null = null;
  for (const sg of [1, -1]) {
    const q: Pt = [base[0] + sg * h * perp[0], base[1] + sg * h * perp[1]];
    const aQ = Math.atan2(q[1] - F[1], q[0] - F[0]), sweep = sense > 0 ? mod2pi(aQ - aP) : mod2pi(aP - aQ);
    if (!best || sweep < best.sweep) best = { q, sweep };
  }
  let q = best!.q, sweepQ = best!.sweep, pointed = false;
  let tipAngle = Math.atan2(q[1], q[0]);
  if (!(tipAngle > 0)) return fail('Tooth flank geometry is invalid for these parameters.');
  if (tipAngle > pa / 2 - 1e-3) {
    // flanks meet on the tooth centre line below the tip circle: pointed tooth, apex = flank/centre-line intersection
    const e: Pt = [Math.cos(pa / 2), Math.sin(pa / 2)], ef = e[0] * F[0] + e[1] * F[1], disc = ef * ef - dF * dF + re * re;
    if (disc < 0) return fail('The flank never reaches the tooth centre line.');
    let apex: { q: Pt; sweep: number } | null = null;
    for (const sg of [1, -1]) {
      const t = ef + sg * Math.sqrt(disc), qq: Pt = [t * e[0], t * e[1]];
      const aQ = Math.atan2(qq[1] - F[1], qq[0] - F[0]), sw = sense > 0 ? mod2pi(aQ - aP) : mod2pi(aP - aQ);
      if (t > 0 && (!apex || sw < apex.sweep)) apex = { q: qq, sweep: sw };
    }
    if (!apex) return fail('Could not locate the tooth apex.');
    q = apex.q; sweepQ = apex.sweep; pointed = true; tipAngle = pa / 2;
  }
  const am = aP + (sense * sweepQ) / 2, Fm: Pt = [F[0] + re * Math.cos(am), F[1] + re * Math.sin(am)];
  const rot = (p: Pt, phi: number): Pt => [p[0] * Math.cos(phi) - p[1] * Math.sin(phi), p[0] * Math.sin(phi) + p[1] * Math.cos(phi)];
  const mir = (p: Pt): Pt => [p[0], -p[1]];
  const path: Seg[] = [];
  for (let g = 0; g < z; g++) {
    const p0 = g * pa, p1 = (g + 1) * pa;
    path.push({ t: 'A', mid: rot(seat(0), p0), to: rot(Pm, p0) });
    path.push({ t: 'A', mid: rot(Fm, p0), to: rot(q, p0) });
    if (!pointed) path.push({ t: 'A', mid: [Rt * Math.cos(p0 + pa / 2), Rt * Math.sin(p0 + pa / 2)], to: rot(mir(q), p1) });
    path.push({ t: 'A', mid: rot(mir(Fm), p1), to: rot(mir(Pm), p1) });
  }
  return { ok: true, start: rot(mir(Pm), 0), path, tipAngleDeg: (tipAngle * 180) / Math.PI, pointed, tipR: Math.hypot(q[0], q[1]) };
}

export function sprocketDefaults(chainId: string, z: number): Params {
  const c = ROLLER_CHAINS.find((x) => x.id === chainId) ?? ROLLER_CHAINS[1];
  const df = c.pitch / Math.sin(Math.PI / z) - c.rollerDia;
  const bore = Math.max(6, Math.floor((df * 0.3) / 2) * 2);
  const hubDia = Math.max(bore + 6, Math.min(Math.round(bore * 1.6 + 6), Math.floor(df - 3)));
  return { chain: c.id, pitch: c.pitch, rollerDia: c.rollerDia, innerWidth: c.innerWidth, teeth: z, bore, keyway: keyFor(bore) !== null, hubDia, hubLength: Math.round(bore * 0.8), tipMode: 'mid', material: 'C45 Steel' };
}

const row = (label: string, v: number | string, unit?: string, dp = 3): Row => ({ label, value: typeof v === 'number' ? fmt(v, dp) : v, unit });

export function calcSprocket(p: Params): CalcResult {
  const errors: string[] = [], warnings: string[] = [], assumptions: string[] = [];
  const std = ROLLER_CHAINS.find((c) => c.id === p.chain);
  const pitch = std ? std.pitch : num(p, 'pitch'), d1 = std ? std.rollerDia : num(p, 'rollerDia'), b1 = std ? std.innerWidth : num(p, 'innerWidth');
  const z = num(p, 'teeth'), bore = num(p, 'bore'), hubLen = num(p, 'hubLength'), hubDia = num(p, 'hubDia');
  const matId = String(p.material), mat = material(matId);
  const standards = ['ISO 606 / ASME B29.1 (roller chain sprockets)', 'DIN 6885-1 / ISO 773 (keyways)'];
  const inputs: Row[] = [row('Chain', String(p.chain)), row('Pitch p', pitch, 'mm'), row('Roller dia d1', d1, 'mm'), row('Inner width b1', b1, 'mm'), row('Teeth z', z), row('Bore', bore, 'mm'), row('Keyway', p.keyway ? 'Yes' : 'No'), row('Hub dia', hubDia, 'mm'), row('Hub length', hubLen, 'mm'), row('Tip diameter mode', String(p.tipMode)), row('Material', matId)];
  const fail = (): CalcResult => ({ ok: false, inputs, calculated: [], assumptions, warnings, errors, standards, derived: null });

  if (!std && p.chain !== 'CUSTOM') errors.push('Unknown chain selection.');
  ([['chain pitch', pitch], ['roller diameter', d1], ['inner width', b1], ['bore', bore]] as [string, number][]).forEach(([n, v]) => { if (!Number.isFinite(v) || v <= 0) errors.push(`Missing or invalid value: ${n}.`); });
  if (!Number.isFinite(z) || !Number.isInteger(z)) errors.push('Number of teeth must be a whole number.');
  else if (z < 6 || z > 150) errors.push('Number of teeth must be between 6 and 150.');
  if (!Number.isFinite(hubLen) || hubLen < 0) errors.push('Hub length must be 0 or greater.');
  if (hubLen > 0 && (!Number.isFinite(hubDia) || hubDia <= bore)) errors.push('Hub diameter must be larger than the bore.');
  if (!mat) errors.push('Unknown material.');
  if (errors.length) return fail();
  if (d1 >= pitch) errors.push('Roller diameter must be smaller than the pitch (check chain data).');
  if (b1 <= 0) errors.push('Inner width must be positive.');
  if (errors.length) return fail();

  const alpha = 180 / z, d = pitch / Math.sin(Math.PI / z), df = d - d1;
  const ri = (0.505 * d1 + 0.505 * d1 + 0.069 * Math.cbrt(d1)) / 2;
  const alphaMax = 140 - 90 / z, alphaMin = 120 - 90 / z, alphaSeat = (alphaMax + alphaMin) / 2;
  const reMax = 0.008 * d1 * (z * z + 180), reMin = 0.12 * d1 * (z + 2), re = (reMax + reMin) / 2;
  const daMax = d + 1.25 * pitch - d1, daMin = d + pitch * (1 - 1.6 / z) - d1;
  const da = p.tipMode === 'min' ? daMin : p.tipMode === 'max' ? daMax : (daMin + daMax) / 2;
  const bf1 = (pitch <= 12.7 ? 0.93 : 0.95) * b1;
  const key = p.keyway ? keyFor(bore) : null;
  if (p.keyway && !key) errors.push('No standard keyway for this bore (supported 6 to 95 mm). Disable the keyway or change the bore.');
  const tp = toothPath(z, d, d1, ri, da, alphaSeat, re);
  if (!tp.ok) errors.push(`Tooth profile cannot be built: ${tp.reason}`);
  else if (tp.pointed) warnings.push(`Tooth is pointed at this tooth count/tip setting: effective tip diameter is ${fmt(2 * tp.tipR, 2)} mm (limits ${fmt(daMin, 2)} to ${fmt(daMax, 2)}).`);
  if (bore >= df - 6) errors.push(`Bore is too large: it leaves less than 3 mm of rim under the roller seats (bore must be below ${fmt(df - 6, 1)} mm).`);
  if (key && (bore + key.t2 * 2 > df - 6)) warnings.push('Keyway leaves a thin rim under the roller seats.');
  if (errors.length) return fail();

  if (z < 9) warnings.push('Fewer than 9 teeth: very pronounced chordal action; not recommended.');
  else if (z < 17) warnings.push('Fewer than 17 teeth: increased chordal action and wear; check speed limits with the chain manufacturer.');
  if (hubLen > 0) {
    if (hubDia > df - 1) warnings.push('Hub diameter exceeds the root diameter: chain link plates may foul the hub.');
    if (hubDia > da) errors.push('Hub diameter exceeds the tooth tip diameter.');
    const wall = (hubDia - bore) / 2 - (key ? key.t2 : 0);
    if (wall < 3) warnings.push(`Hub wall under keyway is only ${fmt(wall, 1)} mm.`);
  }
  if (errors.length) return fail();

  assumptions.push('ISO 606 tooth profile with parameters at the mean of the standard limits: seat radius ri, seating angle (130 - 90/z deg), flank radius re.');
  assumptions.push('Tooth side chamfer/radius (axial edge break) and tolerances are not modelled.');
  assumptions.push('Single-strand sprocket. Tooth-plate width bf1 = 0.93 b1 (p <= 12.7) or 0.95 b1 (p > 12.7).');
  assumptions.push('Hub is on one side of the tooth plate. Mass excludes set-screw holes and chamfers.');
  if (hubLen === 0) assumptions.push('No hub: plain plate sprocket.');

  const width = bf1 + hubLen;
  const outer = polygonArea(discretize(tp.start, tp.path));
  let vol = (outer - Math.PI * (bore / 2) ** 2) * bf1;
  if (hubLen > 0) vol += (Math.PI / 4) * (hubDia ** 2 - bore ** 2) * hubLen;
  if (key) vol -= key.b * key.t2 * width;
  const massKg = vol * mat!.density;
  warnings.push('PRELIMINARY: tooth load, chain speed and wear life are NOT verified.');

  const derived: SprocketDerived = { z, p: pitch, d1, b1, d, df, da: tp.pointed ? 2 * tp.tipR : da, daMin, daMax, ri, bf1, alpha, alphaSeat, re, tipAngle: tp.tipAngleDeg, bore, hubDia: hubLen > 0 ? hubDia : bore, hubLen, width, key, start: tp.start, path: tp.path, massKg, matId };
  const calculated: Row[] = [
    row('Pitch diameter d = p / sin(180/z)', d, 'mm'), row('Root diameter df = d - d1', df, 'mm'),
    row('Tip diameter da (limits ' + fmt(daMin, 2) + ' to ' + fmt(daMax, 2) + ')', tp.pointed ? 2 * tp.tipR : da, 'mm'), row('Roller seat radius ri', ri, 'mm'), row('Seating angle (ISO 606: ' + fmt(alphaMin, 1) + ' to ' + fmt(alphaMax, 1) + ')', alphaSeat, 'deg', 2), row('Tooth flank radius re (' + fmt(reMin, 1) + ' to ' + fmt(reMax, 1) + ')', re, 'mm', 2),
    row('Tooth plate width bf1', bf1, 'mm'), row('Half pitch angle 180/z', alpha, 'deg'), row('Overall width', width, 'mm'), row('Approx. mass', massKg, 'kg', 4),
  ];
  if (key) calculated.push(row('Keyway b x h (ISO 773)', `${key.b} x ${key.h}`, 'mm'), row('Hub keyway depth t2', key.t2, 'mm'));
  return { ok: true, inputs, calculated, assumptions, warnings, errors, standards, derived };
}
