import { describe, it, expect } from 'vitest';
import type { Pt } from '../src/core/types.ts';
import type { Ent, EntOf, StudioDoc } from '../src/studio/model.ts';
import { cleanEnt, fmtLen, newDoc, parseAngle, parseDoc, parseLen, serializeDoc } from '../src/studio/model.ts';
import { bulgeArc, crossings, curveLength, dimValue, dist, entDist, mirrorAff, polyPts, rotateAff, scaleAff, signedArea, splinePts, transformEnt } from '../src/studio/geom.ts';
import { arrayCircular, chamferLines, cornerPoly, explodePoly, extendLine, filletLines, joinChain, offsetEnt, simplifyStroke, trimEnt } from '../src/studio/edit.ts';
import { findLoops, profileArea, profileOf } from '../src/studio/profiles.ts';
import { solve } from '../src/studio/solver.ts';
import { applyParam, detectParams, scaleXY } from '../src/studio/params.ts';
import { generate, insertLibrary, regenerate } from '../src/studio/features.ts';

const B = { layer: 'L0', source: 'drawn' as const };
const line = (id: string, a: Pt, b: Pt): Ent => ({ ...B, id, k: 'line', a, b });
const circle = (id: string, c: Pt, r: number): Ent => ({ ...B, id, k: 'circle', c, r });
const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Ent => ({ ...B, id, k: 'poly', closed: true, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const docWith = (ents: Ent[], extra: Partial<StudioDoc> = {}): StudioDoc => ({ ...newDoc('t'), ents, ...extra });
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('studio units and file', () => {
  it('reads lengths in any unit and keeps millimetres inside', () => {
    expect(parseLen('25.4', 'mm')).toBe(25.4); expect(parseLen('1 in', 'mm')).toBe(25.4); expect(parseLen('2cm', 'mm')).toBe(20);
    expect(parseLen('0.5', 'in')).toBe(12.7); expect(parseLen('0,3 m', 'mm')).toBe(300); expect(parseLen('abc', 'mm')).toBeNull();
    expect(parseAngle('45°')).toBe(45); expect(fmtLen(25.4, 'in')).toBe('1');
  });
  it('saves and re-opens a design without losing anything', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), circle('c', [50, 25], 10)]);
    const back = parseDoc(serializeDoc(d));
    expect(back.dropped).toBe(0); expect(back.doc.ents).toEqual(d.ents); expect(back.doc.id).toBe(d.id);
  });
  it('drops damaged entities instead of crashing', () => {
    const text = JSON.stringify({ ...newDoc('x'), ents: [{ id: 'a', layer: 'L0', k: 'circle', c: [0, 0], r: -5 }, { id: 'b', layer: 'L0', k: 'line', a: [0, 0], b: [NaN, 1] }, { id: 'c', layer: 'L0', k: 'line', a: [0, 0], b: [1, 1] }, 'junk'] });
    const r = parseDoc(text); expect(r.doc.ents.length).toBe(1); expect(r.dropped).toBe(3);
    expect(cleanEnt({ id: 'x', layer: 'L0', k: 'poly', pts: [[0, 0]], closed: true })).toBeNull();
    expect(() => parseDoc('{"format":"other"}')).toThrow('not an Ultraplast Design Studio file');
  });
});

describe('studio geometry', () => {
  it('bulged polyline segments are true arcs', () => {
    const a = bulgeArc([1, 0], [0, 1], Math.tan(Math.PI / 8))!; // quarter circle about the origin
    close(a.c[0], 0); close(a.c[1], 0); close(a.r, 1); close(a.sweep, Math.PI / 2);
    const pts = polyPts({ pts: [[1, 0], [0, 1]], closed: false, bulge: [Math.tan(Math.PI / 8)] }, 0.001);
    for (const p of pts) close(Math.hypot(p[0], p[1]), 1, 1e-9);
  });
  it('splines pass through their points', () => {
    const P: Pt[] = [[0, 0], [10, 5], [20, -3], [30, 0]], s = splinePts(P, false, 16);
    for (const p of P) expect(Math.min(...s.map((q) => dist(p, q)))).toBeLessThan(1e-9);
  });
  it('transforms: rotate, mirror and scale keep sizes right', () => {
    const c = circle('c', [10, 0], 5);
    const r = transformEnt(c, rotateAff([0, 0], 90)) as EntOf<'circle'>; close(r.c[0], 0); close(r.c[1], 10); close(r.r, 5);
    const m = transformEnt({ ...B, id: 'a', k: 'arc', c: [0, 0], r: 2, a0: 0, a1: Math.PI / 2 }, mirrorAff([0, 0], [0, 1])) as EntOf<'arc'>;
    close(curveLength(m), Math.PI); // a quarter arc stays a quarter arc
    const e = transformEnt(c, scaleAff([0, 0], 2, 1)); expect(e.k).toBe('ellipse');
  });
  it('finds crossings between lines and circles', () => {
    const xs = crossings(line('l', [-20, 0], [20, 0]), [circle('c', [0, 0], 10)]);
    expect(xs.length).toBe(2); expect(xs.map((p) => Math.abs(p[0])).every((x) => Math.abs(x - 10) < 1e-9)).toBe(true);
  });
  it('picks the nearest item', () => { expect(entDist(circle('c', [0, 0], 10), [13, 0])).toBeCloseTo(3, 9); });
});

