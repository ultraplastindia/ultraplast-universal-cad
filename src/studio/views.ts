import type { Pt } from '../core/types.ts';
import type { DrawView, ModelEnt, Sheet, SheetMeta } from '../cad2d/sheet.ts';
import { composeSheet } from '../cad2d/sheet.ts';
import type { EntOf, StudioDoc, Unit } from './model.ts';
import { fmtLen } from './model.ts';
import { dimGeometry, dimLabel, geometryEnts, polyPts, tess } from './geom.ts';
import type { Built, BuiltPart } from './solid.ts';
import { NO_PLACE, partBox } from './solid.ts';
import { COMPANY } from '../lib/design.ts';
import { today } from '../core/util.ts';

/* Engineering drawing sheet of a studio design: the sketch (plan view) with its dimensions, and, when there are 3D bodies,
 * a front view, a side view and a section, all made from the same geometry that the 3D model uses. */

const circleOrPoly = (pts: Pt[], layer: 'outline' | 'hidden' | 'centre'): ModelEnt => ({ t: 'poly', pts, closed: false, layer });

/** The sketch as drawing entities (true size, millimetres). */
export function planView(d: StudioDoc, unit: Unit): DrawView {
  const ents: ModelEnt[] = [];
  const vis = new Set(d.layers.filter((l) => l.visible).map((l) => l.id));
  for (const e of geometryEnts(d, true)) {
    const layer = e.style === 'centre' ? 'centre' : e.style === 'construction' ? 'hidden' : 'outline';
    if (e.k === 'line') ents.push({ t: 'line', a: e.a, b: e.b, layer });
    else if (e.k === 'circle') ents.push({ t: 'circle', c: e.c, r: e.r, layer });
    else if (e.k === 'poly') ents.push({ t: 'poly', pts: polyPts(e, 0.01).slice(0, e.closed ? -1 : undefined), closed: e.closed, layer });
    else for (const pl of tess(e, 0.01)) ents.push(circleOrPoly(pl, layer));
  }
  const fm = (mm: number) => fmtLen(mm, unit, 2);
  for (const e of d.ents) {
    if (!vis.has(e.layer)) continue;
    if (e.k === 'text') ents.push({ t: 'text', p: e.p, s: e.s, h: Math.max(2.5, e.h), layer: 'text' });
    if (e.k !== 'dim') continue;
    const g = dimGeometry(d, e as EntOf<'dim'>); if (!g) continue;
    const label = dimLabel(d, e as EntOf<'dim'>, fm), k = e.d.kind;
    if (k === 'dist' || k === 'length') ents.push({ t: 'dim', a: g.p, b: g.q, off: 'off' in e.d ? e.d.off : 5, text: label });
    else if (k === 'hdist') { const y = Math.max(g.p[1], g.q[1]); ents.push({ t: 'dim', a: [Math.min(g.p[0], g.q[0]), y], b: [Math.max(g.p[0], g.q[0]), y], off: 'off' in e.d ? e.d.off : 5, text: label }); }
    else if (k === 'vdist') { const x = Math.max(g.p[0], g.q[0]); ents.push({ t: 'dim', a: [x, Math.max(g.p[1], g.q[1])], b: [x, Math.min(g.p[1], g.q[1])], off: 'off' in e.d ? e.d.off : 5, text: label }); }
    else { ents.push({ t: 'line', a: g.a, b: g.b, layer: 'dim' }, { t: 'text', p: g.textAt, s: label, h: 3, layer: 'dim' }); }
  }
  return { name: 'PLAN VIEW (SKETCH)', ents };
}

