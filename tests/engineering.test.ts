import { describe, it, expect } from 'vitest';
import { calcSprocket, sprocketDefaults } from '../src/families/sprocket/calc.ts';
import { sprocketViews } from '../src/families/sprocket/drawing.ts';
import { calcShaft } from '../src/families/shaft/calc.ts';
import { shaftViews } from '../src/families/shaft/drawing.ts';
import { calcBearing } from '../src/families/bearing/calc.ts';
import { bearingViews } from '../src/families/bearing/drawing.ts';
import { keyFor } from '../src/data/keys.ts';
import { arcPoints, borePolygon, circlePts, discretize, polygonArea } from '../src/core/geom.ts';
import { composeSheet, SHEET } from '../src/cad2d/sheet.ts';
import type { SheetMeta } from '../src/cad2d/sheet.ts';
import { toDxf } from '../src/exporters/dxf.ts';

const meta: SheetMeta = { company: 'Ultraplast Chainbelts Private Limited', title: 'T', partId: 'P', drawingNo: 'UP-1', revision: 'A', date: '2026-01-01', material: 'C45 Steel', units: 'mm', notes: ['n1'] };

describe('geometry helpers', () => {
  it('polygon area of a fine circle approaches pi r^2', () => {
    expect(polygonArea(circlePts(10, 720))).toBeCloseTo(Math.PI * 100, 1);
  });
  it('arc through three points ends at the end point and keeps radius', () => {
    const pts = arcPoints([1, 0], [0, 1], [-1, 0], 10);
    expect(pts[pts.length - 1][0]).toBeCloseTo(-1, 9);
    pts.forEach((p) => expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9));
  });
  it('bore polygon with keyway reaches r + t2', () => {
    const pts = borePolygon(12.5, { b: 8, t2: 3.3 });
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(15.8, 9);
  });
});

describe('keyways (DIN 6885 / ISO 773)', () => {
  it('looks up standard sizes', () => {
    expect(keyFor(25)?.b).toBe(8);
    expect(keyFor(25)?.h).toBe(7);
    expect(keyFor(30)?.b).toBe(8);
    expect(keyFor(31)?.b).toBe(10);
    expect(keyFor(6)).toBeNull();
    expect(keyFor(100)).toBeNull();
  });
});

describe('roller chain sprocket', () => {
  const base = sprocketDefaults('08B-1', 17);
  it('computes pitch and root diameters', () => {
    const r = calcSprocket(base);
    expect(r.ok).toBe(true);
    expect(r.derived.d).toBeCloseTo(12.7 / Math.sin(Math.PI / 17), 6);
    expect(r.derived.d).toBeCloseTo(69.115, 2);
    expect(r.derived.df).toBeCloseTo(r.derived.d - 8.51, 9);
  });
  it('tip diameter respects ISO limits', () => {
    const r = calcSprocket(base);
    expect(r.derived.daMin).toBeLessThan(r.derived.daMax);
    expect(r.derived.da).toBeGreaterThan(r.derived.daMin - 1e-9);
    expect(r.derived.da).toBeLessThan(r.derived.daMax + 1e-9);
  });
  it('outline stays between root and tip radius', () => {
    const c = calcSprocket(base).derived;
    const pts = discretize(c.start, c.path);
    expect(pts.length).toBeGreaterThan(100);
    const radii = pts.map((p) => Math.hypot(p[0], p[1]));
    expect(Math.max(...radii)).toBeLessThan(c.da / 2 + 1e-6);
    expect(Math.min(...radii)).toBeGreaterThan(c.df / 2 - 1e-6);
  });
  it('rejects invalid input', () => {
    expect(calcSprocket({ ...base, teeth: 5 }).ok).toBe(false);
    expect(calcSprocket({ ...base, teeth: 17.5 }).ok).toBe(false);
    expect(calcSprocket({ ...base, bore: 60 }).ok).toBe(false);
    expect(calcSprocket({ ...base, bore: NaN }).ok).toBe(false);
    expect(calcSprocket({ ...base, chain: 'CUSTOM', pitch: NaN, rollerDia: 8, innerWidth: 7 }).ok).toBe(false);
    expect(calcSprocket({ ...base, bore: 100, keyway: true }).ok).toBe(false);
  });
  it('accepts a custom chain with user data', () => {
    const r = calcSprocket({ ...base, chain: 'CUSTOM', pitch: 15, rollerDia: 9, innerWidth: 8, bore: 15 });
    expect(r.ok).toBe(true);
    expect(r.derived.d).toBeCloseTo(15 / Math.sin(Math.PI / 17), 6);
  });
  it('always carries a PRELIMINARY warning and keeps all variant defaults valid', () => {
    expect(calcSprocket(base).warnings.some((w) => w.includes('PRELIMINARY'))).toBe(true);
    for (const chain of ['06B-1', '08B-1', '16B-1', 'ANSI 40', 'ANSI 80']) {
      for (const z of [9, 13, 17, 25, 45]) {
        const r = calcSprocket(sprocketDefaults(chain, z));
        expect(r.errors.join('|')).toBe('');
        expect(r.ok).toBe(true);
      }
    }
  });
  it('generates two views with geometry', () => {
    const v = sprocketViews(calcSprocket(base).derived);
    expect(v.length).toBe(4);
    expect(v[0].ents.length).toBeGreaterThan(5);
  });
});