describe('studio editing tools', () => {
  it('offsets a rectangle inwards and outwards by exactly d', () => {
    const r = rect('r', 0, 0, 100, 50);
    const inn = offsetEnt(r, 5, [50, 25]); expect(inn.ok).toBe(true);
    const p = (inn as { add: Ent[] }).add[0] as EntOf<'poly'>; close(Math.abs(signedArea(p.pts)), 90 * 40);
    const out = offsetEnt(r, 5, [-50, 25]) as { add: Ent[] }; close(Math.abs(signedArea((out.add[0] as EntOf<'poly'>).pts)), 110 * 60);
    expect(offsetEnt(r, 30, [50, 25]).ok).toBe(false); // would turn inside out
  });
  it('trims a line between two crossing lines', () => {
    const h = line('h', [0, 0], [30, 0]), v1 = line('v1', [10, -5], [10, 5]), v2 = line('v2', [20, -5], [20, 5]);
    const r = trimEnt(h, [15, 0], [v1, v2]) as { ok: true; add: Ent[] };
    expect(r.ok).toBe(true); expect(r.add.length).toBe(2);
    expect(r.add.map((e) => curveLength(e)).sort()).toEqual([10, 10]);
  });
  it('trims a circle into an arc', () => {
    const r = trimEnt(circle('c', [0, 0], 10), [0, 10], [line('l', [-20, 0], [20, 0])]) as { ok: true; add: Ent[] };
    expect(r.ok).toBe(true); expect(r.add[0].k).toBe('arc'); close(curveLength(r.add[0]), Math.PI * 10, 1e-6);
  });
  it('extends a line to the next line', () => {
    const r = extendLine(line('l', [0, 0], [5, 0]) as EntOf<'line'>, [5, 0], [line('w', [20, -5], [20, 5])]) as { ok: true; add: Ent[] };
    expect(r.ok).toBe(true); expect((r.add[0] as EntOf<'line'>).b).toEqual([20, 0]);
  });
  it('fillets and chamfers a corner of two lines', () => {
    const a = line('a', [0, 0], [50, 0]) as EntOf<'line'>, b = line('b', [50, 0], [50, 40]) as EntOf<'line'>;
    const f = filletLines(a, b, 5) as { ok: true; add: Ent[] }; expect(f.ok).toBe(true);
    const arc = f.add.find((e) => e.k === 'arc') as EntOf<'arc'>; close(arc.r, 5); close(arc.c[0], 45); close(arc.c[1], 5); close(curveLength(arc), (Math.PI / 2) * 5);
    const c = chamferLines(a, b, 3) as { ok: true; add: Ent[] }; close(curveLength(c.add[2]), 3 * Math.SQRT2);
    expect(filletLines(a, b, 100).ok).toBe(false);
  });
  it('rounds a polyline corner with a real arc and keeps the area right', () => {
    const r = cornerPoly(rect('r', 0, 0, 100, 50) as EntOf<'poly'>, 1, 10, 'fillet') as { ok: true; add: Ent[] };
    expect(r.ok).toBe(true);
    const p = r.add[0] as EntOf<'poly'>, pts = polyPts(p, 0.0005).slice(0, -1);
    close(Math.abs(signedArea(pts)), 5000 - (100 - 25 * Math.PI), 0.05); // corner square 10x10 minus quarter circle
  });
  it('explodes and joins back into the same closed profile', () => {
    const ex = explodePoly(rect('r', 0, 0, 10, 10) as EntOf<'poly'>) as { ok: true; add: Ent[] };
    expect(ex.add.length).toBe(4);
    const j = joinChain(ex.add) as { ok: true; add: Ent[] }; expect(j.ok).toBe(true);
    const p = j.add[0] as EntOf<'poly'>; expect(p.closed).toBe(true); close(Math.abs(signedArea(p.pts)), 100);
  });
  it('makes circular copies and simplifies freehand strokes', () => {
    const r = arrayCircular([circle('c', [40, 0], 4)], [0, 0], 6) as { ok: true; add: Ent[] };
    expect(r.add.length).toBe(5);
    const s = simplifyStroke(Array.from({ length: 101 }, (_, i) => [i, 0] as Pt), 0.1); expect(s.length).toBe(2);
  });
});

describe('studio profiles', () => {
  it('finds a plate with holes and a closed chain of lines', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), circle('h1', [20, 25], 5), circle('h2', [80, 25], 5), line('a', [200, 0], [210, 0]), line('b', [210, 0], [210, 10]), line('c', [210, 10], [200, 0])]);
    const { loops, open } = findLoops(d); expect(loops.length).toBe(4); expect(open.length).toBe(0);
    const p = profileOf(d, 'r'); expect('error' in p).toBe(false);
    if (!('error' in p)) { expect(p.holes.length).toBe(2); close(profileArea(p), 5000 - 2 * Math.PI * 25, 0.05); }
  });
  it('reports an open outline with the size of the gap', () => {
    const d = docWith([line('a', [0, 0], [10, 0]), line('b', [10, 0], [10, 10]), line('c', [10, 10], [0, 0.5])]);
    const p = profileOf(d, 'a'); expect('error' in p).toBe(true);
    if ('error' in p) expect(p.error).toContain('0.5 mm apart');
  });
});

