import { describe, it, expect } from 'vitest';
import { getFamily } from '../src/families/index.ts';
import { buildShape, parsePoints, selfIntersects } from '../src/families/custom/shape.ts';
import { calcBlock, calcOutline, calcRound, outlineParams } from '../src/families/custom/custom.ts';
import { autoThreshold, backgroundDistance, boundaryLoops, traceImage, toMillimetres } from '../src/lib/trace.ts';
import type { Raster } from '../src/lib/trace.ts';

/** Draws simple test pictures: dark shapes on a white background (or transparent). */
function picture(w: number, h: number, paint: (x: number, y: number) => boolean, transparent = false): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, fg = paint(x, y);
    if (fg) { data[i] = 30; data[i + 1] = 40; data[i + 2] = 50; data[i + 3] = 255; } else { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = transparent ? 0 : 255; }
  }
  return { width: w, height: h, data };
}

describe('typed outline values', () => {
  it('reads points and removes a repeated closing point', () => {
    expect(parsePoints('0,0; 10,0\n10,10; 0,0').pts.length).toBe(3);
    expect(parsePoints('0,0; abc').error).toBeDefined();
  });
  it('L bracket area, orientation and corner move', () => {
    const r = buildShape('100,100; 100,160; 120,160; 120,120; 180,120; 180,100', '', '');
    expect(r.errors.join('|')).toBe('');
    expect(r.shape!.area).toBeCloseTo(80 * 20 + 20 * 40, 6);
    expect(Math.min(...r.shape!.outline.map((p) => p[0]))).toBe(0);
    expect(r.shape!.L).toBe(80); expect(r.shape!.W).toBe(60);
  });
  it('rejects a crossing outline, a hole outside the shape and an overlapping cut-out', () => {
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
    expect(buildShape('0,0; 10,10; 10,0; 0,10', '', '').errors.length).toBeGreaterThan(0);
    expect(buildShape('0,0; 100,0; 100,50; 0,50', '', '200,20,5').errors.length).toBeGreaterThan(0);
    expect(buildShape('0,0; 100,0; 100,50; 0,50', '', '2,2,10').errors.length).toBeGreaterThan(0);
    expect(buildShape('0,0; 100,0; 100,50; 0,50', '20,10; 60,10; 60,40; 20,40', '40,25,6').errors.length).toBeGreaterThan(0);
    expect(buildShape('0,0; 100,0; 100,50; 0,50', '20,10; 60,10; 60,40; 20,40', '80,25,6').errors.join('|')).toBe('');
  });
});

