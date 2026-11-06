import { describe, it, expect } from 'vitest';
import { FAMILIES, getFamily } from '../src/families/index.ts';
import { calcSprocket, sprocketDefaults, toothPath } from '../src/families/sprocket/calc.ts';
import { ROLLER_CHAINS } from '../src/data/chains.ts';
import { discretize } from '../src/core/geom.ts';
import { polyProps, rectPoly } from '../src/core/prims.ts';
import { projectGeo } from '../src/core/project.ts';
import { composeSheet, SHEET } from '../src/cad2d/sheet.ts';
import type { Ent } from '../src/cad2d/sheet.ts';
import { pickEntity } from '../src/cad2d/pick.ts';
import { calcRhs } from '../src/families/extra/profiles.ts';
import { calcKey, calcWasher, calcNut } from '../src/families/extra/fasteners.ts';
import { calcRoller, calcBushing, calcHexShaft } from '../src/families/extra/mechanical.ts';
import { calcStrip, calcAngle } from '../src/families/extra/profiles.ts';
import { toDxf } from '../src/exporters/dxf.ts';

const meta = { company: 'Ultraplast Chainbelts Private Limited', title: 'T', partId: 'P', drawingNo: 'UP-1', revision: 'A', date: '2026-01-01', material: 'X', units: 'mm', notes: ['n'] };
const bounds = (ents: Ent[]) => ents.every((e) => {
  const pts = e.t === 'line' ? [e.a, e.b] : e.t === 'poly' ? e.pts : e.t === 'text' ? [e.p] : [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
  return pts.every((p) => p[0] > 9.99 && p[0] < SHEET.w - 9.99 && p[1] > 9.99 && p[1] < SHEET.h - 9.99);
});

describe('ISO 606 sprocket tooth profile', () => {
  it('builds for every chain, tooth count 6..150 and tip mode, and stays inside the tip circle', () => {
    for (const c of ROLLER_CHAINS) for (const z of [6, 9, 13, 17, 25, 38, 60, 150]) for (const tip of ['min', 'mid', 'max']) {
      const r = calcSprocket({ ...sprocketDefaults(c.id, z), tipMode: tip });
      expect(r.errors.join('|')).toBe('');
      const d = r.derived, pts = discretize(d.start, d.path, 8), radii = pts.map((p) => Math.hypot(p[0], p[1]));
      expect(Math.max(...radii)).toBeLessThan(d.da / 2 + 1e-6);
      expect(Math.min(...radii)).toBeGreaterThan(d.df / 2 - 1e-6);
    }
  });
  it('uses the ISO 606 limit formulas', () => {
    const d = calcSprocket(sprocketDefaults('08B-1', 17)).derived;
    expect(d.alphaSeat).toBeCloseTo(130 - 90 / 17, 9);
    const reMax = 0.008 * 8.51 * (17 * 17 + 180), reMin = 0.12 * 8.51 * 19;
    expect(d.re).toBeCloseTo((reMax + reMin) / 2, 9);
  });
  it('closed path: last segment ends on the start point; arcs only', () => {
    const d = calcSprocket(sprocketDefaults('08B-1', 17)).derived, last = d.path[d.path.length - 1];
    expect(Math.hypot(last.to[0] - d.start[0], last.to[1] - d.start[1])).toBeLessThan(1e-9);
    expect(d.path.every((s: { t: string }) => s.t === 'A')).toBe(true);
  });
  it('fails cleanly when the flank cannot reach the tip circle', () => {
    expect(toothPath(17, 69.1, 8.51, 4.37, 5, 124, 25).ok).toBe(false);
  });
});

describe('all component families', () => {
  it('has unique ids and unique variant ids', () => {
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
    for (const f of FAMILIES) expect(new Set(f.variants.map((v) => v.id)).size).toBe(f.variants.length);
  });
  for (const f of FAMILIES) {
    it(`${f.id}: defaults and every variant calculate, draw (inside sheet), project and export DXF`, () => {
      expect(f.variants.length).toBeGreaterThan(5);
      const list = [{ id: 'defaults', params: f.defaults }, ...f.variants];
      for (const v of list) {
        const c = f.calculate(v.params);
        expect(c.errors.join('|')).toBe('');
        expect(c.ok).toBe(true);
        expect(c.warnings.some((w) => w.includes('PRELIMINARY'))).toBe(true);
        const views = f.views(c.derived), geo = f.geo(c.derived);
        expect(views.length).toBeGreaterThan(2);
        expect(geo.length).toBeGreaterThan(0);
        const sheet = composeSheet(views, meta);
        expect(bounds(sheet.ents)).toBe(true);
      }
      const c = f.calculate(f.defaults), sheet = composeSheet(f.views(c.derived), meta);
      expect(toDxf(sheet.ents).trim().endsWith('EOF')).toBe(true);
      for (const id of ['front', 'top', 'right', 'iso'] as const) expect(projectGeo(f.geo(c.derived), id).length).toBeGreaterThan(0);
    });
  }
  it('rejects bad input in every new family', () => {
    expect(calcRhs({ ...getFamily('rhs')!.defaults, t: 30 }).ok).toBe(false);
    expect(calcKey({ ...getFamily('key')!.defaults, shaftDia: 200 }).ok).toBe(false);
    expect(calcWasher({ size: 'CUSTOM', d1: 10, d2: 10, h: 1, material: 'SS 304' }).ok).toBe(false);
    expect(calcNut({ size: 'CUSTOM', dia: 10, s: 11, m: 5, material: 'SS 304' }).ok).toBe(false);
    expect(calcRoller({ ...getFamily('roller')!.defaults, stubDia: 60 }).ok).toBe(false);
    expect(calcBushing({ ...getFamily('bushing')!.defaults, outerDia: 20 }).ok).toBe(false);
    expect(calcHexShaft({ ...getFamily('hexshaft')!.defaults, af: NaN }).ok).toBe(false);
    expect(calcStrip({ ...getFamily('wearstrip')!.defaults, holeDia: 40 }).ok).toBe(false);
    expect(calcAngle({ ...getFamily('angle')!.defaults, t: 30 }).ok).toBe(false);
  });
});

describe('engineering values', () => {
  it('RHS 40x40x3 section properties', () => {
    const r = calcRhs({ ...getFamily('rhs')!.defaults, load: 0 }).derived;
    expect(r.Ix).toBeCloseTo((40 ** 4 - 34 ** 4) / 12, 6);
    expect(r.A).toBeCloseTo(40 * 40 - 34 * 34, 9);
  });
  it('RHS beam check: deflection F L^3 / (48 E I)', () => {
    const c = calcRhs({ ...getFamily('rhs')!.defaults, load: 1000, span: 1000 });
    const I = (40 ** 4 - 34 ** 4) / 12, d = (1000 * 1e9) / (48 * 210000 * I);
    expect(c.calculated.some((x) => x.label.startsWith('Mid-span deflection') && Math.abs(Number(x.value) - Math.round(d * 100) / 100) < 0.011)).toBe(true);
  });
  it('polygon section properties of an L angle', () => {
    const p = polyProps([[0, 0], [40, 0], [40, 4], [4, 4], [4, 40], [0, 40]]);
    expect(p.A).toBeCloseTo(40 * 4 + 36 * 4, 9);
    expect(p.cx).toBeCloseTo(p.cy, 9);
    expect(polyProps(rectPoly(0, 0, 10, 20)).Ix).toBeCloseTo((10 * 20 ** 3) / 12, 6);
  });
  it('key: DIN 6885 size, shear and pressure', () => {
    const c = calcKey({ shaftDia: 25, length: 32, torque: 100, sf: 2, material: 'C45 Steel' });
    expect(c.derived.b).toBe(8);
    const F = (2 * 100000) / 25;
    expect(c.calculated.some((x) => x.label.startsWith('Shear stress') && Math.abs(Number(x.value) - Math.round((F / (8 * 32)) * 10) / 10) < 0.11)).toBe(true);
  });
  it('roller deflection 5 F L^3 / (384 E I)', () => {
    const p = { ...getFamily('roller')!.defaults, load: 500 };
    const c = calcRoller(p), d = c.derived, I = (Math.PI / 64) * (d.od ** 4 - d.id ** 4);
    const defl = (5 * 500 * d.L ** 3) / (384 * 210000 * I);
    expect(c.calculated.some((x) => x.label.startsWith('Mid-span deflection') && Math.abs(Number(x.value) - Math.round(defl * 1000) / 1000) < 0.002)).toBe(true);
  });
});

describe('2D picking and edit bindings', () => {
  it('finds a dimension text with an edit binding', () => {
    const f = getFamily('sprocket')!, c = f.calculate(f.defaults), sheet = composeSheet(f.views(c.derived), meta);
    const t = sheet.ents.find((e) => e.t === 'text' && e.edit?.key === 'bore') as Extract<Ent, { t: 'text' }>;
    expect(t).toBeTruthy();
    const i = pickEntity(sheet.ents, t.p[0], t.p[1] + 1, 1.5);
    expect(sheet.ents[i]).toBe(t);
    expect(t.edit!.value).toBe(f.defaults.bore);
    expect(pickEntity(sheet.ents, 5, 5, 1.5)).toBe(-1);
  });
  it('every editable dimension points at a real parameter', () => {
    for (const f of FAMILIES) {
      const c = f.calculate(f.defaults), sheet = composeSheet(f.views(c.derived), meta), keys = new Set(f.fields.map((x) => x.key));
      for (const e of sheet.ents) if (e.t === 'text' && e.edit) { expect(keys.has(e.edit.key)).toBe(true); expect(Number.isFinite(e.edit.value)).toBe(true); }
    }
  });
});