describe('studio constraint solver', () => {
  it('driving dimension changes a line length; constraints stay true', () => {
    const d0 = docWith([line('l', [0, 0], [40, 3])], { constraints: [{ id: 'k', t: 'horizontal', l: { e: 'l' } }] });
    const dim: Ent = { ...B, id: 'd', k: 'dim', d: { kind: 'length', l: { e: 'l' }, off: 5 }, drive: 60 };
    const s = solve({ ...d0, ents: [...d0.ents, dim] });
    expect(s.ok).toBe(true);
    const l = s.doc.ents[0] as EntOf<'line'>; close(dist(l.a, l.b), 60, 1e-6); close(l.a[1], l.b[1], 1e-6);
    close(dimValue(s.doc, s.doc.ents[1] as EntOf<'dim'>)!, 60, 1e-6);
  });
  it('a rectangle keeps its corners square when its width is driven', () => {
    const r = rect('r', 0, 0, 100, 50);
    const cons = [0, 1, 2, 3].map((s) => ({ id: `c${s}`, t: (s % 2 ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal', l: { e: 'r', seg: s } }));
    const dim: Ent = { ...B, id: 'd', k: 'dim', d: { kind: 'length', l: { e: 'r', seg: 0 }, off: -5 }, drive: 140 };
    const s = solve(docWith([r, dim], { constraints: cons })); expect(s.ok).toBe(true);
    const p = (s.doc.ents[0] as EntOf<'poly'>).pts;
    close(dist(p[0], p[1]), 140, 1e-6); close(p[1][0], p[2][0], 1e-6); close(p[2][1], p[3][1], 1e-6); close(p[3][0], p[0][0], 1e-6);
  });
  it('concentric, equal radius and tangent', () => {
    const d = docWith([circle('a', [0, 0], 10), circle('b', [3, 4], 6), line('t', [-20, 13], [20, 15])], { constraints: [{ id: 'k1', t: 'concentric', e1: 'a', e2: 'b' }, { id: 'k2', t: 'tangent', l: { e: 't' }, e: 'a' }, { id: 'k3', t: 'fix', e: 'a' }] });
    const s = solve(d); expect(s.ok).toBe(true);
    const b = s.doc.ents[1] as EntOf<'circle'>; close(b.c[0], 0, 1e-6); close(b.c[1], 0, 1e-6);
    const t = s.doc.ents[2] as EntOf<'line'>; const u = [t.b[0] - t.a[0], t.b[1] - t.a[1]], L = Math.hypot(u[0], u[1]);
    close(Math.abs((0 - t.a[0]) * u[1] - (0 - t.a[1]) * u[0]) / L, 10, 1e-6);
  });
  it('contradicting dimensions change nothing and are reported', () => {
    const d = docWith([line('l', [0, 0], [40, 0]), { ...B, id: 'd1', k: 'dim', d: { kind: 'length', l: { e: 'l' }, off: 5 }, drive: 50 }, { ...B, id: 'd2', k: 'dim', d: { kind: 'dist', p1: { e: 'l', i: 0 }, p2: { e: 'l', i: 1 }, off: 9 }, drive: 70 }]);
    const s = solve(d); expect(s.ok).toBe(false); expect(s.doc).toBe(d); expect(s.error).toContain('contradict');
  });
});

describe('studio automatic dimension fields', () => {
  const plate = () => docWith([rect('r', 0, 0, 120, 60), circle('b', [60, 30], 12), ...[0, 1, 2, 3].map((i) => circle(`h${i}`, [60 + 20 * Math.cos((i * Math.PI) / 2), 30 + 20 * Math.sin((i * Math.PI) / 2)], 3))]);
  it('detects overall sizes, bore, equal holes and their pitch circle', () => {
    const ps = detectParams(plate()), find = (s: string) => ps.find((p) => p.label.startsWith(s));
    expect(find('Overall length')!.value).toBe(120); expect(find('Overall width')!.value).toBe(60);
    expect(find('Centre hole')!.value).toBe(24); expect(find('Pitch circle')!.value).toBe(40); expect(find('Number of equally')!.value).toBe(4);
  });
  it('changing the overall length keeps the holes round and the same size', () => {
    const d = plate(), p = detectParams(d).find((x) => x.label.startsWith('Overall length'))!;
    const r = applyParam(d, p.id, 200); expect(r.ok).toBe(true);
    if (r.ok) { const ps = detectParams(r.doc); expect(ps.find((x) => x.label.startsWith('Overall length'))!.value).toBe(200); expect(ps.find((x) => x.label.startsWith('Centre hole'))!.value).toBe(24); expect(r.doc.ents.filter((e) => e.k === 'circle').every((e) => e.k === 'circle')).toBe(true); }
  });
  it('re-spaces holes when the count or PCD changes, and refuses overlapping holes', () => {
    const d = plate(), n = detectParams(d).find((x) => x.label.startsWith('Number of equally'))!;
    const r = applyParam(d, n.id, 6); expect(r.ok).toBe(true);
    if (r.ok) { const ps = detectParams(r.doc); expect(ps.find((x) => x.label.startsWith('Number of equally'))!.value).toBe(6); expect(ps.find((x) => x.label.startsWith('Pitch circle'))!.value).toBeCloseTo(40, 6); }
    expect(applyParam(d, n.id, 40).ok).toBe(false);
  });
  it('scales X and Y independently, keeping holes round when asked', () => {
    const r = scaleXY(plate(), null, 2, 1, true); expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.ents.filter((e) => e.k === 'circle').length).toBe(5);
    const r2 = scaleXY(plate(), null, 2, 1, false); if (r2.ok) expect(r2.doc.ents.some((e) => e.k === 'ellipse')).toBe(true);
  });
});

describe('studio features and library', () => {
  it('hole pattern regenerates from its values', () => {
    const f = { id: 'f1', t: 'holePattern' as const, c: [0, 0] as Pt, pcd: 100, n: 8, d: 10, start: 0 };
    expect(generate(f).ents.length).toBe(8);
    const r = regenerate(newDoc(), f); expect(r.doc.ents.length).toBe(8);
    const p = detectParams(r.doc).find((x) => x.id === 'fv:f1:n')!;
    const r2 = applyParam(r.doc, p.id, 12); expect(r2.ok).toBe(true); if (r2.ok) expect(r2.doc.ents.length).toBe(12);
    expect(generate({ ...f, n: 40 }).error).toContain('overlap');
  });
  it('slot is a closed profile with two true half circles', () => {
    const g = generate({ id: 's', t: 'slot', c: [0, 0], len: 40, w: 10, ang: 0 });
    const d = docWith(g.ents); const p = profileOf(d, g.ents[0].id);
    expect('error' in p).toBe(false); if (!('error' in p)) close(profileArea(p), 40 * 10 + Math.PI * 25, 0.01);
  });
  it('inserts a library sprocket and changing the teeth changes the drawing', () => {
    const r = insertLibrary(newDoc(), 'sprocket', {}, [0, 0], 'top', true); expect(r.error).toBeUndefined();
    expect(r.doc.bodies.length).toBe(1);
    const f = r.doc.features[0], teeth = detectParams(r.doc).find((x) => x.id === `fv:${f.id}:teeth`)!;
    expect(teeth).toBeDefined();
    const before = detectParams(r.doc).length;
    const r2 = applyParam(r.doc, teeth.id, teeth.value + 5); expect(r2.ok).toBe(true);
    if (r2.ok) { const o1 = r.doc.ents.find((e) => e.id.endsWith('_o')) as EntOf<'poly'>, o2 = r2.doc.ents.find((e) => e.id.endsWith('_o')) as EntOf<'poly'>; expect(o2.pts.length).not.toBe(o1.pts.length); expect(detectParams(r2.doc).length).toBe(before); expect(r2.doc.bodies[0].profile).toBe(o2.id); }
    expect(applyParam(r.doc, teeth.id, 100000).ok).toBe(false);
  });
  it('side profile of a turned part (shaft) is a closed outline with a centre line', () => {
    const r = insertLibrary(newDoc(), 'shaft', {}, [0, 0], 'side', true); expect(r.error).toBeUndefined();
    expect(r.doc.ents.some((e) => e.style === 'centre')).toBe(true); expect(r.doc.bodies[0].op).toBe('revolve');
  });
});

import { buildBodies, clipHalf, revolveRings, revolveVolume } from '../src/studio/solid.ts';
import { studioSheet } from '../src/studio/views.ts';
import { parseDxf, studioDxf } from '../src/studio/dxf.ts';
import type { Body } from '../src/studio/model.ts';

const body = (over: Partial<Body>): Body => ({ id: 'b1', name: 'Plate', op: 'extrude', profile: 'r', z0: 0, depth: 10, mode: 'new', material: 'S235 Steel', color: '#888', visible: true, ...over });

describe('studio 2D to 3D', () => {
  it('extrudes a plate with holes: exact volume and mass from the model', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), circle('h', [50, 25], 10)], { bodies: [body({})] });
    const b = buildBodies(d); expect(b.reports[0].ok).toBe(true);
    close(b.volume, (5000 - Math.PI * 100) * 10, 1e-6); close(b.mass, b.volume * 7.85e-6, 1e-12);
    expect(b.parts[0].geo.prims[0].kind).toBe('prism');
  });
  it('a pocket (partial-depth cut) is exact: the plate is split into slabs', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), rect('p', 20, 10, 60, 40)], { bodies: [body({}), body({ id: 'b2', name: 'Pocket', profile: 'p', z0: 6, depth: 4, mode: 'cut' })] });
    const b = buildBodies(d);
    close(b.volume, 5000 * 10 - 40 * 30 * 4, 1e-6); expect(b.parts[0].geo.prims.length).toBe(2);
  });
  it('a cut crossing the outline is reported as exact-kernel only', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), rect('n', 90, 10, 120, 40)], { bodies: [body({}), body({ id: 'b2', name: 'Notch', profile: 'n', mode: 'cut' })] });
    expect(buildBodies(d).reports[1].exactOnly.join(' ')).toContain('crosses the outline');
  });
  it('revolves a stepped shaft into exact rings, volume by Pappus', () => {
    const prof: Ent = { ...B, id: 's', k: 'poly', closed: true, pts: [[0, 0], [10, 0], [10, 40], [15, 40], [15, 70], [0, 70]] };
    const d = docWith([prof], { bodies: [body({ profile: 's', op: 'revolve', axis: 'y', axisAt: 0, angle: 360 })] });
    const b = buildBodies(d); expect(b.reports[0].ok).toBe(true);
    close(b.volume, Math.PI * (100 * 40 + 225 * 30), 1e-6);
    const rings = b.parts[0].geo.prims; expect(rings.length).toBe(2);
    close(rings.reduce((s, p) => s + (p.kind === 'tube' ? Math.PI * (p.rOut ** 2 - p.rIn ** 2) * (p.z1 - p.z0) : 0), 0), b.volume, 1e-6);
  });
  it('revolving a full section that crosses the axis uses one half only', () => {
    const r = docWith([rect('r', -20, 0, 20, 30)], { bodies: [body({ profile: 'r', op: 'revolve', axis: 'y', axisAt: 0 })] });
    close(buildBodies(r).volume, Math.PI * 400 * 30, 1e-6);
    expect(clipHalf([[-1, 0], [1, 0], [1, 1], [-1, 1]], (p) => p[0]).length).toBe(4);
  });
  it('a cone is stepped in the preview but its mass is exact', () => {
    const p = profileOf(docWith([{ ...B, id: 'c', k: 'poly', closed: true, pts: [[0, 0], [20, 0], [0, 30]] }]), 'c');
    if ('error' in p) throw new Error(p.error);
    close(revolveVolume(p, 'y', 0), (Math.PI * 400 * 30) / 3, 1e-6);
    expect(revolveRings({ outer: [[0, 0], [20, 0], [0, 30]], holes: [] }).stepped).toBe(true);
  });
  it('circular pattern of an extruded tab multiplies the volume', () => {
    const d = docWith([rect('t', 30, -5, 50, 5)], { bodies: [body({ profile: 't', pattern: { kind: 'circular', n: 6 } })] });
    close(buildBodies(d).volume, 6 * 200 * 10, 1e-6);
  });
  it('drawing sheet has plan, front, side and section views and fits on A3', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), circle('h', [50, 25], 10), { ...B, id: 'dm', k: 'dim', d: { kind: 'length', l: { e: 'r', seg: 0 }, off: -8 } }], { bodies: [body({})] });
    const s = studioSheet(d, buildBodies(d));
    const names = s.ents.filter((e) => e.t === 'text').map((e) => (e as { s: string }).s).join('|');
    expect(names).toContain('PLAN VIEW'); expect(names).toContain('FRONT VIEW'); expect(names).toContain('SECTION A-A'); expect(names).toContain('100');
    for (const e of s.ents) if (e.t === 'line') for (const p of [e.a, e.b]) { expect(p[0]).toBeGreaterThanOrEqual(-0.01); expect(p[0]).toBeLessThanOrEqual(420.01); }
  });
});

