import { describe, it, expect } from 'vitest';
import { alignCoaxial, buildBom, checkCompatibility, checkInterference, coaxial, exampleAssembly, explodeOffsets, placeAll } from '../src/assembly/model.ts';
import type { AsmItem } from '../src/assembly/model.ts';
import { assemblySheet } from '../src/assembly/drawing.ts';
import { rotMat, apply } from '../src/core/xform.ts';
import { SHEET } from '../src/cad2d/sheet.ts';
import { getFamily } from '../src/families/index.ts';

const ex = () => exampleAssembly();
const shaftWith = (items: AsmItem[], d: number): AsmItem[] => items.map((i) => (i.familyId === 'shaft' ? { ...i, params: { ...i.params, d1: d } } : i));

describe('transforms', () => {
  it('rotates X then Y then Z', () => {
    const p = apply(rotMat([90, 0, 0]), [0, 0, 1]);
    expect(p[1]).toBeCloseTo(-1, 9);
    const q = apply(rotMat([0, 0, 90]), [1, 0, 0]);
    expect(q[1]).toBeCloseTo(1, 9);
  });
});

describe('assembly checks', () => {
  it('the example drive-shaft assembly is valid: nominal fits, no interference', () => {
    const { placed, invalid } = placeAll(ex());
    expect(invalid.length).toBe(0);
    const compat = checkCompatibility(placed), inter = checkInterference(placed);
    expect(compat.filter((i) => i.level === 'error').length).toBe(0);
    expect(compat.filter((i) => i.message.includes('nominal fit')).length).toBe(3);
    expect(inter.length).toBe(0);
  });
  it('a shaft that is too big for the bearing bore is reported as an error and as exact interference', () => {
    const { placed } = placeAll(shaftWith(ex(), 30));
    expect(checkCompatibility(placed).some((i) => i.level === 'error' && i.message.includes('smaller than'))).toBe(true);
    const inter = checkInterference(placed);
    expect(inter.some((i) => i.exact && i.level === 'error')).toBe(true);
  });
  it('a loose bore is a warning', () => {
    const { placed } = placeAll(shaftWith(ex(), 24));
    expect(checkCompatibility(placed).some((i) => i.level === 'warning' && i.message.includes('larger than'))).toBe(true);
  });
  it('a part not on the shaft, and an overlapping pair, are caught', () => {
    const items = ex();
    const moved = items.map((i) => (i.name === 'Bearing A' ? { ...i, pos: [0, 0, 500] as [number, number, number] } : i));
    expect(checkCompatibility(placeAll(moved).placed).some((i) => i.level === 'warning' && i.items.includes('Bearing A'))).toBe(true);
    const overlap = items.map((i) => (i.name === 'Bearing B' ? { ...i, pos: [0, 0, 105] as [number, number, number] } : i));
    expect(checkInterference(placeAll(overlap).placed).some((i) => i.exact && i.items.includes('Bearing B') && i.items.includes('Drive sprocket'))).toBe(true);
  });
  it('different chains trigger a warning', () => {
    const items = ex().concat([{ ...ex()[2], id: 'x', name: 'Other sprocket', params: { ...ex()[2].params, chain: '16B-1', bore: 25, hubDia: 50 }, pos: [0, 0, 150] }]);
    expect(checkCompatibility(placeAll(items).placed).some((i) => i.message.includes('different chains'))).toBe(true);
  });
  it('coaxial detection, alignment and BOM', () => {
    const items = ex(), sh = items[0];
    const loose = items.map((i) => (i.name === 'Bearing A' ? { ...i, pos: [5, 0, 30] as [number, number, number] } : i));
    let p = placeAll(loose).placed;
    expect(coaxial(p[0], p[1])).toBe(false);
    const fixed = alignCoaxial(loose, loose[1].id, sh.id, 40);
    p = placeAll(fixed).placed;
    expect(coaxial(p[0], p[1])).toBe(true);
    expect(p[1].item.pos[2]).toBe(40);
    const bom = buildBom(placeAll(items).placed);
    expect(bom.length).toBe(3);
    expect(bom.find((r) => r.partNo === 'BB-6205')!.qty).toBe(2);
  });
  it('explode offsets move parts apart; invalid items are reported', () => {
    const { placed } = placeAll(ex());
    const off = explodeOffsets(placed, 0.5, 100);
    expect(off.length).toBe(placed.length);
    expect(off.some((o) => Math.hypot(o[0], o[1], o[2]) > 1)).toBe(true);
    const bad = placeAll([{ id: 'b', familyId: 'shaft', name: 'bad', params: { ...getFamily('shaft')!.defaults, d1: 0 }, pos: [0, 0, 0], rot: [0, 0, 0] }]);
    expect(bad.invalid.length).toBe(1);
  });
  it('assembly drawing has 4 views inside the sheet and a BOM in the notes', () => {
    const { placed } = placeAll(ex());
    const { sheet, meta } = assemblySheet('Drive shaft', placed, 'A');
    expect(meta.notes.some((n) => n.includes('BB-6205'))).toBe(true);
    for (const e of sheet.ents) {
      const pts = e.t === 'line' ? [e.a, e.b] : e.t === 'poly' ? e.pts : e.t === 'text' ? [e.p] : [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
      for (const p of pts) { expect(p[0]).toBeGreaterThan(9.99); expect(p[0]).toBeLessThan(SHEET.w - 9.99); expect(p[1]).toBeGreaterThan(9.99); expect(p[1]).toBeLessThan(SHEET.h - 9.99); }
    }
  });
});

import { rollerConveyor, rollerConveyorDefaults } from '../src/assembly/presets.ts';

describe('roller conveyor preset', () => {
  it('builds frames and rollers that pass every check', () => {
    const items = rollerConveyor(rollerConveyorDefaults), { placed, invalid } = placeAll(items);
    expect(invalid.length).toBe(0);
    expect(items.filter((i) => i.familyId === 'roller').length).toBe(12);
    const bom = buildBom(placed);
    expect(bom.find((r) => r.name === 'U-channel (chain guide / side frame)')!.qty).toBe(2);
    expect(checkCompatibility(placed).filter((i) => i.level === 'error').length).toBe(0);
    expect(checkInterference(placed).length).toBe(0);
  });
  it('rollers span exactly between the inner web faces', () => {
    const items = rollerConveyor({ ...rollerConveyorDefaults, width: 500 }), r = items.find((i) => i.familyId === 'roller')!;
    const p = r.params as { tubeLength: number; stubLength: number };
    expect(r.pos[2] + p.tubeLength + p.stubLength).toBeCloseTo(250, 9);
    expect(r.pos[2] - p.stubLength).toBeCloseTo(-250, 9);
  });
  it('rejects impossible inputs and reports overlapping rollers', () => {
    expect(() => rollerConveyor({ ...rollerConveyorDefaults, pitch: 50 })).toThrow();
    expect(() => rollerConveyor({ ...rollerConveyorDefaults, width: 60 })).toThrow();
    expect(() => rollerConveyor({ ...rollerConveyorDefaults, length: NaN })).toThrow();
    const items = rollerConveyor(rollerConveyorDefaults).map((i) => (i.name === 'Roller 2' ? { ...i, pos: [i.pos[0] - 60, i.pos[1], i.pos[2]] as [number, number, number] } : i));
    expect(checkInterference(placeAll(items).placed).length).toBeGreaterThan(0);
  });
});
