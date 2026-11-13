import { describe, it, expect } from 'vitest';
import { chainLength, drivePower, pitchDiameter, rollerPitch, speed, throughput } from '../src/lib/convcalc.ts';

const get = (r: ReturnType<typeof speed>, label: string, unit?: string) => { if (!r.ok) throw new Error(r.error); const o = r.out.find((x) => x.label === label && (!unit || x.unit === unit)); if (!o) throw new Error(`no ${label}`); return o.value; };

describe('speed', () => {
  it('chain: 1450 rpm / 30 = 48.33 rpm, 16 teeth x 25.4 mm', () => {
    const r = speed({ motorRpm: 1450, ratio: 30, kind: 'chain', teeth: 16, pitch: 25.4 });
    expect(get(r, 'Output shaft speed')).toBeCloseTo(48.333, 2);
    expect(get(r, 'Conveying speed', 'm/min')).toBeCloseTo(16 * 25.4 * 48.3333 / 1000, 3);
  });
  it('drum: 200 mm drum at 60 rpm = 37.7 m/min', () => { expect(get(speed({ motorRpm: 60, ratio: 1, kind: 'drum', drumDia: 200 }), 'Conveying speed', 'm/min')).toBeCloseTo(37.699, 2); });
  it('rejects bad input', () => { expect(speed({ motorRpm: 0, ratio: 1, kind: 'drum', drumDia: 100 }).ok).toBe(false); });
});
describe('throughput', () => {
  it('30 m/min, 200 mm item + 100 mm gap = 100 items/min', () => { expect(get(throughput({ speedMmin: 30, itemLength: 200, gap: 100, itemMass: 2, lanes: 1 }) as never, 'Items per minute')).toBeCloseTo(100, 6); });
});
describe('chain length', () => {
  it('19 and 57 teeth, 12.7 mm pitch, 500 mm centre', () => {
    const r = chainLength({ teethSmall: 19, teethLarge: 57, pitch: 12.7, centre: 500 });
    if (!r.ok) throw new Error(r.error);
    const lp = r.out[0].value, even = r.out[1].value;
    // L = 2C/p + (N1+N2)/2 + ((N2-N1)/2pi)^2 / (C/p)
    expect(lp).toBeCloseTo(2 * 500 / 12.7 + 38 + (38 / (2 * Math.PI)) ** 2 / (500 / 12.7), 6);
    expect(even % 2).toBe(0); expect(even).toBeGreaterThanOrEqual(lp);
    const cNew = r.out[3].value; expect(Math.abs(cNew - 500)).toBeLessThan(2 * 12.7); // within one even-step of the asked centre
  });
  it('the centre distance given by the even length reproduces that length', () => {
    const r = chainLength({ teethSmall: 17, teethLarge: 51, pitch: 15.875, centre: 700 });
    if (!r.ok) throw new Error(r.error);
    const c = r.out[3].value / 15.875, back = 2 * c + 34 + (34 / (2 * Math.PI)) ** 2 / c;
    expect(back).toBeCloseTo(r.out[1].value, 1);
  });
  it('same teeth means straight chain: lp = 2C/p + N', () => { const r = chainLength({ teethSmall: 20, teethLarge: 20, pitch: 10, centre: 400 }); if (!r.ok) throw new Error(r.error); expect(r.out[0].value).toBeCloseTo(80 + 20, 6); });
});
describe('pitch diameter', () => { it('12.7 mm, 19 teeth = 77.2 mm', () => { const r = pitchDiameter({ teeth: 19, pitch: 12.7 }); if (!r.ok) throw new Error(r.error); expect(r.out[0].value).toBeCloseTo(77.2, 0); }); });
describe('drive power', () => {
  it('flat conveyor: F = g (m) mu', () => {
    const r = drivePower({ massLoad: 100, massMoving: 50, mu: 0.2, angleDeg: 0, speedMs: 0.5, eta: 0.9, service: 1.25, driveDia: 200 });
    if (!r.ok) throw new Error(r.error);
    expect(r.out[0].value).toBeCloseTo(9.80665 * 150 * 0.2, 4);
    expect(r.out[1].value).toBeCloseTo((9.80665 * 150 * 0.2 * 0.5) / 0.9 * 1.25 / 1000, 5);
    expect(r.out[3].value).toBeCloseTo(r.out[0].value * 0.1, 4); // torque = F x radius (0.1 m)
  });
  it('incline adds the lifting term; downhill warns', () => {
    const up = drivePower({ massLoad: 100, massMoving: 0.001, mu: 0.1, angleDeg: 10, speedMs: 1, eta: 1, service: 1 }); if (!up.ok) throw new Error(up.error);
    expect(up.out[0].value).toBeGreaterThan(9.80665 * 100 * Math.sin(10 * Math.PI / 180));
    const down = drivePower({ massLoad: 100, massMoving: 1, mu: 0.05, angleDeg: -30, speedMs: 1, eta: 1, service: 1 }); if (!down.ok) throw new Error(down.error);
    expect(down.out[0].value).toBeLessThan(0); expect(down.warnings.join(' ')).toMatch(/brake/);
  });
  it('rejects efficiency above 1', () => { expect(drivePower({ massLoad: 1, massMoving: 1, mu: 0.1, angleDeg: 0, speedMs: 1, eta: 1.2, service: 1 }).ok).toBe(false); });
});
describe('roller pitch', () => {
  it('300 mm item gives pitch 100 mm; 2 m conveyor = 21 rollers', () => { const r = rollerPitch({ itemLength: 300, conveyorLength: 2000, rollerDia: 50 }); if (!r.ok) throw new Error(r.error); expect(r.out[1].value).toBe(100); expect(r.out[2].value).toBe(21); });
  it('too-short item is refused', () => { expect(rollerPitch({ itemLength: 90, conveyorLength: 2000, rollerDia: 50 }).ok).toBe(false); });
});