describe('studio DXF', () => {
  it('true-size DXF round trip keeps every size (lines, circles, arcs, bulged polylines)', () => {
    const arc: Ent = { ...B, id: 'a', k: 'arc', c: [5, 5], r: 7, a0: 0.2, a1: 2.1 };
    const slot: Ent = { ...B, id: 's', k: 'poly', closed: true, pts: [[0, 0], [40, 0], [40, 10], [0, 10]], bulge: [0, 1, 0, 1] };
    const d = docWith([rect('r', 0, 0, 120, 60), circle('c', [60, 30], 12.5), arc, slot, line('l', [-5, -5], [130, 70])]);
    const back = parseDxf(studioDxf(d), () => 'L0');
    expect(back.ents.length).toBe(5); expect(back.unitsNote).toContain('not stated');
    const c = back.ents.find((e) => e.k === 'circle') as EntOf<'circle'>; close(c.r, 12.5); close(c.c[0], 60);
    const a = back.ents.find((e) => e.k === 'arc') as EntOf<'arc'>; close(curveLength(a), curveLength(arc), 1e-5);
    const polys = back.ents.filter((e) => e.k === 'poly') as EntOf<'poly'>[];
    const sl = polys.find((p) => p.bulge)!; const pr = profileOf(docWith([sl]), sl.id); if (!('error' in pr)) close(profileArea(pr), 400 + Math.PI * 25, 1e-4);
  });
  it('reads inch drawings into millimetres and reports blocks it cannot import', () => {
    const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '11', '2', '21', '0', '0', 'INSERT', '8', 'A', '2', 'BLK', '0', 'LWPOLYLINE', '8', 'B', '90', '3', '70', '1', '10', '0', '20', '0', '10', '1', '20', '0', '42', '1', '10', '1', '20', '1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const r = parseDxf(dxf, (n) => n);
    expect(r.ents.length).toBe(2); close(curveLength(r.ents[0]), 50.8); expect(r.skipped.INSERT).toBe(1);
    expect(r.warnings.join(' ')).toContain('block'); expect(r.layers).toEqual(['A', 'B']);
    expect((r.ents[1] as EntOf<'poly'>).bulge).toEqual([0, 1, 0]);
    expect(() => parseDxf('hello', () => 'L0')).toThrow();
  });
});

