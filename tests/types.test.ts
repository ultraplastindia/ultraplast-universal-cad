import { describe, it, expect } from 'vitest';
import { getFamily } from '../src/families/index.ts';
import { builtinTypes, mergeTypes } from '../src/data/typeLibrary.ts';
import { totalItems } from '../src/data/catalogue.ts';

describe('component type library', () => {
  const types = builtinTypes();
  it('has a type for every catalogue item plus the 12 sprocket styles, with unique ids', () => {
    expect(types.length).toBe(totalItems() + 12);
    expect(new Set(types.map((t) => t.id)).size).toBe(types.length);
  });
  it('every type points to a real base and its starting values calculate without errors', () => {
    for (const t of types) {
      if (t.base === 'assembly') continue;
      const f = getFamily(t.base);
      expect(f).toBeDefined();
      const c = f!.calculate({ ...f!.defaults, ...t.params });
      if (!c.ok) throw new Error(`${t.id} (${t.base}): ${c.errors.join(' ')}`);
    }
  });
  it('a database type with the same id replaces the built-in one', () => {
    const t = types[0], m = mergeTypes(types, [{ ...t, name: 'Changed', builtin: false }]);
    expect(m.length).toBe(types.length);
    expect(m.find((x) => x.id === t.id)!.name).toBe('Changed');
  });
});
describe('sprocket types', () => {
  const f = getFamily('sprocket_types')!;
  it('duplex is wider than single and heavier; double single keeps a gap', () => {
    const single = f.calculate(f.variants.find((v) => v.id === 'SPM-SIMPLEX')!.params), duplex = f.calculate(f.variants.find((v) => v.id === 'SPM-DUPLEX')!.params), ds = f.calculate(f.variants.find((v) => v.id === 'SPM-DOUBLE-SINGLE')!.params);
    expect(single.ok && duplex.ok && ds.ok).toBe(true);
    expect(duplex.derived.total).toBeGreaterThan(single.derived.total);
    expect(duplex.derived.massKg).toBeGreaterThan(single.derived.massKg);
    expect(ds.derived.layout.some((l: { kind: string }) => l.kind === 'core')).toBe(true);
  });
  it('rejects bad values with a message', () => {
    const base = f.defaults;
    expect(f.calculate({ ...base, strands: 2, strandPitch: 3 }).ok).toBe(false);
    expect(f.calculate({ ...base, boltCount: 3, boltPcd: 40, boltDia: 6 }).ok).toBe(false);          // bolts need a hub
    expect(f.calculate({ ...base, hubLength: 20, hubDia: 40, boltCount: 3, boltPcd: 90, boltDia: 6 }).ok).toBe(false); // bolts outside hub
  });
});
