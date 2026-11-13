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

import { confidenceOf } from '../src/lib/trace.ts';
import { asRole, canAi, canWrite } from '../api/_lib/roles.ts';
import { buildDesign, rangeErrors } from '../src/lib/design.ts';
import { validateDesign, geoStats } from '../src/lib/validation.ts';

function pic(w: number, h: number, fg: (x: number, y: number) => boolean, fgv = 30, bgv = 235) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fg(x, y) ? fgv : bgv, i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { width: w, height: h, data };
}
describe('reading confidence', () => {
  it('clean dark part on light background is high confidence', async () => {
    const { backgroundDistance, largestComponent } = await import('../src/lib/trace.ts');
    const img = pic(300, 300, (x, y) => x > 80 && x < 220 && y > 90 && y < 200);
    const { dist } = backgroundDistance(img); const m = new Uint8Array(300 * 300); for (let i = 0; i < m.length; i++) m[i] = dist[i] > 60 ? 1 : 0;
    const c = confidenceOf(img, largestComponent(m, 300, 300), 60);
    expect(c.level).toBe('high');
  });
  it('part cut off by the picture edge and low contrast lowers the score', async () => {
    const { backgroundDistance, largestComponent } = await import('../src/lib/trace.ts');
    const img = pic(300, 300, (x, y) => x < 150 && y > 50 && y < 250, 150, 200);
    const { dist } = backgroundDistance(img); const m = new Uint8Array(300 * 300); for (let i = 0; i < m.length; i++) m[i] = dist[i] > 20 ? 1 : 0;
    const c = confidenceOf(img, largestComponent(m, 300, 300), 20);
    expect(c.level).not.toBe('high'); expect(c.reasons.join(' ')).toMatch(/edge|contrast/);
  });
  it('an empty reading is low confidence', () => { expect(confidenceOf(pic(50, 50, () => false), new Uint8Array(2500), 60).level).toBe('low'); });
});

describe('roles', () => {
  it('admin flag wins; unknown role falls back to engineer; no one can be made admin by the role text alone', () => {
    expect(asRole('viewer', true)).toBe('admin'); expect(asRole('nonsense', false)).toBe('engineer'); expect(asRole('admin', false)).toBe('engineer'); expect(asRole('viewer', false)).toBe('viewer');
  });
  it('viewer cannot write or use AI; employee can write but not use AI; engineer can do both', () => {
    expect([canWrite('viewer'), canAi('viewer')]).toEqual([false, false]);
    expect([canWrite('employee'), canAi('employee')]).toEqual([true, false]);
    expect([canWrite('engineer'), canAi('engineer')]).toEqual([true, true]);
    expect([canWrite('admin'), canAi('admin')]).toEqual([true, true]);
  });
});

describe('validation engine', () => {
  const block = getFamily('custom_block')!;
  it('a normal design passes geometry checks and always says it is not an approval', () => {
    const v = validateDesign(buildDesign(block, { ...block.defaults, length: 100, width: 50, height: 10, cols: 0, rows: 0 }, 'A'));
    expect(v.status).not.toBe('fail'); expect(v.checks.some((c) => /NOT an engineering/.test(c.text))).toBe(true);
  });
  it('a value outside its limits fails with a readable message and blocks export', () => {
    const p = { ...block.defaults, length: 1e9 };
    expect(rangeErrors(block, p).join(' ')).toMatch(/above the maximum/);
    const v = validateDesign(buildDesign(block, p, 'A'));
    expect(v.status).toBe('fail'); expect(v.summary).toMatch(/cannot export/);
  });
  it('a missing number is refused, not turned into zero', () => { expect(rangeErrors(block, { ...block.defaults, length: NaN }).join(' ')).toMatch(/enter a number/); });
  it('3D size equals the typed size', () => {
    const d = buildDesign(block, { ...block.defaults, length: 120, width: 45, height: 8, cols: 0, rows: 0 }, 'A');
    const s = geoStats(d.geo!); expect(s.size.map((x) => +x.toFixed(3)).sort((a, b) => a - b)).toEqual([8, 45, 120]); expect(s.thinnest).toBeCloseTo(8, 6);
  });
  it('a thin feature warns', () => {
    const d = buildDesign(block, { ...block.defaults, length: 100, width: 50, height: 0.3, cols: 0, rows: 0 }, 'A');
    if (d.calc.ok) expect(validateDesign(d).checks.some((c) => /0\.5 mm/.test(c.text))).toBe(true);
  });
});

import { imageMatches } from '../api/_lib/files.ts';
describe('uploaded picture check', () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
  it('accepts real signatures and refuses mismatches', () => {
    expect(imageMatches('image/png', b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(true);
    expect(imageMatches('image/jpeg', b64([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(true);
    expect(imageMatches('image/webp', b64([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP')]))).toBe(true);
    expect(imageMatches('image/png', b64([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);          // a JPEG sent as PNG
    expect(imageMatches('image/jpeg', Buffer.from('<html><script>').toString('base64'))).toBe(false); // a web page renamed to .jpg
    expect(imageMatches('application/pdf', b64([0x25, 0x50, 0x44, 0x46, 0, 0]))).toBe(false);
  });
});
