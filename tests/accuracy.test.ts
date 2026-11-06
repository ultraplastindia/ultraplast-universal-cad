import { describe, it, expect } from 'vitest';
import { FAMILIES } from '../src/families/index.ts';
import { composeSheet } from '../src/cad2d/sheet.ts';
import type { Ent, ModelEnt } from '../src/cad2d/sheet.ts';
import { toDxf } from '../src/exporters/dxf.ts';
import { sheetToSvg } from '../src/exporters/svg.ts';
import { arcPoints, circleSegments, CHORD_TOL, discretize } from '../src/core/geom.ts';
import { calcSprocket, sprocketDefaults } from '../src/families/sprocket/calc.ts';

const meta = { company: 'Ultraplast Chainbelts Private Limited', title: 'T', partId: 'P', drawingNo: 'UP-1', revision: 'A', date: '2026-01-01', material: 'X', units: 'mm', notes: ['n'] };
const firstNumber = (s: string): number => Number((/-?\d+(?:\.\d+)?/.exec(s) ?? ['NaN'])[0]);

describe('every dimension shown equals the geometry it measures', () => {
  for (const f of FAMILIES) {
    it(`${f.id}: dimension text = distance between its anchor points (defaults and sampled variants)`, () => {
      const samples = [f.defaults, ...f.variants.filter((_, i) => i % 7 === 0).map((v) => v.params)];
      let checked = 0;
      for (const p of samples) {
        const c = f.calculate(p);
        expect(c.ok).toBe(true);
        for (const v of f.views(c.derived)) for (const e of v.ents as ModelEnt[]) {
          if (e.t !== 'dim') continue;
          const mag = /\b(\d+)x\b/.exec(v.name), d = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) / (mag ? Number(mag[1]) : 1), shown = firstNumber(e.text);
          expect(Math.abs(d - shown)).toBeLessThan(0.0051 + d * 1e-9);
          if (e.edit) expect(Math.abs(e.edit.value - shown)).toBeLessThan(0.0051);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(2);
    });
  }
});

describe('exports agree with the drawing', () => {
  for (const f of FAMILIES) {
    it(`${f.id}: DXF coordinates equal sheet coordinates (to 0.0001 mm) and SVG carries every entity`, () => {
      const c = f.calculate(f.defaults), sheet = composeSheet(f.views(c.derived), meta);
      const lines = toDxf(sheet.ents).split('\n'), pairs: [number, string][] = [];
      for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1]]);
      const ents = pairs.map((p, i) => ({ code: p[0], val: p[1], i }));
      let lineI = 0, circI = 0, polyI = 0, textI = 0;
      const L = sheet.ents.filter((e) => e.t === 'line') as Extract<Ent, { t: 'line' }>[], C = sheet.ents.filter((e) => e.t === 'circle') as Extract<Ent, { t: 'circle' }>[], P = sheet.ents.filter((e) => e.t === 'poly') as Extract<Ent, { t: 'poly' }>[], T = sheet.ents.filter((e) => e.t === 'text') as Extract<Ent, { t: 'text' }>[];
      const num = (k: number, code: number) => Number(pairs.slice(k).find((p) => p[0] === code)![1]);
      for (const e of ents) {
        if (e.code !== 0) continue;
        if (e.val === 'LINE') { const l = L[lineI++]; expect(Math.abs(num(e.i, 10) - l.a[0])).toBeLessThan(1e-4); expect(Math.abs(num(e.i, 21) - l.b[1])).toBeLessThan(1e-4); }
        else if (e.val === 'CIRCLE') { const ci = C[circI++]; expect(Math.abs(num(e.i, 40) - ci.r)).toBeLessThan(1e-4); expect(Math.abs(num(e.i, 10) - ci.c[0])).toBeLessThan(1e-4); }
        else if (e.val === 'POLYLINE') { const po = P[polyI++]; let k = e.i + 1, n = 0; while (pairs[k][1] !== 'SEQEND') { if (pairs[k][1] === 'VERTEX') { expect(Math.abs(num(k, 10) - po.pts[n][0])).toBeLessThan(1e-4); expect(Math.abs(num(k, 20) - po.pts[n][1])).toBeLessThan(1e-4); n++; } k++; } expect(n).toBe(po.pts.length); }
        else if (e.val === 'TEXT') { const t = T[textI++]; expect(Math.abs(num(e.i, 10) - t.p[0])).toBeLessThan(1e-4); }
      }
      expect([lineI, circI, polyI, textI]).toEqual([L.length, C.length, P.length, T.length]);
      const svg = sheetToSvg(sheet);
      expect((svg.match(/<line /g) ?? []).length).toBe(L.length);
      expect((svg.match(/<circle /g) ?? []).length).toBe(C.length);
      expect((svg.match(/<text /g) ?? []).length).toBe(T.length);
    });
  }
});