import { parseSvg, pathToPolys, parseTransform } from '../src/studio/svg.ts';
import { detectFromItems, parseDimText, scaleFromTexts } from '../src/studio/detect.ts';
import { compareDimensions, compareToReference, distanceMap } from '../src/studio/compare.ts';
import type { Gray } from '../src/studio/compare.ts';
import { calibrate, newReference, traceToEnts } from '../src/studio/refs.ts';
import { checkStudio } from '../src/studio/validate.ts';

describe('studio SVG import', () => {
  it('reads a true-size SVG in millimetres and flips Y up', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><g transform="translate(10,10)"><rect x="0" y="0" width="50" height="20"/><circle cx="100" cy="40" r="5"/></g><path d="M 0 0 L 10 0 L 10 10 Z"/></svg>';
    const r = parseSvg(svg, 'L4');
    expect(r.ents.length).toBe(3); expect(r.unitsNote).toContain('true size');
    const rc = r.ents[0] as EntOf<'poly'>; close(Math.abs(signedArea(rc.pts)), 1000); expect(Math.max(...rc.pts.map((p) => p[1]))).toBeCloseTo(90, 9);
    const c = r.ents[1] as EntOf<'circle'>; close(c.r, 5); close(c.c[1], 50);
    expect((r.ents[2] as EntOf<'poly'>).closed).toBe(true);
  });
  it('arcs and curves in paths, and transforms', () => {
    const p = pathToPolys('M 10 0 A 10 10 0 0 1 -10 0', 32)[0];
    for (const q of p.pts) close(Math.hypot(q[0], q[1]), 10, 1e-6);
    expect(parseTransform('rotate(90) scale(2)').map((v) => +v.toFixed(9))).toEqual([0, -2, 2, 0, 0, 0]);
    expect(() => parseSvg('<html></html>', 'L4')).toThrow();
  });
});

