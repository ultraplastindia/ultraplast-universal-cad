import type { Ent, StudioDoc } from './model.ts';
import { curveLength, dist, entBox, geometryEnts, segDist } from './geom.ts';
import { findLoops, loopsCross } from './profiles.ts';
import type { Built } from './solid.ts';
import { solve } from './solver.ts';
import { featureErrors } from './features.ts';
import { compareDimensions } from './compare.ts';
import { selfIntersects } from '../families/custom/shape.ts';

/* Design Studio checks. Geometry and data checks only: this is NOT an engineering, strength or manufacturing approval. */

export interface Check { level: 'error' | 'warning' | 'info' | 'ok'; text: string; ents?: string[] }

const same = (a: Ent, b: Ent): boolean => {
  if (a.k !== b.k) return false;
  const t = 1e-6;
  if (a.k === 'line' && b.k === 'line') return (dist(a.a, b.a) < t && dist(a.b, b.b) < t) || (dist(a.a, b.b) < t && dist(a.b, b.a) < t);
  if (a.k === 'circle' && b.k === 'circle') return dist(a.c, b.c) < t && Math.abs(a.r - b.r) < t;
  if (a.k === 'arc' && b.k === 'arc') return dist(a.c, b.c) < t && Math.abs(a.r - b.r) < t && Math.abs(a.a0 - b.a0) < t && Math.abs(a.a1 - b.a1) < t;
  if ((a.k === 'poly' && b.k === 'poly') || (a.k === 'spline' && b.k === 'spline')) return a.pts.length === b.pts.length && a.pts.every((p, i) => dist(p, b.pts[i]) < t);
  return false;
};
/** two lines on top of each other along part of their length */
function overlapLines(a: Ent, b: Ent): boolean {
  if (a.k !== 'line' || b.k !== 'line') return false;
  const L = Math.max(curveLength(a), curveLength(b)); if (L < 1e-9) return false;
  const c1 = Math.abs((b.a[0] - a.a[0]) * (a.b[1] - a.a[1]) - (b.a[1] - a.a[1]) * (a.b[0] - a.a[0])) / curveLength(a);
  const c2 = Math.abs((b.b[0] - a.a[0]) * (a.b[1] - a.a[1]) - (b.b[1] - a.a[1]) * (a.b[0] - a.a[0])) / curveLength(a);
  if (c1 > 1e-6 || c2 > 1e-6) return false;
  return segDist(b.a, a.a, a.b) < 1e-6 || segDist(b.b, a.a, a.b) < 1e-6 || segDist(a.a, b.a, b.b) < 1e-6;
}

