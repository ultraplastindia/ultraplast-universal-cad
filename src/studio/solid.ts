import type { Pt } from '../core/types.ts';
import type { GeoPart, Hole, Prim } from '../core/prims.ts';
import type { V3 } from '../core/xform.ts';
import type { Body, StudioDoc } from './model.ts';
import { material } from '../data/materials.ts';
import { dist, rotateAff, applyAff } from './geom.ts';
import { findLoops, loopInside, loopsCross, profileOf, regionMomentX } from './profiles.ts';
import type { Loop, Profile } from './profiles.ts';

/* 2D -> 3D. Each body turns a closed profile of the sketch into exact primitives (the same primitives every other part of the app uses):
 *  - extrude: one prism with its holes (exact), pocket / partial cuts split the prism into exact slabs;
 *  - revolve: stacked rings (exact for stepped shafts and rollers; sloped edges are approximated by thin steps, mass is exact by Pappus);
 *  - loft: thin interpolated slices (approximation; the exact loft is made by the OpenCascade kernel for STEP).
 * Fillet, chamfer, shell, intersect and cuts that cross an outline need the exact kernel: they are listed in `exactOnly`. */

export interface Placement { rot: V3; pos: V3 }
export interface BuiltPart { geo: GeoPart; place: Placement; body: string }
export interface BodyReport { id: string; name: string; ok: boolean; error?: string; volume: number; mass: number; approx: string[]; exactOnly: string[] }
export interface Built {
  parts: BuiltPart[]; reports: BodyReport[];
  volume: number; mass: number;
  /** some body overlaps another: the summed volume counts the overlap twice */
  overlaps: string[];
  bbox: { min: V3; max: V3 } | null;
}
export const NO_PLACE: Placement = { rot: [0, 0, 0], pos: [0, 0, 0] };

const holeOf = (h: Loop): Hole => (h.circle ? { c: h.circle.c, r: h.circle.r } : { poly: h.pts });
/** keeps the part of a polygon where f(p) >= 0 (Sutherland-Hodgman against one straight edge) */
export function clipHalf(pts: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
/** crossings of the horizontal line y = yy with a closed polygon, as sorted x values */
function scan(pts: Pt[], yy: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; if ((y0 > yy) !== (y1 > yy)) xs.push(x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0)); }
  return xs.sort((a, b) => a - b);
}