describe('custom component families', () => {
  it('are registered and have variants', () => {
    for (const id of ['custom_block', 'custom_round', 'custom_outline']) { const f = getFamily(id); expect(f).toBeDefined(); expect(f!.variants.length).toBeGreaterThan(5); }
  });
  it('block: mass and bad input', () => {
    const c = calcBlock({ length: 100, width: 50, height: 10, cols: 0, rows: 0, holeDia: 0, edgeX: 0, edgeY: 0, material: 'S235 Steel', density: 7.85 });
    expect(c.ok).toBe(true);
    expect(c.derived.massKg).toBeCloseTo(100 * 50 * 10 * 7.85e-6, 9);
    expect(calcBlock({ length: 100, width: 50, height: 10, cols: 2, rows: 2, holeDia: 20, edgeX: 5, edgeY: 5, material: 'S235 Steel', density: 7.85 }).ok).toBe(false);
    expect(calcBlock({ length: 100, width: 50, height: 10, cols: 0, rows: 0, holeDia: 0, edgeX: 0, edgeY: 0, material: 'Custom material', density: 0 }).ok).toBe(false);
  });
  it('block accepts a typed density for another material', () => {
    const c = calcBlock({ length: 10, width: 10, height: 10, cols: 0, rows: 0, holeDia: 0, edgeX: 0, edgeY: 0, material: 'Custom material', density: 2 });
    expect(c.derived.massKg).toBeCloseTo(1000 * 2e-6, 9);
  });
  it('round: sections, bore and mass', () => {
    const c = calcRound({ bore: 10, od1: 30, len1: 50, od2: 20, len2: 25, od3: 0, len3: 0, material: 'C45 Steel', density: 7.85 });
    expect(c.ok).toBe(true);
    expect(c.derived.total).toBe(75);
    expect(c.derived.massKg).toBeCloseTo(((Math.PI / 4) * (900 - 100) * 50 + (Math.PI / 4) * (400 - 100) * 25) * 7.85e-6, 9);
    expect(calcRound({ bore: 29.8, od1: 30, len1: 50, od2: 0, len2: 0, od3: 0, len3: 0, material: 'C45 Steel', density: 7.85 }).ok).toBe(false);
    expect(calcRound({ bore: 0, od1: 30, len1: 50, od2: 0, len2: 10, od3: 0, len3: 0, material: 'C45 Steel', density: 7.85 }).ok).toBe(false);
  });
  it('outline: mass equals area x thickness x density and bad shapes fail with a message', () => {
    const p = getFamily('custom_outline')!.defaults;
    const c = calcOutline(p);
    expect(c.ok).toBe(true);
    expect(c.derived.massKg).toBeCloseTo((2400 - 2 * Math.PI * 9) * 5 * 7.85e-6, 9);
    const bad = calcOutline({ ...p, outline: '0,0; 10,10; 10,0; 0,10' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});

describe('picture to outline', () => {
  it('finds a rectangle with a round hole and scales it to real size', () => {
    const img = picture(240, 160, (x, y) => x >= 40 && x < 200 && y >= 30 && y < 110 && Math.hypot(x - 120, y - 70) > 12);
    const t = traceImage(img);
    if ('error' in t) throw new Error(t.error);
    expect(t.round.length).toBe(1);
    expect(t.holes.length).toBe(0);
    expect(Math.abs(t.round[0].r - 12)).toBeLessThan(1.5);
    const mm = toMillimetres(t, 'width', 320);   // 160 px wide -> 320 mm, so 2 mm per pixel
    expect(Math.abs(mm.lengthMm - 320)).toBeLessThan(0.01);
    expect(Math.abs(mm.widthMm - 160)).toBeLessThan(6);
    expect(Math.abs(mm.holes[0].r - 24)).toBeLessThan(3);
    // the traced shape is accepted by the custom outline component
    const calc = calcOutline(outlineParams(mm, 6, 'S235 Steel'));
    expect(calc.errors.join('|')).toBe('');
    expect(Math.abs(calc.derived.area - (320 * 160 - Math.PI * 24 * 24)) / (320 * 160)).toBeLessThan(0.03);
  });
  it('works for a PNG with a transparent background and for a circle', () => {
    const t = traceImage(picture(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 70, true));
    if ('error' in t) throw new Error(t.error);
    const mm = toMillimetres(t, 'longest', 140);
    expect(Math.abs(mm.lengthMm - 140)).toBeLessThan(0.01);
    expect(Math.abs(mm.widthMm - 140)).toBeLessThan(4);
    const a = calcOutline(outlineParams(mm, 5, 'Nylon PA6'));
    expect(a.errors.join('|')).toBe('');
    expect(Math.abs(a.derived.area - Math.PI * 70 * 70) / (Math.PI * 70 * 70)).toBeLessThan(0.03);
  });
  it('keeps an L shape and a non-round hole as a cut-out', () => {
    const t = traceImage(picture(220, 180, (x, y) => ((x >= 20 && x < 200 && y >= 120 && y < 160) || (x >= 20 && x < 70 && y >= 20 && y < 160)) && !(x >= 100 && x < 160 && y >= 130 && y < 140)));
    if ('error' in t) throw new Error(t.error);
    expect(t.holes.length).toBe(1);
    expect(t.outer.length).toBeLessThan(40);
  });
  it('reports a plain picture with no shape instead of crashing', () => {
    const t = traceImage(picture(100, 100, () => false));
    expect('error' in t).toBe(true);
  });
  it('does not hang on a diagonal checkerboard and the edge walker keeps diagonal pixels apart', () => {
    const m = new Uint8Array(16); m[0] = 1; m[5] = 1; // two pixels touching only at a corner
    expect(boundaryLoops(m, 4, 4).length).toBe(2);
    const t = traceImage(picture(120, 120, (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0));
    expect(t).toBeDefined();
  });
  it('threshold helper returns a usable value', () => {
    const { dist } = backgroundDistance(picture(50, 50, (x) => x > 25));
    const thr = autoThreshold(dist);
    expect(thr).toBeGreaterThan(14); expect(thr).toBeLessThan(201);
  });
});
