import type { Pt } from '../core/types.ts';
import type { GeoPart } from '../core/prims.ts';
import type { Body, Ent, Feature, StudioDoc } from './model.ts';
import { uid } from './model.ts';
import { boxOf, boxOk, bulgeOf, dimRefs, polarPt, sub } from './geom.ts';
import { getFamily } from '../families/index.ts';
import { buildDesign } from '../lib/design.ts';

/* Parametric 2D features. The feature keeps the values (for example "6 holes Ø10 on PCD 80"); its entities are regenerated
 * whenever a value changes, so one number edits the whole pattern. Library features reuse the existing component families
 * (sprockets, plates, pulleys, ...) with all their calculations and limits. */

export interface FeatureField { key: string; label: string; unit: 'mm' | 'deg' | 'count' | 'text'; min: number; max: number }
export const FEATURE_FIELDS: Record<Exclude<Feature['t'], 'library'>, FeatureField[]> = {
  holePattern: [
    { key: 'n', label: 'Number of holes', unit: 'count', min: 1, max: 360 }, { key: 'd', label: 'Hole diameter', unit: 'mm', min: 0.1, max: 5000 },
    { key: 'pcd', label: 'Pitch circle diameter (PCD)', unit: 'mm', min: 0, max: 20000 }, { key: 'start', label: 'Start angle', unit: 'deg', min: -360, max: 360 },
    { key: 'cx', label: 'Centre X', unit: 'mm', min: -1e6, max: 1e6 }, { key: 'cy', label: 'Centre Y', unit: 'mm', min: -1e6, max: 1e6 },
  ],
  gridHoles: [
    { key: 'nx', label: 'Holes along X', unit: 'count', min: 1, max: 200 }, { key: 'ny', label: 'Holes along Y', unit: 'count', min: 1, max: 200 },
    { key: 'dx', label: 'Spacing X', unit: 'mm', min: 0, max: 1e5 }, { key: 'dy', label: 'Spacing Y', unit: 'mm', min: 0, max: 1e5 },
    { key: 'd', label: 'Hole diameter', unit: 'mm', min: 0.1, max: 5000 }, { key: 'x0', label: 'First hole X', unit: 'mm', min: -1e6, max: 1e6 }, { key: 'y0', label: 'First hole Y', unit: 'mm', min: -1e6, max: 1e6 },
  ],
  slot: [
    { key: 'len', label: 'Slot length (centre to centre)', unit: 'mm', min: 0, max: 1e5 }, { key: 'w', label: 'Slot width', unit: 'mm', min: 0.1, max: 1e5 },
    { key: 'ang', label: 'Angle', unit: 'deg', min: -360, max: 360 }, { key: 'cx', label: 'Centre X', unit: 'mm', min: -1e6, max: 1e6 }, { key: 'cy', label: 'Centre Y', unit: 'mm', min: -1e6, max: 1e6 },
  ],
  polygon: [
    { key: 'n', label: 'Number of sides', unit: 'count', min: 3, max: 200 }, { key: 'r', label: 'Corner radius (circumscribed)', unit: 'mm', min: 0.01, max: 1e5 },
    { key: 'ang', label: 'Rotation', unit: 'deg', min: -360, max: 360 }, { key: 'cx', label: 'Centre X', unit: 'mm', min: -1e6, max: 1e6 }, { key: 'cy', label: 'Centre Y', unit: 'mm', min: -1e6, max: 1e6 },
  ],
};

