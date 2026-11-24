import type { Pt } from '../core/types.ts';
import type { Ent, EntOf, Layer, StudioDoc } from './model.ts';
import { uid } from './model.ts';
import { bulgeArc, dimGeometry, dimLabel, ellipsePt, geometryEnts, polarPt, sweepOf, TAU, tess } from './geom.ts';

/* DXF for the Design Studio.
 *  - Export: TRUE SIZE model space in millimetres (AutoCAD R12 ASCII), with real LINE, CIRCLE, ARC and POLYLINE (with arc bulges) entities
 *    on the studio's own layer names, so the file opens as editable geometry in any CAD program at 1:1.
 *  - Import: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, ELLIPSE, SPLINE, TEXT/MTEXT; drawing units from $INSUNITS are converted to mm.
 *    Blocks (INSERT), hatches and dimensions are counted and reported but not imported. */

const n = (v: number) => (Math.abs(v) < 1e-12 ? '0' : v.toFixed(6).replace(/\.?0+$/, ''));
const layerName = (l: Layer | undefined) => (l?.name ?? '0').replace(/[^A-Za-z0-9_\-$ ]/g, '_').slice(0, 31) || '0';
const esc = (s: string) => s.replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p').replace(/[^\x20-\x7E%]/g, '?');

export function studioDxf(d: StudioDoc): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c).padStart(3, ' '), String(v)); };
  const L = new Map(d.layers.map((l) => [l.id, layerName(l)]));
  g(999, 'Ultraplast Design Studio - true size model, units: millimetres');
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$MEASUREMENT'); g(70, 1); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center ____ _ ____ _'); g(72, 65); g(73, 4); g(40, '2.0'); g(49, '1.25'); g(49, '-0.25'); g(49, '0.25'); g(49, '-0.25');
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, 'Hidden __ __ __'); g(72, 65); g(73, 2); g(40, '6.0'); g(49, '3.0'); g(49, '-3.0');
  g(0, 'ENDTAB');
  const names = [...new Set(['0', ...d.layers.map(layerName), 'CENTRE', 'CONSTRUCTION', 'DIMENSIONS'])];
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, names.length);
  names.forEach((nm) => { g(0, 'LAYER'); g(2, nm); g(70, 0); g(62, nm === 'CENTRE' ? 1 : nm === 'CONSTRUCTION' ? 8 : nm === 'DIMENSIONS' ? 3 : 7); g(6, nm === 'CENTRE' ? 'CENTER' : nm === 'CONSTRUCTION' ? 'HIDDEN' : 'CONTINUOUS'); });
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const head = (type: string, e: Ent) => { g(0, type); g(8, e.style === 'centre' ? 'CENTRE' : e.style === 'construction' ? 'CONSTRUCTION' : L.get(e.layer) ?? '0'); };
  const poly = (e: Ent, pts: Pt[], closed: boolean, bulge?: number[]) => {
    head('POLYLINE', e); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    pts.forEach((p, i) => { g(0, 'VERTEX'); g(8, e.style === 'centre' ? 'CENTRE' : e.style === 'construction' ? 'CONSTRUCTION' : L.get(e.layer) ?? '0'); g(10, n(p[0])); g(20, n(p[1])); g(30, 0); if (bulge?.[i]) g(42, n(bulge[i])); });
    g(0, 'SEQEND');
  };
  const vis = new Set(d.layers.filter((l) => l.visible).map((l) => l.id));
  for (const e of geometryEnts(d, true)) {
    if (e.k === 'line') { head('LINE', e); g(10, n(e.a[0])); g(20, n(e.a[1])); g(30, 0); g(11, n(e.b[0])); g(21, n(e.b[1])); g(31, 0); }
    else if (e.k === 'circle') { head('CIRCLE', e); g(10, n(e.c[0])); g(20, n(e.c[1])); g(30, 0); g(40, n(e.r)); }
    else if (e.k === 'arc') { head('ARC', e); g(10, n(e.c[0])); g(20, n(e.c[1])); g(30, 0); g(40, n(e.r)); g(50, n((e.a0 * 180) / Math.PI)); g(51, n((e.a1 * 180) / Math.PI)); }
    else if (e.k === 'poly') poly(e, e.pts, e.closed, e.bulge);
    else if (e.k === 'ellipse') poly(e, tess(e, 0.005)[0].slice(0, -1), true);
    else if (e.k === 'spline') { const p = tess(e, 0.005)[0]; poly(e, e.closed ? p.slice(0, -1) : p, e.closed); }
  }
  for (const e of d.ents) {
    if (!vis.has(e.layer)) continue;
    if (e.k === 'text') { g(0, 'TEXT'); g(8, L.get(e.layer) ?? '0'); g(10, n(e.p[0])); g(20, n(e.p[1])); g(30, 0); g(40, n(e.h)); g(1, esc(e.s)); }
    if (e.k === 'dim') {
      const gm = dimGeometry(d, e as EntOf<'dim'>); if (!gm) continue;
      g(0, 'LINE'); g(8, 'DIMENSIONS'); g(10, n(gm.a[0])); g(20, n(gm.a[1])); g(30, 0); g(11, n(gm.b[0])); g(21, n(gm.b[1])); g(31, 0);
      g(0, 'TEXT'); g(8, 'DIMENSIONS'); g(10, n(gm.textAt[0])); g(20, n(gm.textAt[1])); g(30, 0); g(40, 2.5); g(1, esc(dimLabel(d, e as EntOf<'dim'>, (v) => String(+v.toFixed(3)))));
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

/* ---------- import ---------- */
export interface DxfImport { ents: Ent[]; layers: string[]; unitsNote: string; skipped: Record<string, number>; warnings: string[] }
const INSUNITS: Record<number, [number, string]> = { 0: [1, 'not stated (taken as mm)'], 1: [25.4, 'inches'], 2: [304.8, 'feet'], 4: [1, 'millimetres'], 5: [10, 'centimetres'], 6: [1000, 'metres'], 8: [0.0000254, 'micro-inches'], 9: [0.0254, 'mils'], 10: [914.4, 'yards'], 13: [0.001, 'microns'], 14: [100, 'decimetres'] };

/** Reads an ASCII DXF. `layerFor` maps a DXF layer name to a studio layer id. */
export function parseDxf(text: string, layerFor: (name: string) => string, maxEnts = 50000): DxfImport {
  if (text.length > 60_000_000) throw new Error('The DXF file is too large (limit about 60 MB).');
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('This is a binary DXF. Save it as ASCII DXF in your CAD program and try again.');
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) { const c = parseInt(lines[i].trim(), 10); if (Number.isNaN(c)) throw new Error(`The DXF file is damaged near line ${i + 1} (expected a group code).`); pairs.push([c, lines[i + 1].trim()]); }
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error('This does not look like a DXF file.');
  // header units
  let k = 1, unitsNote = INSUNITS[0][1];
  for (let i = 0; i < pairs.length; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS' && pairs[i + 1]?.[0] === 70) { const u = parseInt(pairs[i + 1][1], 10); const m = INSUNITS[u]; if (m) { k = m[0]; unitsNote = m[1]; } else unitsNote = `code ${u} (taken as mm)`; }
  // entities section (and nothing from BLOCKS)
  let s = pairs.findIndex(([c, v], i) => c === 0 && v === 'SECTION' && pairs[i + 1]?.[0] === 2 && pairs[i + 1][1] === 'ENTITIES');
  if (s < 0) throw new Error('The DXF has no ENTITIES section.');
  s += 2;
  const out: Ent[] = [], skipped: Record<string, number> = {}, warnings: string[] = [], layers = new Set<string>();
  const P = (x: number, y: number): Pt => [x * k, y * k];
  let i = s;
  const base = (lay: string) => { layers.add(lay); return { id: uid('i'), layer: layerFor(lay), source: 'imported' as const, confirmed: true }; };
  while (i < pairs.length) {
    const [c, type] = pairs[i];
    if (c !== 0) { i++; continue; }
    if (type === 'ENDSEC' || type === 'EOF') break;
    // collect this entity's group codes
    let j = i + 1; const g: [number, string][] = [];
    while (j < pairs.length && pairs[j][0] !== 0) { g.push(pairs[j]); j++; }
    const num = (code: number, d = 0) => { const v = g.find((x) => x[0] === code); const f = v ? Number(v[1]) : d; return Number.isFinite(f) ? f : d; };
    const all = (code: number) => g.filter((x) => x[0] === code).map((x) => Number(x[1]));
    const lay = g.find((x) => x[0] === 8)?.[1] ?? '0';
    if (out.length >= maxEnts) { warnings.push(`Only the first ${maxEnts} items were imported.`); break; }
    if (type === 'LINE') out.push({ ...base(lay), k: 'line', a: P(num(10), num(20)), b: P(num(11), num(21)) });
    else if (type === 'CIRCLE') { const r = num(40) * k; if (r > 0) out.push({ ...base(lay), k: 'circle', c: P(num(10), num(20)), r }); }
    else if (type === 'ARC') { const r = num(40) * k; if (r > 0) out.push({ ...base(lay), k: 'arc', c: P(num(10), num(20)), r, a0: (num(50) * Math.PI) / 180, a1: (num(51) * Math.PI) / 180 }); }
    else if (type === 'LWPOLYLINE') {
      const xs: number[] = [], ys: number[] = [], bs: number[] = [];
      for (const [cc, v] of g) { if (cc === 10) { xs.push(Number(v)); bs.push(0); } else if (cc === 20) ys.push(Number(v)); else if (cc === 42 && bs.length) bs[bs.length - 1] = Number(v); }
      const pts = xs.map((x, q) => P(x, ys[q] ?? 0)); const closed = (num(70) & 1) === 1;
      if (pts.length >= 2) out.push({ ...base(lay), k: 'poly', pts, closed, ...(bs.some((b) => b) ? { bulge: bs } : {}) });
    } else if (type === 'POLYLINE') {
      const closed = (num(70) & 1) === 1, flags = num(70); const pts: Pt[] = [], bs: number[] = [];
      let q = j;
      while (q < pairs.length && !(pairs[q][0] === 0 && pairs[q][1] === 'SEQEND')) {
        if (pairs[q][0] === 0 && pairs[q][1] === 'VERTEX') { let r = q + 1; let x = 0, y = 0, b = 0; while (r < pairs.length && pairs[r][0] !== 0) { const [cc, v] = pairs[r]; if (cc === 10) x = Number(v); else if (cc === 20) y = Number(v); else if (cc === 42) b = Number(v); r++; } pts.push(P(x, y)); bs.push(b); q = r; } else q++;
      }
      j = q + 1;
      if (flags & (16 | 64)) { skipped['POLYLINE (3D mesh)'] = (skipped['POLYLINE (3D mesh)'] ?? 0) + 1; }
      else if (pts.length >= 2) out.push({ ...base(lay), k: 'poly', pts, closed, ...(bs.some((b) => b) ? { bulge: bs } : {}) });
    } else if (type === 'ELLIPSE') {
      const c = P(num(10), num(20)), mx = num(11) * k, my = num(21) * k, ratio = num(40, 1), t0 = num(41, 0), t1 = num(42, TAU);
      const rx = Math.hypot(mx, my), rot = Math.atan2(my, mx);
      if (rx > 0) {
        if (Math.abs(sweepOf(t0, t1) - TAU) < 1e-6) out.push({ ...base(lay), k: 'ellipse', c, rx, ry: rx * ratio, rot });
        else { const sw = sweepOf(t0, t1), N = Math.max(8, Math.ceil(sw / 0.05)); out.push({ ...base(lay), k: 'poly', closed: false, pts: Array.from({ length: N + 1 }, (_, q) => ellipsePt({ c, rx, ry: rx * ratio, rot }, t0 + (sw * q) / N)) }); }
      }
    } else if (type === 'SPLINE') {
      const fx = all(11), fy = all(21), cx = all(10), cy = all(20);
      const use = fx.length >= 2 ? fx.map((x, q) => P(x, fy[q] ?? 0)) : cx.map((x, q) => P(x, cy[q] ?? 0));
      if (use.length >= 2) { out.push({ ...base(lay), k: 'spline', pts: use, closed: (num(70) & 1) === 1 }); if (fx.length < 2) warnings.push('Some splines had only control points: they are drawn through those points and may differ slightly from the original curve.'); }
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const s0 = g.filter((x) => x[0] === 1 || x[0] === 3).map((x) => x[1]).join('').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°').replace(/%%p/gi, '±');
      if (s0.trim()) out.push({ ...base(lay), k: 'text', p: P(num(10), num(20)), s: s0.slice(0, 500), h: Math.max(0.5, num(40, 2.5) * k) });
    } else if (type === 'POINT' || type === 'VIEWPORT') { /* nothing to draw */ }
    else skipped[type] = (skipped[type] ?? 0) + 1;
    i = j;
  }
  if (skipped.INSERT) warnings.push(`${skipped.INSERT} block reference(s) (INSERT) were not imported. Explode the blocks in your CAD program first.`);
  if (skipped.DIMENSION) warnings.push(`${skipped.DIMENSION} dimension(s) were not imported; add them again with the dimension tool.`);
  if (unitsNote.startsWith('not stated')) warnings.push('The file does not say which unit it uses; it was read as millimetres. Check one known size.');
  return { ents: out, layers: [...layers], unitsNote, skipped, warnings };
}
export { bulgeArc, polarPt };