export function checkStudio(d: StudioDoc, built: Built | null): Check[] {
  const out: Check[] = [];
  const geo = geometryEnts(d);
  if (!geo.length) out.push({ level: 'info', text: 'Nothing is drawn yet.' });
  // tiny / zero-size items
  const tiny = geo.filter((e) => (e.k === 'line' && curveLength(e) < 1e-4) || ((e.k === 'circle' || e.k === 'arc') && e.r < 1e-4));
  if (tiny.length) out.push({ level: 'warning', text: `${tiny.length} item(s) have (almost) no size. Delete them.`, ents: tiny.map((e) => e.id) });
  // duplicates and overlaps (limited for very large drawings)
  const lim = geo.slice(0, 1500), dup: string[] = [], ov: string[] = [];
  for (let i = 0; i < lim.length; i++) for (let j = i + 1; j < lim.length; j++) { if (same(lim[i], lim[j])) dup.push(lim[j].id); else if (overlapLines(lim[i], lim[j])) ov.push(lim[j].id); }
  if (dup.length) out.push({ level: 'warning', text: `${dup.length} duplicate item(s) lie exactly on top of others.`, ents: dup });
  if (ov.length) out.push({ level: 'warning', text: `${ov.length} line(s) overlap other lines along part of their length.`, ents: ov });
  if (geo.length > 1500) out.push({ level: 'info', text: 'Large drawing: duplicate and overlap checks covered the first 1500 items only.' });
  // profiles
  const { loops, open } = findLoops(d);
  for (const o of open) if (o.gap > 1e-6 && o.gap < Math.max(1, curveLength(d.ents.find((e) => e.id === o.ids[0])!) * 0.1)) out.push({ level: 'warning', text: `Open profile: the ends are ${+o.gap.toFixed(4)} mm apart (nearly closed). Close it before making a 3D body.`, ents: o.ids });
  const selfX = geo.filter((e) => e.k === 'poly' && e.closed && !e.bulge && e.pts.length > 3 && selfIntersects(e.pts));
  if (selfX.length) out.push({ level: 'error', text: `${selfX.length} closed outline(s) cross themselves. A 3D body cannot be made from them.`, ents: selfX.map((e) => e.id) });
  const cross: string[] = [];
  for (let i = 0; i < loops.length && i < 300; i++) for (let j = i + 1; j < loops.length && j < 300; j++) if (loopsCross(loops[i], loops[j])) cross.push(...loops[j].ids);
  if (cross.length) out.push({ level: 'warning', text: `${new Set(cross).size} outline(s) cross other outlines (for example a hole cutting the edge). Trim them or check the design.`, ents: [...new Set(cross)] });
  if (loops.length) out.push({ level: 'ok', text: `${loops.length} closed profile(s) found.` });
  // provenance
  const unconf = d.ents.filter((e) => (e.source === 'traced' || e.source === 'ai') && !e.confirmed);
  if (unconf.length) out.push({ level: 'warning', text: `${unconf.length} item(s) come from a picture or AI and are not confirmed yet. Check them against the original and tick "Confirmed".`, ents: unconf.map((e) => e.id) });
  for (const r of d.refs) if (!r.calibrated) out.push({ level: 'warning', text: `Reference "${r.name}" has no confirmed scale. Use "Set scale" with one known distance, otherwise sizes taken from it are guesses.` });
  const pending = d.refs.flatMap((r) => r.detected.filter((t) => t.status === 'detected'));
  if (pending.length) out.push({ level: 'info', text: `${pending.length} dimension(s) read from the drawing are waiting for confirmation.` });
  // dimensions read from the drawing versus the model
  const cmp = compareDimensions(d);
  const mis = cmp.filter((c) => c.status === 'mismatch');
  if (mis.length) out.push({ level: 'warning', text: `Drawing and model differ: ${mis.slice(0, 6).map((c) => `${c.text} on the drawing, ${+c.model!.toFixed(3)} in the model`).join('; ')}${mis.length > 6 ? ' ...' : ''}` });
  const nf = cmp.filter((c) => c.status === 'not found');
  if (nf.length) out.push({ level: 'info', text: `${nf.length} dimension(s) on the drawing have no matching size in the model yet: ${nf.slice(0, 8).map((c) => c.text).join(', ')}` });
  // dimensions
  const dims = d.ents.filter((e) => e.k === 'dim');
  if (geo.length && !dims.length) out.push({ level: 'info', text: 'No dimensions on the drawing. Sizes come only from the drawn coordinates; add dimensions to fix and show the important sizes.' });
  if (d.constraints.length || dims.some((e) => e.drive !== undefined)) { const s = solve(d); if (!s.ok) out.push({ level: 'error', text: s.error ?? 'The constraints cannot all be met.' }); else out.push({ level: 'ok', text: s.dof ? `Constraints met. ${s.dof} degree(s) of freedom are still free (the sketch is not fully fixed).` : 'Constraints met. The constrained items are fully fixed.' }); }
  for (const f of d.features) for (const e of featureErrors(f)) out.push({ level: 'error', text: e });
  // 3D
  if (built) {
    for (const r of built.reports) {
      if (!r.ok && r.error !== 'Hidden.') out.push({ level: 'error', text: `3D body "${r.name}": ${r.error}` });
      for (const a of r.approx) out.push({ level: 'info', text: `3D body "${r.name}": ${a}.` });
      for (const x of r.exactOnly) out.push({ level: 'warning', text: `3D body "${r.name}": ${x} is made only in the exact model (STEP / "Exact model" preview). The quick preview, STL and mass do not include it.` });
    }
    if (built.overlaps.length) out.push({ level: 'warning', text: `3D bodies overlap (${built.overlaps.slice(0, 4).join(', ')}): the mass counts the overlap twice. Use "add" with the exact model for one merged solid.` });
    if (built.bbox) { const s = [0, 1, 2].map((i) => built.bbox!.max[i] - built.bbox!.min[i]); if (Math.max(...s) > 20000) out.push({ level: 'warning', text: `The model is very large (${s.map((x) => x.toFixed(0)).join(' × ')} mm). Check the units.` }); if (Math.max(...s) < 0.5) out.push({ level: 'warning', text: 'The model is very small (under 0.5 mm). Check the units.' }); }
    const thin = d.bodies.filter((b) => b.op !== 'revolve' && b.depth > 0 && b.depth < 0.5);
    if (thin.length) out.push({ level: 'warning', text: `${thin.length} body/bodies thinner than 0.5 mm.` });
  }
  // size sanity
  const bb = geo.map(entBox).filter((b) => Number.isFinite(b.x0));
  if (bb.length) { const w = Math.max(...bb.map((b) => b.x1)) - Math.min(...bb.map((b) => b.x0)); if (w > 0 && w < 0.1) out.push({ level: 'warning', text: 'The drawing is smaller than 0.1 mm across. Check the units or the scale.' }); }
  out.push({ level: 'info', text: 'Nominal sizes only: no tolerances are applied. Geometry and data checks only, NOT an engineering, strength or manufacturing approval.' });
  return out;
}
