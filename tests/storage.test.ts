import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject } from '../src/storage/project.ts';
import { calcSprocket, SPROCKET_FIELDS, sprocketDefaults } from '../src/families/sprocket/calc.ts';
import { searchCatalogue, suggest } from '../src/lib/search.ts';
import type { Family } from '../src/core/family.ts';

const fam = { id: 'sprocket', fields: SPROCKET_FIELDS, defaults: sprocketDefaults('08B-1', 17) };
const mk = (params: Record<string, unknown>) => JSON.stringify({ format: 'ultraplast-project', version: 1, project: { name: 'x', familyId: 'sprocket', revision: 'B', params } });

describe('project import/export', () => {
  it('round-trips parameters', () => {
    const now = new Date().toISOString();
    const text = serializeProject({ id: 'a', name: 'Test', familyId: 'sprocket', params: fam.defaults, revision: 'A', createdAt: now, updatedAt: now });
    const p = parseProject(text, [fam]);
    expect(p.name).toBe('Test');
    expect(p.params.teeth).toBe(17);
    expect(calcSprocket(p.params).ok).toBe(true);
  });
  it('rejects bad files and repairs bad values', () => {
    expect(() => parseProject('nope', [fam])).toThrow();
    expect(() => parseProject('{"format":"other"}', [fam])).toThrow();
    expect(() => parseProject(JSON.stringify({ format: 'ultraplast-project', version: 1, project: { familyId: 'zzz', params: {} } }), [fam])).toThrow();
    const p = parseProject(mk({ teeth: 'abc', chain: 'NOPE', material: 'Nylon PA6', evil: 1 }), [fam]);
    expect(p.params.teeth).toBe(17);
    expect(p.params.chain).toBe('08B-1');
    expect(p.params.material).toBe('Nylon PA6');
    expect('evil' in p.params).toBe(false);
  });
});

describe('search', () => {
  const f = { id: 'sprocket', name: 'Roller chain sprocket', category: 'B', subcategory: 's', description: 'd', keywords: ['sprocket'], materials: ['C45 Steel'], applications: [], standards: [], related: [], variants: [{ id: 'SP-08B1-Z17', name: '08B-1 17 teeth', params: {} }, { id: 'SP-10B1-Z19', name: '10B-1 19 teeth', params: {} }] } as unknown as Family;
  it('finds families and narrows variants by part number', () => {
    expect(searchCatalogue([f], 'sprocket').hits.length).toBe(1);
    const r = searchCatalogue([f], 'sprocket 10b1');
    expect(r.hits[0].variantCount).toBe(1);
    expect(searchCatalogue([f], 'zzzz').hits.length).toBe(0);
    expect(searchCatalogue([f], 'sprocket', { material: 'Nylon PA6' }).hits.length).toBe(0);
  });
  it('lists pending catalogue items and suggests', () => {
    expect(searchCatalogue([f], 'tabletop').pending.length).toBeGreaterThan(0);
    expect(suggest([f], 'sproc')).toContain('Roller chain sprocket');
  });
});

import { parseAssembly, serializeAssembly } from '../src/storage/project.ts';
import { exampleAssembly } from '../src/assembly/model.ts';
import { FAMILIES } from '../src/families/index.ts';

describe('assembly files', () => {
  it('round-trips an assembly and repairs bad data', () => {
    const now = new Date().toISOString(), items = exampleAssembly();
    const a = parseAssembly(serializeAssembly({ id: 'x', name: 'A', items, createdAt: now, updatedAt: now }), FAMILIES);
    expect(a.items.length).toBe(4);
    expect(a.items[2].params.teeth).toBe(17);
    const bad = JSON.stringify({ format: 'ultraplast-assembly', version: 1, assembly: { name: 'B', items: [{ familyId: 'shaft', params: { d1: 'abc' }, pos: [1, 'x', 3], rot: null }] } });
    const b = parseAssembly(bad, FAMILIES);
    expect(b.items[0].pos).toEqual([0, 0, 0]);
    expect(b.items[0].params.d1).toBe(25);
    expect(() => parseAssembly(JSON.stringify({ format: 'ultraplast-assembly', version: 1, assembly: { items: [{ familyId: 'nope' }] } }), FAMILIES)).toThrow();
    expect(() => parseAssembly('{"format":"x"}', FAMILIES)).toThrow();
  });
});