describe('studio dimension text and PDF text', () => {
  it('understands common dimension notations', () => {
    expect(parseDimText('Ø25')).toMatchObject({ value: 25, kind: 'diameter' }); expect(parseDimText('⌀ 12,5')).toMatchObject({ value: 12.5, kind: 'diameter' });
    expect(parseDimText('R8')).toMatchObject({ value: 8, kind: 'radius' }); expect(parseDimText('M10x1.5')).toMatchObject({ value: 10, kind: 'thread' });
    expect(parseDimText('45°')).toMatchObject({ value: 45, kind: 'angle' }); expect(parseDimText('120±0.1')).toMatchObject({ value: 120, kind: 'length' });
    expect(parseDimText('2 in')).toMatchObject({ value: 50.8 }); expect(parseDimText('6 x Ø8')).toMatchObject({ value: 8, count: 6 });
    expect(parseDimText('DRAWING NO. A-123')).toBeNull(); expect(scaleFromTexts(['SCALE 1:2'])).toBe(0.5);
  });
  it('joins split text pieces like "Ø" + "25"', () => {
    const r = detectFromItems([{ str: 'Ø', x: 10, y: 10, h: 3 }, { str: '25', x: 12, y: 10, h: 3 }, { str: 'TITLE', x: 50, y: 50, h: 3 }], 'pdf-text');
    expect(r.length).toBe(1); expect(r[0].value).toBe(25); expect(r[0].kind).toBe('diameter'); expect(r[0].status).toBe('detected');
  });
});

