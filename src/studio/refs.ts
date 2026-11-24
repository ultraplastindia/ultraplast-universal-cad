import type { Pt } from '../core/types.ts';
import type { Ent, Reference, StudioDoc } from './model.ts';
import { uid } from './model.ts';
import { applyAff, dist, scaleAff, transformEnt } from './geom.ts';
import { traceImage } from '../lib/trace.ts';
import type { Raster, TraceOptions } from '../lib/trace.ts';
import { toMm } from './compare.ts';

/* Reference pictures (the original upload, never edited): placement, scale calibration and tracing into editable lines. */

/** Sets the true scale from one known distance: p1 and p2 are two points on the picture (model mm as currently placed). p1 stays put. */
export function calibrate(d: StudioDoc, refId: string, p1: Pt, p2: Pt, realMm: number, alsoTraced = true): { doc: StudioDoc; error?: string; factor: number } {
  const ref = d.refs.find((r) => r.id === refId);
  if (!ref) return { doc: d, error: 'Reference not found.', factor: 1 };
  const cur = dist(p1, p2);
  if (cur < 1e-9) return { doc: d, error: 'Pick two different points.', factor: 1 };
  if (!(realMm > 0) || realMm > 1e6) return { doc: d, error: 'Enter the real distance in millimetres (above 0).', factor: 1 };
  const k = realMm / cur, m = scaleAff(p1, k, k);
  const q = applyAff(m, [ref.x, ref.y]);
  const refs = d.refs.map((r) => (r.id === refId ? { ...r, x: q[0], y: q[1], mmPerPx: r.mmPerPx * k, calibrated: true } : r));
  const ents = alsoTraced ? d.ents.map((e) => (e.source === 'traced' && e.refId === refId ? transformEnt(e, m) : e)) : d.ents;
  return { doc: { ...d, refs, ents }, factor: k };
}

/** New reference layer from a picture. Without a known size the scale is a guess (0.25 mm per pixel) and is marked as not calibrated. */
export function newReference(name: string, mime: string, kind: Reference['kind'], dataUrl: string, pxW: number, pxH: number, mmPerPx?: number): Reference {
  return { id: uid('r'), name: name.slice(0, 80), mime, kind, dataUrl, pxW, pxH, x: 0, y: 0, mmPerPx: mmPerPx ?? 0.25, rot: 0, calibrated: mmPerPx !== undefined, opacity: 0.55, visible: true, detected: [] };
}

/** Traces the main outline (and its holes) of the picture into editable, UNCONFIRMED polylines and circles placed on the reference. */
export function traceToEnts(ref: Reference, raster: Raster, layer: string, opt: Partial<TraceOptions> = {}): { ents: Ent[]; warnings: string[]; error?: string } {
  // the raster may be a smaller copy of the reference picture
  const sx = ref.pxW / raster.width;
  const t = traceImage(raster, opt);
  if ('error' in t) return { ents: [], warnings: [], error: t.error };
  const P = (p: Pt): Pt => toMm(ref, [p[0] * sx, p[1] * sx]);
  const base = { layer, source: 'traced' as const, confirmed: false, refId: ref.id };
  const ents: Ent[] = [{ ...base, id: uid('t'), k: 'poly', closed: true, pts: t.outer.map(P) }];
  for (const h of t.holes) ents.push({ ...base, id: uid('t'), k: 'poly', closed: true, pts: h.map(P) });
  for (const r of t.round) ents.push({ ...base, id: uid('t'), k: 'circle', c: P(r.c), r: r.r * sx * ref.mmPerPx });
  return { ents, warnings: [...t.warnings, ref.calibrated ? '' : 'The picture has no confirmed scale yet: use "Set scale" with one known distance (traced lines follow).'].filter(Boolean) };
}