type ViewDir = 'front' | 'side';
/** Outline of the built parts seen from the front (X across, Z up) or the side (Y across, Z up). */
function projectView(built: Built, dir: ViewDir): DrawView {
  const ents: ModelEnt[] = [];
  const H = dir === 'front' ? 0 : 1;
  for (const m of built.parts) {
    if (m.place === NO_PLACE) {
      for (const p of m.geo.prims) {
        if (p.kind !== 'prism') continue;
        const xs = p.outer.map((q) => q[H]), lo = Math.min(...xs), hi = Math.max(...xs);
        ents.push({ t: 'poly', closed: true, layer: 'outline', pts: [[lo, p.z0], [hi, p.z0], [hi, p.z1], [lo, p.z1]] });
        for (const h of p.holes) {
          const hx = 'poly' in h ? h.poly.map((q) => q[H]) : [h.c[H] - h.r, h.c[H] + h.r];
          for (const x of [Math.min(...hx), Math.max(...hx)]) ents.push({ t: 'line', a: [x, p.z0], b: [x, p.z1], layer: 'hidden' });
          if (!('poly' in h)) ents.push({ t: 'line', a: [h.c[H], p.z0 - 2], b: [h.c[H], p.z1 + 2], layer: 'centre' });
        }
      }
    } else ents.push(...ringView(m, dir));
  }
  return { name: dir === 'front' ? 'FRONT VIEW' : 'SIDE VIEW', ents };
}
/** a ring stack seen from a view direction: along the axis it is circles, across the axis it is the stepped outline */
function ringView(m: BuiltPart, dir: ViewDir): ModelEnt[] {
  const out: ModelEnt[] = [];
  const axisAlongY = m.place.rot[0] !== 0; // revolve about the sketch Y axis
  const endOn = (dir === 'front') === axisAlongY; // front view looks along Y
  const cx = dir === 'front' ? m.place.pos[0] : m.place.pos[1];
  const tubes = m.geo.prims.filter((p): p is Extract<typeof p, { kind: 'tube' }> => p.kind === 'tube');
  if (endOn) {
    const rs = [...new Set(tubes.flatMap((t) => [t.rOut, t.rIn]).filter((r) => r > 1e-6).map((r) => +r.toFixed(6)))];
    for (const r of rs) out.push({ t: 'circle', c: [cx, 0], r, layer: 'outline' });
    const R = Math.max(...tubes.map((t) => t.rOut));
    out.push({ t: 'line', a: [cx - R - 3, 0], b: [cx + R + 3, 0], layer: 'centre' }, { t: 'line', a: [cx, -R - 3], b: [cx, R + 3], layer: 'centre' });
  } else {
    const off = axisAlongY ? m.place.pos[1] : m.place.pos[0];
    for (const t of tubes) {
      out.push({ t: 'poly', closed: true, layer: 'outline', pts: [[off + t.z0, -t.rOut], [off + t.z1, -t.rOut], [off + t.z1, t.rOut], [off + t.z0, t.rOut]] });
      if (t.rIn > 1e-6) for (const s of [1, -1]) out.push({ t: 'line', a: [off + t.z0, s * t.rIn], b: [off + t.z1, s * t.rIn], layer: 'hidden' });
    }
    const z0 = Math.min(...tubes.map((t) => t.z0)), z1 = Math.max(...tubes.map((t) => t.z1));
    out.push({ t: 'line', a: [off + z0 - 3, 0], b: [off + z1 + 3, 0], layer: 'centre' });
  }
  return out;
}
/** Section A-A through the middle of the extruded bodies (material hatched). */
function sectionView(built: Built): DrawView | null {
  const prisms = built.parts.filter((m) => m.place === NO_PLACE).flatMap((m) => m.geo.prims).filter((p): p is Extract<typeof p, { kind: 'prism' }> => p.kind === 'prism');
  if (!prisms.length) return null;
  const ys = prisms.flatMap((p) => p.outer.map((q) => q[1])), yc = (Math.min(...ys) + Math.max(...ys)) / 2;
  const ents: ModelEnt[] = [];
  for (const p of prisms) {
    const xs: number[] = [];
    const scan = (pts: Pt[]) => { for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; if ((y0 > yc) !== (y1 > yc)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0)); } };
    scan(p.outer);
    for (const h of p.holes) { if ('poly' in h) scan(h.poly); else if (Math.abs(h.c[1] - yc) < h.r) { const w = Math.sqrt(h.r * h.r - (h.c[1] - yc) ** 2); xs.push(h.c[0] - w, h.c[0] + w); } }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-6) {
      ents.push({ t: 'hatch', x0: xs[k], y0: p.z0, x1: xs[k + 1], y1: p.z1 });
      ents.push({ t: 'poly', closed: true, layer: 'outline', pts: [[xs[k], p.z0], [xs[k + 1], p.z0], [xs[k + 1], p.z1], [xs[k], p.z1]] });
    }
  }
  return ents.length ? { name: 'SECTION A-A (through the middle, Y = ' + +yc.toFixed(2) + ')', ents } : null;
}

export function studioMeta(d: StudioDoc, built: Built | null): SheetMeta {
  const notes = [
    ...d.notes,
    built && built.mass > 0 ? `Mass ${+(built.mass).toFixed(3)} kg (from model volume ${+(built.volume / 1000).toFixed(2)} cm³, ${d.material})` : '',
    'Dimensions in mm unless noted. Nominal sizes only: no tolerances are applied.',
    d.ents.some((e) => (e.source === 'traced' || e.source === 'ai') && !e.confirmed) ? 'CONTAINS UNCONFIRMED VALUES READ FROM A PICTURE OR AI' : '',
    'PRELIMINARY DESIGN - NOT VALIDATED FOR MANUFACTURE',
  ].filter(Boolean);
  return { company: COMPANY, title: d.name, partId: d.id.slice(0, 18).toUpperCase(), drawingNo: `UP-ST-${d.id.slice(2, 10).toUpperCase()}`, revision: d.revision, date: today(), material: d.material, units: d.unit === 'mm' ? 'mm' : `mm (shown in ${d.unit})`, notes };
}

export function studioSheet(d: StudioDoc, built: Built | null): Sheet {
  const views: DrawView[] = [];
  const plan = planView(d, d.unit);
  if (plan.ents.length) views.push(plan);
  if (built && built.parts.length) {
    views.push(projectView(built, 'front'), projectView(built, 'side'));
    const s = sectionView(built); if (s) views.push(s);
  }
  if (!views.length) views.push({ name: 'EMPTY', ents: [{ t: 'text', p: [0, 0], s: 'Nothing drawn yet', h: 5, layer: 'text' }] });
  return composeSheet(views.filter((v) => v.ents.length), studioMeta(d, built));
}
export { partBox };
