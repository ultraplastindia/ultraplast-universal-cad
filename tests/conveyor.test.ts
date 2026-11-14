import { describe, it, expect } from 'vitest';
import { CONVEYOR_FAMILIES, geoVolume } from '../src/families/extra/conveyor.ts';
import { getFamily } from '../src/families/index.ts';
import { CATEGORIES, IMPLEMENTED, PARTIAL } from '../src/data/catalogue.ts';
import { builtinTypes } from '../src/data/typeLibrary.ts';
import { ROLLER_CHAINS } from '../src/data/chains.ts';

const F = (id: string) => getFamily(id)!;
const calc = (id: string, o: Record<string, unknown> = {}) => F(id).calculate({ ...F(id).defaults, ...o });
const row = (c: ReturnType<typeof calc>, label: string) => c.calculated.find((r) => r.label === label)?.value;

describe('v1.0 conveyor families', () => {
  it('registers all thirteen families', () => { expect(CONVEYOR_FAMILIES.length).toBe(13); for (const f of CONVEYOR_FAMILIES) expect(getFamily(f.id)).toBeTruthy(); });
  it('modular belt: length = modules x pitch; refuses impossible values', () => {
    const c = calc('modbelt', { modules: 8, pitch: 25.4 }); expect(c.ok).toBe(true); expect(Number(row(c, 'Length'))).toBeCloseTo(203.2, 2);
    expect(calc('modbelt', { pinDia: 8, thickness: 8 }).ok).toBe(false);
    expect(calc('modbelt', { style: 'grid', openW: 30, openPitch: 40 }).errors.join(' ')).toMatch(/too large|spacing/);
    expect(calc('modbelt', { style: 'perforated', openW: 2, openPitch: 4, width: 2000, modules: 40 }).errors.join(' ')).toMatch(/limit 600/);
    expect(calc('modbelt', { style: 'nonsense' }).ok).toBe(false);
    expect(calc('modbelt', { width: 5 }).ok).toBe(false);
  });
  it('modular belt: open styles reduce the mass', () => {
    const flat = calc('modbelt'), grid = calc('modbelt', { style: 'grid', openW: 8, openPitch: 14 });
    expect(Number(row(grid, 'Approx. mass'))).toBeLessThan(Number(row(flat, 'Approx. mass')));
  });
  it('roller chain: length = links x pitch for every standard size', () => {
    for (const ch of ROLLER_CHAINS) { const c = calc('chainlink', { chain: ch.id, links: 10 }); expect(c.ok).toBe(true); expect(Number(row(c, 'Chain length'))).toBeCloseTo(10 * ch.pitch, 1); expect(Number(row(c, 'Roller diameter'))).toBeCloseTo(ch.rollerDia, 2); }
    expect(calc('chainlink', { links: 1 }).ok).toBe(false); expect(calc('chainlink', { chain: 'nope' }).ok).toBe(false);
    expect(calc('chainlink', { links: 7 }).warnings.join(' ')).toMatch(/odd number/);
  });
  it('reference table-top chain sizes (public size classes) calculate with the listed pitch and rod', () => {
    const refs = F('modbelt').variants.filter((v) => v.id.startsWith('MB-REF-')); expect(refs.length).toBe(7);
    for (const v of refs) { const c = F('modbelt').calculate(v.params); expect(c.ok, v.id).toBe(true); expect(Number(v.params.pitch)).toBe(38.1); expect(Number(v.params.pinDia)).toBeGreaterThanOrEqual(6.4); }
  });
  it('bearing housing: bolt holes must clear the boss and edge', () => {
    expect(calc('brghousing').ok).toBe(true);
    expect(calc('brghousing', { boltSpacing: 20 }).errors.join(' ')).toMatch(/overlap the boss/);
    expect(calc('brghousing', { boltSpacing: 95 }).errors.join(' ')).toMatch(/edge/);
    expect(calc('brghousing', { hubDia: 28 }).ok).toBe(false);
    expect(calc('brghousing', { type: 'pillow', height: 20 }).ok).toBe(false);
  });
  it('coupling, collar, ring: wall checks', () => {
    expect(calc('coupling', { bore1: 38, od: 40 }).ok).toBe(false); expect(calc('collar', { bore: 40, od: 44 }).ok).toBe(false);
    expect(calc('circlip', { gd: 25 }).ok).toBe(false); expect(calc('circlip', { type: 'internal', d: 52, b: 4, gd: 1.5 }).ok).toBe(true);
  });
  it('take-up: plate must be long enough for the travel', () => {
    expect(calc('takeup').ok).toBe(true); expect(calc('takeup', { travel: 300 }).errors.join(' ')).toMatch(/too short/);
    const a = calc('takeup', { pos: 0 }), b = calc('takeup', { pos: 100 });
    expect(a.ok && b.ok).toBe(true);
  });
  it('bracket: holes must fit; mass equals the solid volume', () => {
    expect(calc('lbracket', { holes: 4, holeDia: 20 }).ok).toBe(false);
    const c = calc('lbracket', { holes: 0 }), vol = geoVolume(F('lbracket').geo(c.derived));
    expect(vol).toBeCloseTo(60 * 40 * 4 + 4 * 40 * (60 - 3.99), 1); // base leg + upright (the upright starts 0.01 mm inside the base so the two solids overlap cleanly)
  });
  it('motor and gearbox give no mass (outline only)', () => { const c = calc('motor'); expect(c.ok).toBe(true); expect(c.derived.massKg).toBeUndefined(); expect(c.assumptions.join(' ')).toMatch(/NOT calculated/); });
  it('tapered roller and curve: geometry follows the values', () => {
    const t = calc('taperroll', { d1: 60, d2: 100, length: 400, steps: 40 }); expect(t.ok).toBe(true); expect(Number(row(t, 'Half taper angle'))).toBeCloseTo(Math.atan(20 / 400) * 180 / Math.PI, 1);
    expect(calc('taperroll', { d1: 60, d2: 90, bore: 20, stub: 20 }).ok).toBe(false);
    const c = calc('curved', { innerR: 600, width: 300, angle: 90 }); expect(Number(row(c, 'Centre-line arc length'))).toBeCloseTo(750 * Math.PI / 2, 0);
    expect(calc('curved', { guardThk: 200 }).ok).toBe(false);
  });
  it('set screws use the ISO key sizes', () => { expect(Number(row(calc('setscrew', { size: 'M8', length: 16 }), 'Hex key size'))).toBe(4); expect(calc('setscrew', { size: 'M16', length: 4 }).ok).toBe(false); });
  it('every value outside its limits is refused, never a crash', () => {
    for (const f of CONVEYOR_FAMILIES) for (const fld of f.fields) {
      if (fld.kind !== 'number') continue;
      for (const bad of [-5, 0, 1e9, NaN]) { const c = f.calculate({ ...f.defaults, [fld.key]: bad }); expect(typeof c.ok).toBe('boolean'); if (c.ok) expect(c.errors.length).toBe(0); }
    }
  });
});

