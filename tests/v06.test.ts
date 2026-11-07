import { describe, it, expect } from 'vitest';
import { getFamily } from '../src/families/index.ts';
import { parseList, formatList } from '../src/families/custom/turned.ts';
import { profileRuns, turnedFromMask, steppedFromMask } from '../src/lib/trace.ts';
import { parseAnalysis } from '../api/_lib/aiShapes.ts';

/** a solid shape drawn into a w x h mask from column/row extents (centred on the middle line) */
function turnedMask(w: number, h: number, cols: [number, number][]): Uint8Array {
  const m = new Uint8Array(w * h); let x = 5;
  for (const [len, dia] of cols) { for (let i = 0; i < len; i++, x++) for (let y = Math.round(h / 2 - dia / 2); y < Math.round(h / 2 + dia / 2); y++) m[y * w + x] = 1; }
  return m;
}

describe('profile runs', () => {
  it('finds steps and ignores blur', () => {
    const v = [20, 20, 21, 20, 20, 40, 40, 40, 39, 40, 20, 20, 20, 20];
    const r = profileRuns(v, 2, 2);
    expect(r.length).toBe(3);
    expect(r.map((x) => Math.round(x.value))).toEqual([20, 40, 20]);
  });
  it('merges a one-pixel spike into its neighbours', () => {
    const r = profileRuns([20, 20, 20, 20, 30, 20, 20, 20, 20], 2, 2);
    expect(r.length).toBe(1);
  });
});

describe('turned part from a silhouette', () => {
  const w = 200, h = 80, m = turnedMask(w, h, [[40, 20], [80, 40], [40, 20]]);
  it('reads three sections and scales to the entered overall length', () => {
    const t = turnedFromMask(m, w, h, 'x', 'length', 160);
    if ('error' in t) throw new Error(t.error);
    expect(t.sections.length).toBe(3);
    expect(t.sections.reduce((a, s) => a + s.length, 0)).toBeCloseTo(160, 1);
    expect(t.sections[1].length).toBeCloseTo(80, 0);
    expect(t.sections[1].diameter).toBeCloseTo(40, 0);
    expect(t.sections[0].diameter).toBeCloseTo(20, 0);
  });
  it('scales to the entered largest diameter', () => {
    const t = turnedFromMask(m, w, h, 'x', 'diameter', 50);
    if ('error' in t) throw new Error(t.error);
    expect(t.sections[1].diameter).toBeCloseTo(50, 0);
    expect(t.sections[1].length).toBeCloseTo(100, 0);
  });
  it('the result goes straight into the custom_turned family', () => {
    const t = turnedFromMask(m, w, h, 'x', 'length', 160);
    if ('error' in t) throw new Error(t.error);
    const f = getFamily('custom_turned')!;
    const c = f.calculate({ ...f.defaults, sections: formatList(t.sections.map((s) => [s.length, s.diameter])) });
    expect(c.ok).toBe(true);
  });
  it('rejects an empty picture', () => { expect('error' in turnedFromMask(new Uint8Array(100), 10, 10, 'x', 'length', 50)).toBe(true); });
});

describe('stepped block from a front view', () => {
  it('reads bottom block wide and top block narrow', () => {
    const w = 100, h = 90, m = new Uint8Array(w * h);
    for (let y = 60; y < 90; y++) for (let x = 0; x < 100; x++) m[y * w + x] = 1; // base 100 wide x 30 high at the bottom
    for (let y = 20; y < 60; y++) for (let x = 30; x < 70; x++) m[y * w + x] = 1; // top 40 wide x 40 high
    const s = steppedFromMask(m, w, h, 'width', 200);
    if ('error' in s) throw new Error(s.error);
    expect(s.slabs.length).toBe(2);
    expect(s.slabs[0].width).toBeCloseTo(200, 0); expect(s.slabs[1].width).toBeCloseTo(80, 0);
    expect(s.slabs[0].height).toBeCloseTo(60, 0); expect(s.slabs[1].height).toBeCloseTo(80, 0);
  });
});

describe('text lists', () => {
  it('parses and formats', () => { expect(parseList('1,2; 3,4', 2, 'section', 12)).toEqual([[1, 2], [3, 4]]); expect(formatList([[1.234, 2]])).toBe('1.23,2'); });
  it('explains errors', () => {
    expect(typeof parseList('1,2,3', 2, 'section', 12)).toBe('string');
    expect(typeof parseList('a,b', 2, 'section', 12)).toBe('string');
    expect(typeof parseList('', 2, 'section', 12)).toBe('string');
    expect(typeof parseList(Array(13).fill('1,1').join(';'), 2, 'section', 12)).toBe('string');
  });
});

describe('new families', () => {
  it('stepped block mass equals the sum of its blocks', () => {
    const f = getFamily('custom_stepped')!;
    const c = f.calculate({ ...f.defaults, slabs: '100,60,10; 50,40,20', holeDia: 0, material: 'S235 Steel' });
    expect(c.ok).toBe(true);
    const expected = (100 * 60 * 10 + 50 * 40 * 20) * 7.85e-6;
    expect(((c.derived as { massKg: number }).massKg)).toBeCloseTo(expected, 3);
  });
  it('rejects a hole bigger than the smallest block and a bore bigger than a section', () => {
    expect(getFamily('custom_stepped')!.calculate({ ...getFamily('custom_stepped')!.defaults, holeDia: 45 }).ok).toBe(false);
    expect(getFamily('custom_turned')!.calculate({ ...getFamily('custom_turned')!.defaults, bore: 30 }).ok).toBe(false);
  });
});

describe('AI answer reader', () => {
  it('reads a fenced turned answer and clamps junk', () => {
    const a = parseAnalysis('```json\n{"kind":"turned","name":"Shaft","material":"Steel","notes":"ok","turned":{"sections":[{"length":2,"diameter":1},{"length":"5","diameter":2},{"length":-1,"diameter":3}],"bore":0}}\n```');
    if ('error' in a) throw new Error(a.error);
    expect(a.kind).toBe('turned'); expect(a.turned!.sections.length).toBe(2);
  });
  it('falls back to other when the data for the kind is missing, and rejects non-JSON', () => {
    const a = parseAnalysis('{"kind":"flat","name":"x"}');
    if ('error' in a) throw new Error(a.error);
    expect(a.kind).toBe('other');
    expect('error' in parseAnalysis('sorry, I cannot')).toBe(true);
  });
  it('keeps outline points inside the 0..100 grid', () => {
    const a = parseAnalysis('{"kind":"flat","flat":{"outline":[[0,0],[100,0],[150,50],[50,100]],"holes":[[50,50,10]]}}');
    if ('error' in a) throw new Error(a.error);
    expect(a.flat!.outline.length).toBe(3);
  });
});