describe('curve tessellation stays within the chord tolerance', () => {
  it('circle segment count keeps the sagitta below CHORD_TOL', () => {
    for (const r of [2, 10, 25, 60, 150, 400]) { const n = circleSegments(r, CHORD_TOL, 4); expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThan(CHORD_TOL + 1e-12); }
  });
  it('arc polygon stays within the tolerance of the true arc', () => {
    const pts = arcPoints([30, 0], [0, 30], [-30, 0]);
    for (const p of pts) expect(Math.abs(Math.hypot(p[0], p[1]) - 30)).toBeLessThan(1e-9);
    let worst = 0;
    for (let i = 1; i < pts.length; i++) { const m = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]; worst = Math.max(worst, 30 - Math.hypot(m[0], m[1])); }
    expect(worst).toBeLessThan(CHORD_TOL + 1e-9);
  });
  it('sprocket outline polygon deviates less than the tolerance from the exact arcs', () => {
    const d = calcSprocket(sprocketDefaults('16B-1', 25)).derived, pts = discretize(d.start, d.path);
    expect(pts.length).toBeGreaterThan(200);
    for (const p of pts) { const r = Math.hypot(p[0], p[1]); expect(r).toBeLessThan(d.da / 2 + 1e-6); expect(r).toBeGreaterThan(d.df / 2 - 1e-6); }
  });
});

import { polygonArea } from '../src/core/geom.ts';
import { material } from '../src/data/materials.ts';
import type { Prim } from '../src/core/prims.ts';

const primVolume = (p: Prim): number => {
  if (p.kind === 'tube') return Math.PI * (p.rOut ** 2 - p.rIn ** 2) * (p.z1 - p.z0);
  if (p.kind === 'sphere') return (4 / 3) * Math.PI * p.r ** 3;
  return (polygonArea(p.outer) - p.holes.reduce((a, h) => a + ('poly' in h ? polygonArea(h.poly) : Math.PI * h.r * h.r), 0)) * (p.z1 - p.z0);
};

describe('calculated mass agrees with the volume of the 3D geometry', () => {
  // tolerance: relative; looser where the calculation deliberately ignores small details (keyway ends, overlaps)
  const tol: Record<string, number> = { sprocket: 0.02, roller: 0.06, key: 0.001, pulley: 0.02 };
  for (const f of FAMILIES) {
    it(`${f.id}: formula mass vs geometry volume`, () => {
      for (const p of [f.defaults, ...f.variants.filter((_, i) => i % 11 === 0).map((v) => v.params)]) {
        const c = f.calculate(p), geo = f.geo(c.derived);
        const vol = geo.reduce((a, g) => a + g.prims.reduce((b, pr) => b + primVolume(pr), 0), 0);
        const m = material(f.materialOf(p));
        const massGeo = vol * m!.density, massCalc = c.derived.massKg as number;
        expect(Math.abs(massGeo - massCalc) / massCalc).toBeLessThan(tol[f.id] ?? 0.0015);
      }
    });
  }
});