/** Revolve profile in (radius, axial) coordinates, clipped to one side of the axis. */
export function revolveRegion(p: Profile, axis: 'x' | 'y', at: number): { outer: Pt[]; holes: Pt[][]; side: 1 | -1 } {
  const toRA = (q: Pt): Pt => (axis === 'y' ? [q[0] - at, q[1]] : [q[1] - at, q[0]]);
  const o = p.outer.pts.map(toRA);
  const pos = o.reduce((s, q) => s + Math.max(0, q[0]), 0), neg = o.reduce((s, q) => s + Math.max(0, -q[0]), 0);
  const side: 1 | -1 = pos >= neg ? 1 : -1;
  const f = (q: Pt) => side * q[0];
  const flip = (pts: Pt[]) => pts.map((q) => [side * q[0], q[1]] as Pt);
  return { outer: flip(clipHalf(o, f)), holes: p.holes.map((h) => flip(clipHalf(h.pts.map(toRA), f))).filter((h) => h.length >= 3), side };
}
/** Stacked rings of a revolve region: exact where the profile edges are parallel to the axis, thin steps elsewhere. */
export function revolveRings(reg: { outer: Pt[]; holes: Pt[][] }, maxStep = 0.25): { prims: Prim[]; stepped: boolean } {
  const all = [reg.outer, ...reg.holes];
  const zs = [...new Set(all.flat().map((q) => +q[1].toFixed(9)))].sort((a, b) => a - b);
  const prims: Prim[] = []; let stepped = false;
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i], zb = zs[i + 1]; if (zb - za < 1e-9) continue;
    // does the radius change inside this band?
    const rAt = (z: number) => { const xs = all.flatMap((pl) => scan(pl, z)); return xs; };
    const lo = rAt(za + (zb - za) * 1e-6), hi = rAt(zb - (zb - za) * 1e-6);
    const sloped = lo.length !== hi.length || lo.some((x, k) => Math.abs(x - hi[k]) > 1e-7);
    const n = sloped ? Math.min(400, Math.max(2, Math.ceil(Math.max(...lo.map((x, k) => Math.abs(x - (hi[k] ?? x))), 0) / maxStep), Math.ceil((zb - za) / 2))) : 1;
    if (sloped) stepped = true;
    for (let s = 0; s < n; s++) {
      const z0 = za + ((zb - za) * s) / n, z1 = za + ((zb - za) * (s + 1)) / n, zm = (z0 + z1) / 2;
      const xs = all.flatMap((pl) => scan(pl, zm)).sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { const rIn = Math.max(0, xs[k]), rOut = xs[k + 1]; if (rOut - rIn > 1e-9) prims.push({ kind: 'tube', rIn: rIn < 1e-6 ? 0 : rIn, rOut, z0, z1 }); }
    }
  }
  return { prims, stepped };
}
/** volume of an exact region revolved by `angle` degrees (Pappus) */
export function revolveVolume(p: Profile, axis: 'x' | 'y', at: number, angle = 360): number {
  const reg = revolveRegion(p, axis, at);
  const prof: Profile = { outer: { ids: [], pts: reg.outer, area: 0 }, holes: reg.holes.map((h) => ({ ids: [], pts: h, area: 0 })), islands: 0, crossing: [] };
  const { M } = regionMomentX(prof, 'y', 0);
  return Math.abs(M) * ((angle * Math.PI) / 180);
}
/** resample a closed polygon to n points spaced evenly along its length (for lofts) */
export function resample(pts: Pt[], n: number): Pt[] {
  const L: number[] = [0]; for (let i = 0; i < pts.length; i++) L.push(L[i] + dist(pts[i], pts[(i + 1) % pts.length]));
  const tot = L[L.length - 1], out: Pt[] = []; let j = 0;
  for (let k = 0; k < n; k++) { const s = (tot * k) / n; while (j < pts.length - 1 && L[j + 1] < s) j++; const a = pts[j], b = pts[(j + 1) % pts.length], t = (s - L[j]) / Math.max(1e-12, L[j + 1] - L[j]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  // start both loops at the point with the smallest angle so they do not twist
  return out;
}
const prismVol = (p: Extract<Prim, { kind: 'prism' }>): number => {
  const A = (pts: Pt[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const q = pts[i], r = pts[(i + 1) % pts.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a / 2); };
  return (A(p.outer) - p.holes.reduce((s, h) => s + ('poly' in h ? A(h.poly) : Math.PI * h.r * h.r), 0)) * (p.z1 - p.z0);
};
export const primVolume = (p: Prim): number => (p.kind === 'tube' ? Math.PI * (p.rOut ** 2 - p.rIn ** 2) * (p.z1 - p.z0) : p.kind === 'sphere' ? (4 / 3) * Math.PI * p.r ** 3 : prismVol(p));

/** placement that turns a ring stack (axis along local Z) into the sketch's revolve axis */
export function revolvePlace(axis: 'x' | 'y', at: number): Placement {
  return axis === 'y' ? { rot: [-90, 0, 0], pos: [at, 0, 0] } : { rot: [0, 90, 0], pos: [0, at, 0] };
}

export function buildBodies(doc: StudioDoc): Built {
  const found = findLoops(doc);
  const parts: BuiltPart[] = [], reports: BodyReport[] = [];
  const byBody = new Map<string, BuiltPart[]>();
  for (const b of doc.bodies) {
    const others = new Set(doc.bodies.filter((x) => x.id !== b.id && x.profile !== b.profile).flatMap((x) => [x.profile, ...(x.profile2 ? [x.profile2] : [])]));
    const rep: BodyReport = { id: b.id, name: b.name, ok: true, volume: 0, mass: 0, approx: [], exactOnly: [] };
    reports.push(rep);
    if (!b.visible) { rep.ok = false; rep.error = 'Hidden.'; continue; }
    const prof = profileOf(doc, b.profile, found, others);
    if ('error' in prof) { rep.ok = false; rep.error = prof.error; continue; }
    if (prof.crossing.length) rep.approx.push(`${prof.crossing.length} outline(s) cross this profile and are ignored.`);
    if (prof.islands) rep.approx.push(`${prof.islands} outline(s) inside holes are ignored (islands need a separate body).`);
    if (b.fillet) rep.exactOnly.push(`edge fillet R${b.fillet}`);
    if (b.chamfer) rep.exactOnly.push(`edge chamfer ${b.chamfer}`);
    if (b.shell) rep.exactOnly.push(`shell ${b.shell} mm`);
    if (b.mode === 'intersect') rep.exactOnly.push('intersection with the body below');
    const dens = material(b.material)?.density ?? material(doc.material)?.density ?? 7.85e-6;
    const mine: BuiltPart[] = [];
    if (b.op === 'extrude') {
      if (!(b.depth > 0)) { rep.ok = false; rep.error = 'Extrude depth must be above 0.'; continue; }
      const prim: Prim = { kind: 'prism', outer: prof.outer.pts, holes: prof.holes.map(holeOf), z0: b.z0, z1: b.z0 + b.depth };
      if (b.mode === 'cut') {
        const target = findTarget(doc, b, byBody);
        if (!target) { rep.ok = false; rep.error = 'A cut needs a body below it to cut. Make the main body first.'; continue; }
        const res = cutInto(target, prof, b.z0, b.z0 + b.depth);
        if (res.error) rep.exactOnly.push(res.error); else rep.volume = -res.removed;
        rep.mass = rep.volume * dens; continue;
      }
      mine.push({ geo: { id: b.id, name: b.name, color: b.color, prims: [prim], explode: [0, 0, 0] }, place: NO_PLACE, body: b.id });
    } else if (b.op === 'revolve') {
      const axis = b.axis ?? 'y', at = b.axisAt ?? 0, ang = b.angle ?? 360;
      const reg = revolveRegion(prof, axis, at);
      if (reg.outer.length < 3) { rep.ok = false; rep.error = 'The profile lies on the axis line; move it beside the axis.'; continue; }
      const rings = revolveRings(reg);
      if (!rings.prims.length) { rep.ok = false; rep.error = 'The revolve gives no material.'; continue; }
      if (rings.stepped) rep.approx.push('sloped or curved edges are shown as fine steps in the preview and STL (mass is exact; STEP uses the exact revolve)');
      if (ang < 360) rep.exactOnly.push(`partial revolve (${ang}°)`);
      if (b.mode === 'cut') { rep.exactOnly.push('cut by a revolved body'); continue; }
      mine.push({ geo: { id: b.id, name: b.name, color: b.color, prims: rings.prims, explode: [0, 0, 0] }, place: revolvePlace(axis, at), body: b.id });
      rep.volume = revolveVolume(prof, axis, at, ang); rep.mass = rep.volume * dens;
    } else {
      const p2 = b.profile2 ? profileOf(doc, b.profile2, found) : null;
      if (!p2 || 'error' in p2) { rep.ok = false; rep.error = p2 && 'error' in p2 ? `Second profile: ${p2.error}` : 'A loft needs a second profile (the top shape).'; continue; }
      if (!(b.depth > 0)) { rep.ok = false; rep.error = 'Loft height must be above 0.'; continue; }
      const N = 96, A = alignStart(resample(prof.outer.pts, N)), Bp = alignStart(resample(p2.outer.pts, N)), steps = 24, prims: Prim[] = [];
      for (let s = 0; s < steps; s++) { const t = (s + 0.5) / steps; prims.push({ kind: 'prism', outer: A.map((q, i) => [q[0] + (Bp[i][0] - q[0]) * t, q[1] + (Bp[i][1] - q[1]) * t] as Pt), holes: [], z0: b.z0 + (b.depth * s) / steps, z1: b.z0 + (b.depth * (s + 1)) / steps }); }
      rep.approx.push('loft shown as 24 thin slices (STEP uses the exact loft); holes in loft profiles are ignored');
      mine.push({ geo: { id: b.id, name: b.name, color: b.color, prims, explode: [0, 0, 0] }, place: NO_PLACE, body: b.id });
    }
    // patterns
    if (b.pattern && b.pattern.n > 1) {
      const base = mine.slice();
      for (let k = 1; k < b.pattern.n; k++) for (const m of base) {
        if (b.pattern.kind === 'circular') {
          const ang = (360 * k) / b.pattern.n;
          if (m.place === NO_PLACE) { const R = rotateAff([0, 0], ang), T = (q: Pt) => applyAff(R, q); mine.push({ ...m, geo: { ...m.geo, id: `${m.geo.id}_${k}`, prims: m.geo.prims.map((p) => (p.kind === 'prism' ? { ...p, outer: p.outer.map(T), holes: p.holes.map((h) => ('poly' in h ? { poly: h.poly.map(T) } : { c: T(h.c), r: h.r })) } : p)) } }); }
          else { const c = applyAff(rotateAff([0, 0], ang), [m.place.pos[0], m.place.pos[1]]); mine.push({ ...m, geo: { ...m.geo, id: `${m.geo.id}_${k}` }, place: { rot: m.place.rot, pos: [c[0], c[1], m.place.pos[2]] } }); rep.exactOnly.push('circular pattern of a revolved body (copies are placed, not rotated)'); }
        } else {
          const dx = b.pattern.dx * k, dy = b.pattern.dy * k;
          if (m.place === NO_PLACE) mine.push({ ...m, geo: { ...m.geo, id: `${m.geo.id}_${k}`, prims: m.geo.prims.map((p) => (p.kind === 'prism' ? { ...p, outer: p.outer.map((q) => [q[0] + dx, q[1] + dy] as Pt), holes: p.holes.map((h) => ('poly' in h ? { poly: h.poly.map((q) => [q[0] + dx, q[1] + dy] as Pt) } : { c: [h.c[0] + dx, h.c[1] + dy] as Pt, r: h.r })) } : p)) } });
          else mine.push({ ...m, geo: { ...m.geo, id: `${m.geo.id}_${k}` }, place: { rot: m.place.rot, pos: [m.place.pos[0] + dx, m.place.pos[1] + dy, m.place.pos[2]] } });
        }
      }
    }
    if (b.op !== 'revolve') rep.volume = mine.reduce((s, m) => s + m.geo.prims.reduce((a, p) => a + primVolume(p), 0), 0);
    else rep.volume *= Math.max(1, b.pattern?.n ?? 1);
    rep.mass = rep.volume * dens;
    byBody.set(b.id, mine);
    parts.push(...mine);
  }
  // cuts changed prisms in place; recompute volumes of the cut targets
  for (const rep of reports) { const m = byBody.get(rep.id); const b = doc.bodies.find((x) => x.id === rep.id); if (m && b && b.op !== 'revolve') { rep.volume = m.reduce((s, x) => s + x.geo.prims.reduce((a, p) => a + primVolume(p), 0), 0); const dens = material(b.material)?.density ?? 7.85e-6; rep.mass = rep.volume * dens; } }
  const solidReports = reports.filter((r) => r.ok && r.volume > 0);
  const bbox = boxOfParts(parts);
  const overlaps = findOverlaps(parts);
  return { parts, reports, volume: solidReports.reduce((s, r) => s + r.volume, 0), mass: solidReports.reduce((s, r) => s + r.mass, 0), overlaps, bbox };
}

function alignStart(pts: Pt[]): Pt[] {
  const c: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  let k = 0, best = Infinity; pts.forEach((p, i) => { const a = Math.atan2(p[1] - c[1], p[0] - c[0]); const d = Math.abs(a); if (d < best) { best = d; k = i; } });
  return [...pts.slice(k), ...pts.slice(0, k)];
}
function findTarget(doc: StudioDoc, b: Body, byBody: Map<string, BuiltPart[]>): BuiltPart[] | null {
  if (b.target && byBody.has(b.target)) return byBody.get(b.target)!;
  const before = doc.bodies.slice(0, doc.bodies.findIndex((x) => x.id === b.id)).filter((x) => x.mode !== 'cut' && byBody.has(x.id));
  return before.length ? byBody.get(before[before.length - 1].id)! : null;
}
/** Cuts a profile into the prisms of the target between z0 and z1 by splitting them into slabs. Exact when the cut lies inside the outline. */
function cutInto(target: BuiltPart[], prof: Profile, z0: number, z1: number): { removed: number; error?: string } {
  let removed = 0, hit = false;
  const cutLoop = prof.outer;
  for (const part of target) {
    if (part.place !== NO_PLACE) return { removed: 0, error: 'cut into a revolved body' };
    const next: Prim[] = [];
    for (const p of part.geo.prims) {
      if (p.kind !== 'prism' || p.z1 <= z0 + 1e-9 || p.z0 >= z1 - 1e-9) { next.push(p); continue; }
      const outerLoop: Loop = { ids: [], pts: p.outer, area: Math.abs(areaOf(p.outer)) };
      if (!loopInside(cutLoop, outerLoop)) { if (loopsCross(cutLoop, outerLoop)) return { removed: 0, error: 'cut that crosses the outline (an open pocket or notch)' }; next.push(p); continue; }
      const overHole = p.holes.some((h) => { const hl: Loop = 'poly' in h ? { ids: [], pts: h.poly, area: Math.abs(areaOf(h.poly)) } : { ids: [], pts: circlePts(h.c, h.r), area: Math.PI * h.r * h.r }; return loopsCross(hl, cutLoop) || loopInside(hl, cutLoop) || loopInside(cutLoop, hl); });
      if (overHole) return { removed: 0, error: 'cut that overlaps an existing hole' };
      hit = true;
      const a = Math.max(p.z0, z0), b2 = Math.min(p.z1, z1);
      const cutHole: Hole = cutLoop.circle ? { c: cutLoop.circle.c, r: cutLoop.circle.r } : { poly: cutLoop.pts };
      if (a > p.z0 + 1e-9) next.push({ ...p, z1: a });
      next.push({ ...p, z0: a, z1: b2, holes: [...p.holes, cutHole] });
      if (b2 < p.z1 - 1e-9) next.push({ ...p, z0: b2 });
      removed += (cutLoop.circle ? Math.PI * cutLoop.circle.r ** 2 : cutLoop.area) * (b2 - a);
    }
    part.geo = { ...part.geo, prims: next };
  }
  return hit ? { removed } : { removed: 0, error: 'cut that does not touch the body below (check the profile position and the heights)' };
}
const areaOf = (pts: Pt[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const circlePts = (c: Pt, r: number): Pt[] => Array.from({ length: 64 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 32), c[1] + r * Math.sin((i * Math.PI) / 32)] as Pt);

/** axis-aligned box of a built part in model space (placement applied) */
export function partBox(m: BuiltPart): { min: V3; max: V3 } {
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  const addP = (x: number, y: number, z: number) => { const q = place(m.place, [x, y, z]); for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i]); mx[i] = Math.max(mx[i], q[i]); } };
  for (const p of m.geo.prims) {
    if (p.kind === 'prism') for (const q of p.outer) { addP(q[0], q[1], p.z0); addP(q[0], q[1], p.z1); }
    else if (p.kind === 'tube') for (const z of [p.z0, p.z1]) for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]]) addP(s[0] * p.rOut, s[1] * p.rOut, z);
    else { addP(p.c[0] - p.r, p.c[1] - p.r, p.c[2] - p.r); addP(p.c[0] + p.r, p.c[1] + p.r, p.c[2] + p.r); }
  }
  return { min: mn, max: mx };
}
/** rotation (degrees about X, then Y, then Z) and translation of a point */
export function place(pl: Placement, p: V3): V3 {
  let [x, y, z] = p;
  const [ax, ay, az] = pl.rot.map((d) => (d * Math.PI) / 180);
  if (ax) { const c = Math.cos(ax), s = Math.sin(ax); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ay) { const c = Math.cos(ay), s = Math.sin(ay); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (az) { const c = Math.cos(az), s = Math.sin(az); [x, y] = [x * c - y * s, x * s + y * c]; }
  return [x + pl.pos[0], y + pl.pos[1], z + pl.pos[2]];
}
function boxOfParts(parts: BuiltPart[]): { min: V3; max: V3 } | null {
  if (!parts.length) return null;
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of parts) { const b = partBox(m); for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.min[i]); mx[i] = Math.max(mx[i], b.max[i]); } }
  return { min: mn, max: mx };
}
function findOverlaps(parts: BuiltPart[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (parts[i].body === parts[j].body) continue;
    const a = partBox(parts[i]), b = partBox(parts[j]);
    const ov = [0, 1, 2].every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 1e-6);
    if (ov) out.push(`${parts[i].geo.name} / ${parts[j].geo.name}`);
  }
  return [...new Set(out)];
}
