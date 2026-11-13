import { describe, it, expect } from 'vitest';
import { FAMILIES } from '../src/families/index.ts';
import { buildDesign } from '../src/lib/design.ts';
import { toDxf } from '../src/exporters/dxf.ts';
import { sheetToSvg } from '../src/exporters/svg.ts';
import { repairParams } from '../src/storage/project.ts';
import type { Params } from '../src/core/types.ts';

/** Reliability: whatever values a person (or a damaged file) puts in, the app must either give a complete, finite
 *  drawing + model, or refuse with a readable error. It must never throw, and never output NaN / Infinity. */
let seed = 20261113;
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function sets(f: (typeof FAMILIES)[number]): { tag: string; p: Params }[] {
  const out: { tag: string; p: Params }[] = [{ tag: 'defaults', p: { ...f.defaults } }];
  const nums = f.fields.filter((x) => x.kind === 'number');
  for (let i = 0; i < 12; i++) { // random values inside each field's own limits
    const p = { ...f.defaults };
    for (const x of nums) if (x.min !== undefined && x.max !== undefined && x.max > x.min) p[x.key] = +(x.min + rnd() * (x.max - x.min)).toFixed(2);
    out.push({ tag: `random${i}`, p });
  }
  for (const x of nums) { // each number at its limits, and at hostile values
    for (const [tag, v] of [['min', x.min], ['max', x.max], ['zero', 0], ['negative', -5], ['huge', 1e9], ['nan', NaN], ['inf', Infinity]] as [string, number | undefined][]) if (v !== undefined) out.push({ tag: `${x.key}=${tag}`, p: { ...f.defaults, [x.key]: v } });
  }
  for (const x of f.fields.filter((y) => y.kind === 'select')) for (const o of x.options ?? []) out.push({ tag: `${x.key}=${o.value}`, p: { ...f.defaults, [x.key]: o.value } });
  return out;
}
const finite = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v && typeof v === 'object' ? Object.values(v as object).every(finite) : true);

describe('no input can crash a component, or produce broken output', () => {
  for (const f of FAMILIES) {
    it(`${f.id}`, () => {
      let okCount = 0, refused = 0;
      for (const { tag, p } of sets(f)) {
        let d;
        try { d = buildDesign(f, p, 'A'); } catch (e) { throw new Error(`${f.id} [${tag}] threw: ${e instanceof Error ? e.message : e}`); }
        if (!d.calc.ok) { refused++; expect(d.calc.errors.length, `${f.id} [${tag}] refused without a reason`).toBeGreaterThan(0); expect(d.sheet).toBeNull(); continue; }
        okCount++;
        expect(d.sheet, `${f.id} [${tag}] no sheet`).not.toBeNull();
        expect(d.geo && d.geo.length, `${f.id} [${tag}] no 3D parts`).toBeGreaterThan(0);
        expect(finite(d.sheet!.ents), `${f.id} [${tag}] non-finite drawing coordinate`).toBe(true);
        expect(finite(d.geo), `${f.id} [${tag}] non-finite 3D coordinate`).toBe(true);
        const dxf = toDxf(d.sheet!.ents), svg = sheetToSvg(d.sheet!);
        expect(/NaN|Infinity|undefined/.test(dxf), `${f.id} [${tag}] bad DXF text`).toBe(false);
        expect(/NaN|Infinity|undefined/.test(svg), `${f.id} [${tag}] bad SVG text`).toBe(false);
        expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
        for (const r of [...d.calc.calculated]) expect(/NaN|Infinity/.test(String(r.value)), `${f.id} [${tag}] result "${r.label}" = ${r.value}`).toBe(false);
      }
      expect(okCount).toBeGreaterThan(3); expect(refused + okCount).toBeGreaterThan(5);
    });
  }
});

describe('a damaged saved design still opens', () => {
  for (const f of FAMILIES) {
    it(`${f.id}: repairParams turns garbage into valid parameters`, () => {
      const junk: Record<string, unknown> = {}; for (const x of f.fields) junk[x.key] = { bad: true };
      const fixed = repairParams(f, junk);
      expect(buildDesign(f, fixed, 'A').calc.ok).toBe(true);
      expect(Object.keys(fixed).sort()).toEqual(Object.keys({ ...f.defaults }).sort().filter((k) => k in fixed));
    });
  }
});

describe('regression: every built-in design still opens through the full pipeline (including the limits check)', () => {
  for (const f of FAMILIES) {
    it(`${f.id}: ${f.variants.length} variant(s)`, () => {
      for (const v of f.variants) { const d = buildDesign(f, { ...f.defaults, ...v.params }, 'A'); expect(d.calc.ok, `${f.id}/${v.id}: ${d.calc.errors.join(' ')}`).toBe(true); expect(d.sheet).not.toBeNull(); }
    });
  }
});