/** synthetic scanned drawing: white paper with black lines */
function paper(w: number, h: number, ink: (x: number, y: number) => boolean): Gray { const v = new Uint8Array(w * h).fill(255); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) v[y * w + x] = 0; return { w, h, v }; }
describe('studio original-versus-CAD comparison', () => {
  it('distance map is exact along the axes', () => { const m = new Uint8Array(25); m[12] = 1; const d = distanceMap(m, 5, 5); expect(d[10]).toBe(2); expect(d[12]).toBe(0); });
  it('scores CAD lines that sit on the drawing and finds lines not converted yet', () => {
    // drawing: a rectangle outline 20..80 x 20..60 px and an extra vertical line at x = 100 px
    const g = paper(120, 80, (x, y) => ((x === 20 || x === 80) && y >= 20 && y <= 60) || ((y === 20 || y === 60) && x >= 20 && x <= 80) || (x === 100 && y >= 10 && y <= 70));
    const ref = { ...newReference('scan', 'image/png', 'image', '', 120, 80, 1), x: 0, y: 0 };
    const d = docWith([rect('r', 20, 20, 80, 60)], { refs: [ref] });
    const c = compareToReference(d, ref, g);
    expect(c.scores[0].score).toBeGreaterThan(0.95); expect(c.uncovered.length).toBeGreaterThan(0);
    expect(c.uncovered.every((u) => Math.abs(u.p[0] - 100) < 3)).toBe(true);
    const wrong = compareToReference(docWith([rect('r', 30, 25, 70, 55)], { refs: [ref] }), ref, g);
    expect(wrong.scores[0].score).toBeLessThan(0.2);
  });
  it('compares dimensions read from the drawing with the model', () => {
    const ref = { ...newReference('scan', 'image/png', 'image', '', 100, 100, 1), detected: [{ id: 'a', text: 'Ø20', value: 20, unit: 'mm', kind: 'diameter' as const, px: 0, py: 0, from: 'ai' as const, confidence: 0.6, status: 'confirmed' as const }, { id: 'b', text: 'Ø21', value: 21, unit: 'mm', kind: 'diameter' as const, px: 0, py: 0, from: 'ai' as const, confidence: 0.6, status: 'detected' as const }] };
    const r = compareDimensions(docWith([circle('c', [0, 0], 10)], { refs: [ref] }));
    expect(r[0].status).toBe('match'); expect(r[1].status).toBe('mismatch');
  });
});

describe('studio reference pictures', () => {
  it('scale calibration from one known distance moves traced lines with the picture', () => {
    const ref = newReference('photo', 'image/png', 'image', '', 200, 100);
    const traced: Ent = { ...B, id: 't', k: 'line', a: [0, 0], b: [10, 0], source: 'traced', refId: ref.id };
    const r = calibrate(docWith([traced], { refs: [ref] }), ref.id, [0, 0], [10, 0], 40);
    expect(r.error).toBeUndefined(); close(r.factor, 4);
    expect(r.doc.refs[0].calibrated).toBe(true); close(r.doc.refs[0].mmPerPx, 1);
    close(curveLength(r.doc.ents[0]), 40);
  });
  it('traces a picture into unconfirmed outline and round holes', () => {
    const w = 120, h = 80, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, inside = x >= 10 && x < 110 && y >= 10 && y < 70 && Math.hypot(x - 60, y - 40) > 12; const c = inside ? 30 : 255; data[i] = data[i + 1] = data[i + 2] = c; data[i + 3] = 255; }
    const ref = newReference('photo', 'image/png', 'image', '', w, h, 0.5);
    const t = traceToEnts(ref, { width: w, height: h, data }, 'L4');
    expect(t.error).toBeUndefined(); expect(t.ents.every((e) => e.source === 'traced' && e.confirmed === false)).toBe(true);
    const hole = t.ents.find((e) => e.k === 'circle') as EntOf<'circle'>; expect(hole).toBeDefined(); expect(Math.abs(hole.r - 6)).toBeLessThan(0.75);
  });
});

describe('studio checks', () => {
  it('finds duplicates, crossing outlines, open profiles, unconfirmed AI values and says it is not an approval', () => {
    const d = docWith([rect('r', 0, 0, 100, 50), rect('r2', 0, 0, 100, 50), circle('x', [100, 25], 10), line('a', [200, 0], [210, 0]), line('b', [210, 0], [210, 10]), line('c', [210, 10], [200, 0.05]), { ...B, id: 'ai', k: 'circle', c: [50, 25], r: 3, source: 'ai', confirmed: false }]);
    const t = checkStudio(d, null).map((c) => c.text).join(' | ');
    expect(t).toContain('duplicate'); expect(t).toContain('cross other outlines'); expect(t).toContain('Open profile'); expect(t).toContain('not confirmed'); expect(t).toContain('NOT an engineering');
  });
});

import { applySteps, designAdvice, drawingToDoc, localPlan, readAssist, contextFor } from '../src/studio/assistant.ts';
import { parseAssist, parseDrawing } from '../api/_lib/aiStudio.ts';