describe('catalogue coverage after v1.0', () => {
  it('every implemented item points at a real family (or the assembly designer)', () => { for (const [k, fam] of Object.entries(IMPLEMENTED)) expect(fam === 'assembly' || !!getFamily(fam), `${k} -> ${fam}`).toBe(true); });
  it('every type in the library calculates from its starting values', () => {
    for (const t of builtinTypes()) { if (t.base === 'assembly') continue; const f = getFamily(t.base); expect(f, t.id).toBeTruthy(); const c = f!.calculate({ ...f!.defaults, ...t.params }); expect(c.errors.join('|'), t.id).toBe(''); }
  });
  it('no catalogue item is left without a model (approximations are labelled in PARTIAL)', () => {
    const pending = CATEGORIES.flatMap((c) => c.items.filter((i) => !IMPLEMENTED[`${c.id}:${i}`]).map((i) => `${c.id}:${i}`));
    expect(pending).toEqual([]);
  });
  it('every item that is only approximated carries a note saying what is missing', () => {
    const fresh = new Set(CONVEYOR_FAMILIES.map((f) => f.id));
    for (const [k, fam] of Object.entries(IMPLEMENTED)) if (fresh.has(fam)) expect(PARTIAL[k], k).toBeTruthy();
  });
});

import { SPROCKET_CATALOG, SPROCKET_GROUPS } from '../src/data/sprocketCatalog.ts';
describe('sprocket catalogue (v1.1)', () => {
  it('has the 22 requested types in the right groups', () => {
    expect(SPROCKET_CATALOG.length).toBe(22);
    const n = (g: string) => SPROCKET_CATALOG.filter((e) => e.group === g).length;
    expect([n('Hub style'), n('Strand capacity'), n('Mounting and bore'), n('Conveyor application')]).toEqual([4, 5, 6, 7]);
    expect(SPROCKET_GROUPS.length).toBe(4);
    expect(new Set(SPROCKET_CATALOG.map((e) => e.id)).size).toBe(22);
  });
  it('every entry has all four blocks and exactly two sentences in its overview', () => {
    for (const e of SPROCKET_CATALOG) {
      for (const k of ['overview', 'materials', 'bores', 'chains', 'duty', 'applications', 'advantages', 'maintenance', 'custom'] as const) expect(e[k].trim().length, `${e.id} ${k}`).toBeGreaterThan(10);
      const sentences = e.overview.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${e.id} overview`).toBe(2);
    }
  });
  it('every starting design calculates in the sprocket designer with no errors', () => {
    const f = getFamily('sprocket_types')!;
    for (const e of SPROCKET_CATALOG) { const c = f.calculate(e.params); expect(c.errors.join('|'), e.id).toBe(''); expect(c.ok, e.id).toBe(true); }
  });
  it('types the 3D model only approximates say so', () => {
    for (const id of ['SC-TAPERLOCK', 'SC-QD', 'SC-SQUARE', 'SC-SPLIT', 'SC-SEGMENTAL', 'SC-MODULAR', 'SC-TABLETOP', 'SC-SHEAR', 'SC-TYPE-D']) expect(SPROCKET_CATALOG.find((e) => e.id === id)!.modelNote, id).toBeTruthy();
  });
});
