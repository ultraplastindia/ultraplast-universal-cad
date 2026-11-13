/** Conveyor engineering helpers. Plain, textbook formulas, written so each one can be checked by hand.
 *  Results are PRELIMINARY sizing aids: always confirm with the chain or belt maker's catalogue and a qualified engineer. */
export type Out = { label: string; value: number; unit: string; digits?: number; note?: string };
export type Res = { ok: true; out: Out[]; warnings: string[] } | { ok: false; error: string };

const pos = (v: number, name: string): string | null => (Number.isFinite(v) && v > 0 ? null : `${name} must be a number above zero.`);
const first = (...e: (string | null)[]): string | null => e.find((x) => x) ?? null;
const G = 9.80665;

/** Speed of a chain (from drive sprocket) or belt (from drum/pulley), starting from the motor speed and gearbox ratio. */
export function speed(i: { motorRpm: number; ratio: number; kind: 'chain' | 'drum'; teeth?: number; pitch?: number; drumDia?: number }): Res {
  const e = first(pos(i.motorRpm, 'Motor speed'), pos(i.ratio, 'Gearbox ratio'), i.kind === 'chain' ? first(pos(i.teeth ?? NaN, 'Sprocket teeth'), pos(i.pitch ?? NaN, 'Chain pitch')) : pos(i.drumDia ?? NaN, 'Drum diameter'));
  if (e) return { ok: false, error: e };
  const n = i.motorRpm / i.ratio;
  const mm = i.kind === 'chain' ? (i.teeth! * i.pitch! * n) : Math.PI * i.drumDia! * n; // mm per minute
  const warnings: string[] = [];
  if (i.kind === 'chain' && i.teeth! < 9) warnings.push('Fewer than 9 teeth gives strong chordal action (uneven speed).');
  if (mm / 60000 > 2.5) warnings.push('Above about 2.5 m/s most conveyor chains and belts need special design and lubrication.');
  return { ok: true, warnings, out: [{ label: 'Output shaft speed', value: n, unit: 'rpm', digits: 2 }, { label: 'Conveying speed', value: mm / 1000, unit: 'm/min', digits: 2 }, { label: 'Conveying speed', value: mm / 60000, unit: 'm/s', digits: 3 }] };
}

/** How many products and how much weight per hour at a given speed. */
export function throughput(i: { speedMmin: number; itemLength: number; gap: number; itemMass: number; lanes: number }): Res {
  const e = first(pos(i.speedMmin, 'Speed'), pos(i.itemLength, 'Item length'), i.gap >= 0 && Number.isFinite(i.gap) ? null : 'Gap cannot be negative.', pos(i.itemMass, 'Item mass'), pos(i.lanes, 'Lanes'));
  if (e) return { ok: false, error: e };
  const perMin = (i.speedMmin * 1000) / (i.itemLength + i.gap) * Math.floor(i.lanes);
  const warnings: string[] = [];
  if (i.gap < 0.1 * i.itemLength) warnings.push('A gap under 10% of the item length is hard to keep: items may touch or jam.');
  return { ok: true, warnings, out: [{ label: 'Items per minute', value: perMin, unit: '/min', digits: 1 }, { label: 'Items per hour', value: perMin * 60, unit: '/h', digits: 0 }, { label: 'Mass per hour', value: (perMin * 60 * i.itemMass) / 1000, unit: 't/h', digits: 2 }] };
}

/** Chain length in pitches for two sprockets and a centre distance (standard formula), made even so no offset link is needed,
 *  and the centre distance that this even length really gives. */
export function chainLength(i: { teethSmall: number; teethLarge: number; pitch: number; centre: number }): Res {
  const e = first(pos(i.teethSmall, 'Small sprocket teeth'), pos(i.teethLarge, 'Large sprocket teeth'), pos(i.pitch, 'Pitch'), pos(i.centre, 'Centre distance'));
  if (e) return { ok: false, error: e };
  const [a, b] = [Math.min(i.teethSmall, i.teethLarge), Math.max(i.teethSmall, i.teethLarge)], p = i.pitch, c = i.centre / p;
  const lp = 2 * c + (a + b) / 2 + ((b - a) / (2 * Math.PI)) ** 2 / c;
  const even = Math.ceil(lp / 2) * 2, k = even - (a + b) / 2, d = (b - a) / (2 * Math.PI);
  const disc = k * k - 8 * d * d;
  if (disc < 0) return { ok: false, error: 'These sprockets do not fit this chain length. Increase the centre distance.' };
  const cNew = (p / 4) * (k + Math.sqrt(disc));
  const warnings: string[] = [];
  const dS = p / Math.sin(Math.PI / a), dL = p / Math.sin(Math.PI / b), arc = 180 - (2 * Math.asin(Math.min(1, (dL - dS) / (2 * cNew))) * 180) / Math.PI; // wrap angle on the small sprocket, degrees
  if (a < 17) warnings.push('Small sprocket under 17 teeth: faster wear and noise.');
  if (arc < 120) warnings.push('Chain wraps less than 120 degrees on the small sprocket: use more teeth or a longer centre distance.');
  if (b / a > 7) warnings.push('Ratio above 7:1 on one stage is not recommended; use two stages.');
  if (i.centre / p < 30 || i.centre / p > 80) warnings.push('Centre distance is usually 30 to 80 pitches.');
  return { ok: true, warnings, out: [{ label: 'Chain length (calculated)', value: lp, unit: 'pitches', digits: 2 }, { label: 'Chain length to order (even number)', value: even, unit: 'pitches', digits: 0 }, { label: 'Chain length', value: even * p, unit: 'mm', digits: 0 }, { label: 'Centre distance with this chain', value: cNew, unit: 'mm', digits: 1 }, { label: 'Speed ratio', value: b / a, unit: ': 1', digits: 3 }, { label: 'Wrap on small sprocket', value: arc, unit: 'deg', digits: 0 }] };
}