/** a feature's value by field key (centres are stored as points) */
export function featureValue(f: Feature, key: string): number | string | boolean | undefined {
  if (f.t === 'library') return f.params[key];
  if (key === 'cx') return 'c' in f ? f.c[0] : undefined;
  if (key === 'cy') return 'c' in f ? f.c[1] : undefined;
  return (f as unknown as Record<string, number>)[key];
}
/** returns a copy of the feature with one value changed, or a readable error */
export function setFeatureValue(f: Feature, key: string, v: number | string | boolean): Feature | { error: string } {
  if (f.t === 'library') {
    const fam = getFamily(f.familyId); const fld = fam?.fields.find((x) => x.key === key);
    if (!fam || !fld) return { error: 'Unknown value for this component.' };
    if (fld.kind === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${fld.label}: enter a number.` }; if (fld.min !== undefined && v < fld.min) return { error: `${fld.label}: minimum is ${fld.min}${fld.unit ? ' ' + fld.unit : ''}.` }; if (fld.max !== undefined && v > fld.max) return { error: `${fld.label}: maximum is ${fld.max}${fld.unit ? ' ' + fld.unit : ''}.` }; }
    return { ...f, params: { ...f.params, [key]: v } };
  }
  const fld = FEATURE_FIELDS[f.t].find((x) => x.key === key);
  if (!fld || typeof v !== 'number' || !Number.isFinite(v)) return { error: 'Enter a number.' };
  if (v < fld.min || v > fld.max) return { error: `${fld.label}: allowed ${fld.min} to ${fld.max}${fld.unit === 'mm' ? ' mm' : fld.unit === 'deg' ? '°' : ''}.` };
  if (fld.unit === 'count' && !Number.isInteger(v)) return { error: `${fld.label}: enter a whole number.` };
  if (key === 'cx' || key === 'cy') { const c = (f as { c: Pt }).c; return { ...f, c: key === 'cx' ? [v, c[1]] : [c[0], v] } as Feature; }
  return { ...f, [key]: v } as Feature;
}

/** Validates the feature values together (for example holes overlapping each other on the PCD). */
export function featureErrors(f: Feature): string[] {
  const e: string[] = [];
  if (f.t === 'holePattern') { if (f.n > 1 && f.pcd <= 0) e.push('More than one hole needs a pitch circle diameter above 0.'); else if (f.n > 1 && Math.PI * f.pcd / f.n <= f.d) e.push(`The ${f.n} holes of Ø${f.d} overlap on PCD ${f.pcd} (hole spacing ${+(Math.PI * f.pcd / f.n).toFixed(2)} mm).`); }
  if (f.t === 'gridHoles') { if (f.nx > 1 && f.dx <= f.d) e.push('Spacing X must be larger than the hole diameter.'); if (f.ny > 1 && f.dy <= f.d) e.push('Spacing Y must be larger than the hole diameter.'); }
  if (f.t === 'slot' && f.w <= 0) e.push('Slot width must be above 0.');
  return e;
}

const fb = (f: Feature, layer: string) => ({ layer, source: 'feature' as const, feature: f.id, confirmed: true });

/** The entities a feature makes. Library features also return the 3D part geometry of the family (for an automatic body). */
export function generate(f: Feature, layer = 'L0'): { ents: Ent[]; error?: string; geo?: GeoPart[]; z?: [number, number]; material?: string } {
  const errs = featureErrors(f); if (errs.length) return { ents: [], error: errs.join(' ') };
  const b = fb(f, layer);
  if (f.t === 'holePattern') return { ents: Array.from({ length: f.n }, (_, i) => ({ ...b, id: `${f.id}_h${i}`, k: 'circle' as const, c: f.n === 1 && f.pcd === 0 ? f.c : polarPt(f.c, f.pcd / 2, ((f.start + (360 * i) / f.n) * Math.PI) / 180), r: f.d / 2 })) };
  if (f.t === 'gridHoles') { const out: Ent[] = []; for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) out.push({ ...b, id: `${f.id}_h${j}_${i}`, k: 'circle', c: [f.x0 + i * f.dx, f.y0 + j * f.dy], r: f.d / 2 }); return { ents: out }; }
  if (f.t === 'slot') {
    const a = (f.ang * Math.PI) / 180, u: Pt = [Math.cos(a), Math.sin(a)], n: Pt = [-u[1], u[0]], h = f.len / 2, r = f.w / 2;
    if (f.len <= 1e-9) return { ents: [{ ...b, id: `${f.id}_s`, k: 'circle', c: f.c, r }] };
    const P = (s: number, t: number): Pt => [f.c[0] + u[0] * s + n[0] * t, f.c[1] + u[1] * s + n[1] * t];
    return { ents: [{ ...b, id: `${f.id}_s`, k: 'poly', closed: true, pts: [P(-h, -r), P(h, -r), P(h, r), P(-h, r)], bulge: [0, bulgeOf(Math.PI), 0, bulgeOf(Math.PI)] }] };
  }
  if (f.t === 'polygon') return { ents: [{ ...b, id: `${f.id}_p`, k: 'poly', closed: true, pts: Array.from({ length: f.n }, (_, i) => polarPt(f.c, f.r, ((f.ang + (360 * i) / f.n) * Math.PI) / 180)) }] };
  // library component
  const fam = getFamily(f.familyId);
  if (!fam) return { ents: [], error: `Component family "${f.familyId}" is not in the library.` };
  const d = buildDesign(fam, { ...fam.defaults, ...f.params }, 'A');
  if (!d.calc.ok || !d.geo) return { ents: [], error: `${fam.name}: ${d.calc.errors.join(' ')}` };
  const move = (p: Pt): Pt => [p[0] + f.at[0], p[1] + f.at[1]];
  const prims = d.geo.flatMap((g) => g.prims);
  const out: Ent[] = [];
  let z: [number, number] = [Infinity, -Infinity];
  for (const p of prims) if (p.kind !== 'sphere') { z = [Math.min(z[0], p.z0), Math.max(z[1], p.z1)]; }
  if (f.view === 'top') {
    // plan view: the largest outline seen along the part axis, with its holes
    let best: { area: number; make: () => void } = { area: -1, make: () => {} };
    for (const p of prims) {
      if (p.kind === 'prism') { const a = Math.abs(polyArea(p.outer)); if (a > best.area) best = { area: a, make: () => { out.push({ ...b, id: `${f.id}_o`, k: 'poly', closed: true, pts: p.outer.map(move) }); p.holes.forEach((h, i) => out.push('poly' in h ? { ...b, id: `${f.id}_i${i}`, k: 'poly', closed: true, pts: h.poly.map(move) } : { ...b, id: `${f.id}_i${i}`, k: 'circle', c: move(h.c), r: h.r })); } }; }
      else if (p.kind === 'tube') { const a = Math.PI * p.rOut * p.rOut; if (a > best.area) best = { area: a, make: () => { out.push({ ...b, id: `${f.id}_o`, k: 'circle', c: move([0, 0]), r: p.rOut }); if (p.rIn > 1e-9) out.push({ ...b, id: `${f.id}_i0`, k: 'circle', c: move([0, 0]), r: p.rIn }); } }; }
    }
    best.make();
  } else {
    // side profile of a turned part: steps of every tube along the axis (drawn along X), full section above and below the axis
    const tubes = prims.filter((p): p is Extract<typeof p, { kind: 'tube' }> => p.kind === 'tube').sort((a, c) => a.z0 - c.z0);
    if (!tubes.length) return { ents: [], error: `${fam.name} has no turned (round) sections to draw as a side profile. Use the top view.` };
    const xs = [...new Set(tubes.flatMap((t) => [t.z0, t.z1]))].sort((a, c) => a - c);
    const rAt = (x: number) => Math.max(0, ...tubes.filter((t) => t.z0 <= x + 1e-9 && t.z1 >= x - 1e-9).map((t) => t.rOut));
    const top: Pt[] = [];
    for (let i = 0; i + 1 < xs.length; i++) { const r = rAt((xs[i] + xs[i + 1]) / 2); top.push([xs[i], r], [xs[i + 1], r]); }
    const pts = [...top, ...top.slice().reverse().map(([x, y]) => [x, -y] as Pt)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-9);
    out.push({ ...b, id: `${f.id}_o`, k: 'poly', closed: true, pts: pts.map(move) });
    out.push({ ...b, id: `${f.id}_ax`, k: 'line', style: 'centre', a: move([xs[0] - 5, 0]), b: move([xs[xs.length - 1] + 5, 0]) });
  }
  return { ents: out, geo: d.geo, z, material: fam.materialOf({ ...fam.defaults, ...f.params }) };
}
function polyArea(pts: Pt[]): number { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/** Replaces the feature's old entities with freshly generated ones. Dimensions and constraints pointing at removed entities are dropped. */
export function regenerate(doc: StudioDoc, f: Feature): { doc: StudioDoc; error?: string } {
  const old = doc.ents.filter((e) => e.feature === f.id);
  const layer = old[0]?.layer ?? 'L0';
  const g = generate(f, layer);
  if (g.error) return { doc, error: g.error };
  const newIds = new Set(g.ents.map((e) => e.id));
  const gone = new Set(old.map((e) => e.id).filter((id) => !newIds.has(id)));
  const ents = [...doc.ents.filter((e) => e.feature !== f.id), ...g.ents].filter((e) => !(e.k === 'dim' && dimRefs(e.d).some((r) => gone.has(r))));
  const constraints = doc.constraints.filter((c) => !JSON.stringify(c).split('"').some((s) => gone.has(s)));
  const features = doc.features.some((x) => x.id === f.id) ? doc.features.map((x) => (x.id === f.id ? f : x)) : [...doc.features, f];
  // bodies whose profile was a removed entity follow the new outline of the same feature
  const outlineId = g.ents.find((e) => e.id.endsWith('_o') || e.id.endsWith('_s') || e.id.endsWith('_p'))?.id;
  const bodies: Body[] = doc.bodies.map((bd) => (gone.has(bd.profile) && outlineId ? { ...bd, profile: outlineId } : bd));
  return { doc: { ...doc, ents, constraints, features, bodies } };
}
/** Insert a library component (and, optionally, its 3D body made from the same outline). */
export function insertLibrary(doc: StudioDoc, familyId: string, params: Record<string, number | string | boolean>, at0: Pt | 'beside', view: 'top' | 'side', withBody: boolean): { doc: StudioDoc; error?: string } {
  const fam = getFamily(familyId); if (!fam) return { doc, error: 'Unknown component.' };
  let f: Feature = { id: uid('f'), t: 'library', familyId, params: { ...fam.defaults, ...params }, at: at0 === 'beside' ? [0, 0] : at0, label: fam.name, view };
  let g = generate(f);
  if (g.error) return { doc, error: g.error };
  if (at0 === 'beside') {
    // place it to the right of what is already drawn, so it does not land on top of other geometry
    const have = boxOf(doc.ents.filter((e) => e.k !== 'dim' && e.k !== 'text')), mine = boxOf(g.ents);
    if (boxOk(have) && boxOk(mine)) { const gap = Math.max(10, (mine.x1 - mine.x0) * 0.25); f = { ...f, at: [have.x1 + gap - mine.x0, (have.y0 + have.y1) / 2 - (mine.y0 + mine.y1) / 2] }; g = generate(f); }
  }
  const at = (f as Extract<Feature, { t: 'library' }>).at;
  let next = regenerate(doc, f).doc;
  if (withBody) {
    const outline = g.ents.find((e) => e.id === `${f.id}_o`);
    if (outline) {
      const [z0, z1] = g.z && Number.isFinite(g.z[0]) ? g.z : [0, 10];
      const body: Body = view === 'top'
        ? { id: uid('b'), name: fam.name, op: 'extrude', profile: outline.id, z0, depth: Math.max(0.01, z1 - z0), mode: next.bodies.length ? 'add' : 'new', material: g.material ?? doc.material, color: '#8d96a0', visible: true }
        : { id: uid('b'), name: fam.name, op: 'revolve', profile: outline.id, z0: 0, depth: 0, axis: 'x', axisAt: at[1], angle: 360, mode: next.bodies.length ? 'add' : 'new', material: g.material ?? doc.material, color: '#8d96a0', visible: true };
      next = { ...next, bodies: [...next.bodies, body] };
    }
  }
  return { doc: next };
}
export const featureLabel = (f: Feature): string => (f.t === 'holePattern' ? `${f.n} holes Ø${+f.d.toFixed(3)} on PCD ${+f.pcd.toFixed(3)}` : f.t === 'gridHoles' ? `${f.nx}×${f.ny} holes Ø${+f.d.toFixed(3)}` : f.t === 'slot' ? `Slot ${+f.w.toFixed(3)} × ${+(f.len + f.w).toFixed(3)}` : f.t === 'polygon' ? `${f.n}-sided polygon` : `${f.label}`);
export { sub };