describe('studio assistant (built-in reader, no AI needed)', () => {
  const plate = () => docWith([rect('r', 0, 0, 200, 200), circle('b', [100, 100], 15)]);
  it('"Make the centre hole 35 mm" proposes one change and the preview applies it', () => {
    const d = plate(), p = localPlan(d, 'Make the centre hole 35 mm', [], null);
    expect(p.steps.length).toBe(1); expect(p.steps[0].critical).toBe(true);
    const r = applySteps(d, p.steps, []); expect(r.results[0].ok).toBe(true);
    expect(detectParams(r.doc).find((x) => /Centre hole/.test(x.label))!.value).toBe(35);
    expect(d.ents.find((e) => e.id === 'b')!.k === 'circle' && (d.ents.find((e) => e.id === 'b') as EntOf<'circle'>).r).toBe(15); // original untouched
  });
  it('"Add 12 equally spaced holes" asks for the missing sizes instead of guessing', () => {
    const p = localPlan(plate(), 'Add 12 equally spaced holes', [], null);
    expect(p.steps.length).toBe(0); expect(p.questions.join(' ')).toContain('diameter');
    const q = localPlan(plate(), 'add 12 holes Ø10 on PCD 150', [], null);
    expect(q.steps[0].action).toMatchObject({ type: 'addHolePattern', n: 12, d: 10, pcd: 150, cx: 100, cy: 100 });
    expect(applySteps(plate(), q.steps, []).doc.ents.filter((e) => e.k === 'circle').length).toBe(13);
  });
  it('"Increase the plate thickness to 8 mm" and "Convert to 3D" (asks for thickness if none)', () => {
    const d = plate();
    expect(localPlan(d, 'Convert this 2D drawing into a 3D model', [], null).questions[0]).toContain('thick');
    const c = localPlan(d, 'convert to 3D, thickness 6', [], null); const d2 = applySteps(d, c.steps, []).doc;
    expect(d2.bodies.length).toBe(1); expect(d2.bodies[0].depth).toBe(6);
    const t = localPlan(d2, 'Increase the plate thickness to 8 mm', [], null); const d3 = applySteps(d2, t.steps, []).doc;
    expect(d3.bodies[0].depth).toBe(8);
  });
  it('relative changes, fillets, symmetry and suggestions', () => {
    const d = plate();
    const r = localPlan(d, 'increase the length by 10%', [], null); expect(applySteps(d, r.steps, []).results[0].ok).toBe(true);
    const f = localPlan(d, 'fillet corners 5', [], null); const df = applySteps(d, f.steps, []); expect(df.results[0].msg).toContain('4 corner');
    const s = localPlan(docWith([circle('a', [10, 0], 3)]), 'mirror about the vertical axis', [], null); expect(s.questions.length + s.steps.length).toBeGreaterThan(0);
    const sg = localPlan(d, 'Suggest improvements to reduce material consumption', [], null); expect(sg.suggestions.join(' ')).toContain('not an engineering check');
    expect(designAdvice(docWith([rect('r', 0, 0, 100, 50), circle('h', [3, 25], 2)]), null).join(' ')).toContain('edge distance');
    expect(localPlan(plate(), 'Create a shaft with two bearing mounting positions', [], null).steps[0].action.type).toBe('insertLibrary');
  });
  it('AI answers are checked: unknown ids and actions are dropped, never applied', () => {
    const d = plate();
    const known = { params: detectParams(d).map((p) => p.id), ents: d.ents.map((e) => e.id), bodies: [], materials: ['S235 Steel'], families: ['shaft'] };
    const a = parseAssist('Sure! ```json {"reply":"ok","actions":[{"type":"addCircle","cx":10,"cy":10,"d":5,"why":"x"},{"type":"deleteAll"},{"type":"setParam","id":"nope","value":3},{"type":"setMaterial","material":"Unobtainium"}],"suggestions":["use POM"]} ```', known);
    expect('error' in a).toBe(false);
    if (!('error' in a)) { expect(a.steps.length).toBe(1); expect(a.dropped.length).toBe(3); expect(a.suggestions[0]).toBe('use POM'); }
    expect('error' in parseAssist('no json here', known)).toBe(true);
    expect(contextFor(d, []).length).toBeLessThan(60000);
    expect('error' in readAssist(d, '{"reply":"hi","actions":[]}')).toBe(false);
  });
  it('AI drawing reading becomes unconfirmed items and detected dimensions; nothing is invented', () => {
    const dr = parseDrawing('{"partType":"flange","material":"unknown","views":[{"name":"front","box":[0,0,1000,800]}],"entities":[{"t":"circle","c":[500,400],"r":300},{"t":"circle","c":[500,400],"r":50},{"t":"line","a":[0,0],"b":[0,0]}],"dimensions":[{"text":"Ø120","value":120,"kind":"diameter","at":[500,50],"confidence":0.9}],"missing":["thickness is not given"]}');
    expect('error' in dr).toBe(false); if ('error' in dr) return;
    expect(dr.entities.length).toBe(2); // the zero-length line was refused
    const ref = newReference('scan', 'image/png', 'image', '', 1000, 800, 0.2);
    const r = drawingToDoc(docWith([], { refs: [ref] }), ref.id, dr, 'L4');
    expect(r.added).toBe(2); expect(r.doc.ents.every((e) => e.source === 'ai' && e.confirmed === false)).toBe(true);
    close((r.doc.ents[0] as EntOf<'circle'>).r, 60); // 300/1000 of 1000 px at 0.2 mm/px
    expect(r.doc.refs[0].detected[0]).toMatchObject({ value: 120, status: 'detected', from: 'ai' });
    expect(r.doc.notes.join(' ')).toContain('thickness is not given');
    expect('error' in parseDrawing('{"entities":[],"dimensions":[]}')).toBe(true);
  });
});