describe('stepped shaft', () => {
  const p = { d1: 25, l1: 100, d2: 0, l2: 0, d3: 0, l3: 0, torque: 0, sf: 3, material: 'C45 Steel' };
  it('mass of a 25x100 steel cylinder', () => {
    const r = calcShaft(p);
    expect(r.ok).toBe(true);
    expect(r.derived.massKg).toBeCloseTo((Math.PI / 4) * 625 * 100 * 7.85e-6, 6);
  });
  it('torsion check minimum diameter', () => {
    const r = calcShaft({ ...p, torque: 100 });
    const tauAllow = (0.577 * 340) / 3;
    const dReq = Math.cbrt((16 * 100000) / (Math.PI * tauAllow));
    expect(r.calculated.some((x) => x.label.includes('Min. dia') && Math.abs(Number(x.value) - dReq) < 0.01)).toBe(true);
    expect(calcShaft({ ...p, d1: 10, torque: 100 }).warnings.some((w) => w.includes('FAILS'))).toBe(true);
  });
  it('supports multiple sections and rejects bad input', () => {
    const r = calcShaft({ ...p, d2: 30, l2: 40, d3: 20, l3: 20 });
    expect(r.derived.total).toBe(160);
    expect(r.derived.sections.length).toBe(3);
    expect(calcShaft({ ...p, d1: 0 }).ok).toBe(false);
    expect(calcShaft({ ...p, d2: 0, l2: 10 }).ok).toBe(false);
    expect(shaftViews(r.derived).length).toBe(3);
  });
});

describe('deep groove ball bearing', () => {
  it('uses ISO 15 boundary dimensions', () => {
    const r = calcBearing({ designation: '6205', material: 'Chrome Steel 100Cr6' });
    expect(r.derived.d).toBe(25); expect(r.derived.D).toBe(52); expect(r.derived.B).toBe(15);
    expect(r.derived.Z).toBe(9);
    expect(bearingViews(r.derived).length).toBe(3);
  });
  it('rejects impossible custom dimensions', () => {
    expect(calcBearing({ designation: 'CUSTOM', d: 20, D: 22, B: 5, material: 'SS 440C' }).ok).toBe(false);
  });
});

describe('sheet composer and DXF', () => {
  const cases = [
    ['sprocket', () => sprocketViews(calcSprocket(sprocketDefaults('08B-1', 17)).derived)],
    ['big sprocket', () => sprocketViews(calcSprocket(sprocketDefaults('24B-1', 45)).derived)],
    ['long shaft', () => shaftViews(calcShaft({ d1: 25, l1: 800, d2: 30, l2: 200, d3: 20, l3: 100, torque: 0, sf: 3, material: 'C45 Steel' }).derived)],
    ['bearing', () => bearingViews(calcBearing({ designation: '6305', material: 'SS 440C' }).derived)],
  ] as const;
  for (const [name, mk] of cases) {
    it(`${name}: uses a standard scale and stays inside the sheet`, () => {
      const s = composeSheet(mk(), meta);
      expect([0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]).toContain(s.scale);
      for (const e of s.ents) {
        const pts = e.t === 'line' ? [e.a, e.b] : e.t === 'poly' ? e.pts : e.t === 'text' ? [e.p] : [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
        for (const p of pts) { expect(p[0]).toBeGreaterThan(9.99); expect(p[0]).toBeLessThan(SHEET.w - 9.99); expect(p[1]).toBeGreaterThan(9.99); expect(p[1]).toBeLessThan(SHEET.h - 9.99); }
      }
    });
  }
  it('DXF is structurally valid', () => {
    const s = composeSheet(sprocketViews(calcSprocket(sprocketDefaults('08B-1', 17)).derived), meta);
    const dxf = toDxf(s.ents);
    const lines = dxf.split('\n');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    expect(lines.length % 2).toBe(1);
    const pairs: [string, string][] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
    const count = (t: string) => pairs.filter(([c, v]) => c === '0' && v === t).length;
    expect(count('LINE')).toBe(s.ents.filter((e) => e.t === 'line').length);
    expect(count('CIRCLE')).toBe(s.ents.filter((e) => e.t === 'circle').length);
    expect(count('POLYLINE')).toBe(count('SEQEND'));
    expect(count('SECTION')).toBe(count('ENDSEC'));
    expect(dxf.includes('%%c')).toBe(true);
  });
});