/** Pitch circle diameter of a sprocket: p / sin(180 / N). */
export function pitchDiameter(i: { teeth: number; pitch: number }): Res {
  const e = first(pos(i.teeth, 'Teeth'), pos(i.pitch, 'Pitch'));
  if (e) return { ok: false, error: e };
  if (i.teeth < 3) return { ok: false, error: 'A sprocket needs at least 3 teeth.' };
  const d = i.pitch / Math.sin(Math.PI / i.teeth);
  return { ok: true, warnings: [], out: [{ label: 'Pitch circle diameter', value: d, unit: 'mm', digits: 2 }, { label: 'Chain wrap per revolution', value: i.teeth * i.pitch, unit: 'mm', digits: 1 }] };
}

/** Pulling force and motor power for a conveyor with a given load, friction and slope.
 *  F = g (( m_load + m_moving ) mu cos a + m_load sin a),  P = F v / eta x service factor. */
export function drivePower(i: { massLoad: number; massMoving: number; mu: number; angleDeg: number; speedMs: number; eta: number; service: number; driveDia?: number }): Res {
  const e = first(pos(i.massLoad, 'Load on the conveyor'), pos(i.massMoving, 'Weight of chain or belt'), pos(i.mu, 'Friction coefficient'), Math.abs(i.angleDeg) <= 45 && Number.isFinite(i.angleDeg) ? null : 'Angle must be between -45 and 45 degrees.', pos(i.speedMs, 'Speed'), i.eta > 0 && i.eta <= 1 ? null : 'Efficiency must be between 0.01 and 1.', i.service >= 1 ? null : 'Service factor must be 1 or more.');
  if (e) return { ok: false, error: e };
  const a = (i.angleDeg * Math.PI) / 180;
  const F = G * ((i.massLoad + i.massMoving) * i.mu * Math.cos(a) + i.massLoad * Math.sin(a));
  const P = Math.max(F, 0) * i.speedMs / i.eta * i.service;
  const out: Out[] = [{ label: 'Pulling force', value: F, unit: 'N', digits: 1 }, { label: 'Motor power needed', value: P / 1000, unit: 'kW', digits: 3 }];
  const warnings: string[] = [];
  if (F < 0) warnings.push('The load runs downhill by itself (negative force). A brake or holdback is needed.');
  if (i.mu > 0.5) warnings.push('A friction coefficient above 0.5 is unusual for a conveyor; check the value.');
  if (i.driveDia && i.driveDia > 0) { const n = (i.speedMs * 60000) / (Math.PI * i.driveDia); out.push({ label: 'Drive shaft speed', value: n, unit: 'rpm', digits: 1 }, { label: 'Torque at the drive shaft', value: (Math.max(F, 0) * i.driveDia) / 2000, unit: 'N.m', digits: 1 }); }
  warnings.push('Choose the next standard motor size above this power.');
  return { ok: true, warnings, out };
}

/** Roller conveyor: the pitch must keep at least 3 rollers under the shortest item. */
export function rollerPitch(i: { itemLength: number; conveyorLength: number; rollerDia: number }): Res {
  const e = first(pos(i.itemLength, 'Shortest item length'), pos(i.conveyorLength, 'Conveyor length'), pos(i.rollerDia, 'Roller diameter'));
  if (e) return { ok: false, error: e };
  const maxPitch = i.itemLength / 3, pitch = Math.floor(maxPitch / 5) * 5; // round down to a 5 mm step
  if (pitch < i.rollerDia + 5) return { ok: false, error: 'The item is too short for this roller size: use smaller rollers or a belt.' };
  const count = Math.floor(i.conveyorLength / pitch) + 1;
  return { ok: true, warnings: ['Heavy or soft-bottomed items may need a closer pitch.'], out: [{ label: 'Largest roller pitch', value: maxPitch, unit: 'mm', digits: 1 }, { label: 'Pitch to use', value: pitch, unit: 'mm', digits: 0 }, { label: 'Rollers needed', value: count, unit: 'pcs', digits: 0 }] };
}
