import type { Family } from '../core/family.ts';
import type { AsmInfo } from '../core/asminfo.ts';
import type { CalcResult, Params } from '../core/types.ts';
import type { GeoPart } from '../core/prims.ts';
import type { M3, V3 } from '../core/xform.ts';
import { add, apply, cross, dot, len, norm, rotMat, sub, xf } from '../core/xform.ts';
import { getFamily } from '../families/index.ts';
import { sprocketDefaults } from '../families/sprocket/calc.ts';
import { polygonArea } from '../core/geom.ts';

export interface AsmItem { id: string; familyId: string; name: string; params: Params; pos: V3; rot: V3 }
export interface Assembly { id: string; name: string; items: AsmItem[]; createdAt: string; updatedAt: string }
export interface Placed { item: AsmItem; family: Family; calc: CalcResult; geo: GeoPart[]; info: AsmInfo; M: M3; pos: V3; axis: V3; zr: [number, number]; mass: number }
export interface Issue { level: 'error' | 'warning' | 'info'; items: string[]; message: string; exact?: boolean }

export const newItemId = (): string => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function zExtent(geo: GeoPart[]): [number, number] {
  let a = Infinity, b = -Infinity;
  for (const g of geo) for (const p of g.prims) {
    const lo = p.kind === 'sphere' ? p.c[2] - p.r : p.z0, hi = p.kind === 'sphere' ? p.c[2] + p.r : p.z1;
    a = Math.min(a, lo); b = Math.max(b, hi);
  }
  return [a, b];
}

/** Computes the design of one item and its world transform. Returns null if the item's own parameters are invalid. */
export function placeItem(item: AsmItem): Placed | null {
  const family = getFamily(item.familyId);
  if (!family) return null;
  const calc = family.calculate(item.params);
  if (!calc.ok) return null;
  const geo = family.geo(calc.derived), M = rotMat(item.rot);
  return { item, family, calc, geo, info: family.asm(calc.derived), M, pos: item.pos, axis: norm(apply(M, [0, 0, 1])), zr: zExtent(geo), mass: calc.derived.massKg ?? 0 };
}
export const placeAll = (items: AsmItem[]): { placed: Placed[]; invalid: AsmItem[] } => {
  const placed: Placed[] = [], invalid: AsmItem[] = [];
  for (const it of items) { const p = placeItem(it); if (p) placed.push(p); else invalid.push(it); }
  return { placed, invalid };
};

/** Axial coordinate (along `axis`) of local z-range [z0,z1] of a placed item. */
export function axialRange(p: Placed, z0: number, z1: number, axis: V3): [number, number] {
  const a = dot(xf(p.M, p.pos, [0, 0, z0]), axis), b = dot(xf(p.M, p.pos, [0, 0, z1]), axis);
  return [Math.min(a, b), Math.max(a, b)];
}
export function coaxial(a: Placed, b: Placed, tol = 0.05): boolean {
  if (len(cross(a.axis, b.axis)) > 1e-3) return false;
  const d = sub(b.pos, a.pos), along = dot(d, a.axis);
  return len(sub(d, [a.axis[0] * along, a.axis[1] * along, a.axis[2] * along])) <= tol;
}

/** Puts `id` on the axis of `target`, `offset` mm along that axis from the target's local origin, with the same orientation. */
export function alignCoaxial(items: AsmItem[], id: string, targetId: string, offset: number): AsmItem[] {
  const t = items.find((i) => i.id === targetId);
  if (!t) return items;
  const M = rotMat(t.rot), ax = norm(apply(M, [0, 0, 1]));
  return items.map((i) => (i.id === id ? { ...i, rot: [...t.rot] as V3, pos: add(t.pos, [ax[0] * offset, ax[1] * offset, ax[2] * offset]) } : i));
}

/* ------------------------- compatibility ------------------------- */
export function checkCompatibility(placed: Placed[]): Issue[] {
  const out: Issue[] = [];
  const mounted = new Set<string>();
  for (const B of placed) {
    if (B.info.bore === undefined) continue;
    for (const S of placed) {
      if (S === B || !S.info.sections || !coaxial(S, B)) continue;
      const [b0, b1] = axialRange(B, B.zr[0], B.zr[1], S.axis), mid = (b0 + b1) / 2;
      const secs = S.info.sections.map((s) => ({ ...s, r: axialRange(S, s.z0, s.z1, S.axis) }));
      const sec = secs.find((s) => mid >= s.r[0] - 1e-6 && mid <= s.r[1] + 1e-6);
      const names = [B.item.name, S.item.name];
      if (!sec) { if (secs.some((s) => b1 > s.r[0] && b0 < s.r[1])) out.push({ level: 'warning', items: names, message: `${B.item.name} is only partly on ${S.item.name} (its centre is beyond the shaft section).` }); continue; }
      mounted.add(B.item.id);
      const d = sec.d, bore = B.info.bore, gap = bore - d;
      if (B.info.thread) { if (gap < -0.01) out.push({ level: 'error', items: names, message: `${B.item.name}: hole ${bore} mm is smaller than ${S.item.name} Ø${d} mm.` }); else out.push({ level: 'info', items: names, message: `${B.item.name} (hole ${bore} mm) fits ${S.item.name} Ø${d} mm.` }); }
      else if (gap < -0.01) out.push({ level: 'error', items: names, message: `${B.item.name}: bore Ø${bore} mm is smaller than ${S.item.name} Ø${d} mm (interference fit not modelled).` });
      else if (gap <= 0.1) out.push({ level: 'info', items: names, message: `${B.item.name} bore Ø${bore} on ${S.item.name} Ø${d}: nominal fit (gap ${gap.toFixed(2)} mm).` });
      else if (gap <= 0.5) out.push({ level: 'warning', items: names, message: `${B.item.name} bore Ø${bore} is ${gap.toFixed(2)} mm larger than ${S.item.name} Ø${d}: loose fit, check tolerances (for example H7/h6).` });
      else out.push({ level: 'warning', items: names, message: `${B.item.name} bore Ø${bore} is ${gap.toFixed(2)} mm larger than ${S.item.name} Ø${d}: much too loose.` });
      if (secs.some((s) => s !== sec && b1 > s.r[0] + 0.01 && b0 < s.r[1] - 0.01 && s.r[0] !== sec.r[0])) out.push({ level: 'warning', items: names, message: `${B.item.name} spans a diameter step on ${S.item.name}.` });
    }
    if (!mounted.has(B.item.id) && B.family.id !== 'washer' && B.family.id !== 'hexnut') out.push({ level: 'warning', items: [B.item.name], message: `${B.item.name} is not mounted on any shaft (no coaxial shaft section under it).` });
  }
  const chains = new Map<string, string[]>();
  for (const p of placed) if (p.info.chain) chains.set(p.info.chain, [...(chains.get(p.info.chain) ?? []), p.item.name]);
  if (chains.size > 1) out.push({ level: 'warning', items: [...chains.values()].flat(), message: `Sprockets for different chains are in this assembly (${[...chains.keys()].join(', ')}). A chain drive needs matching chain pitch and roller size.` });
  for (const p of placed) if (p.family.id === 'sprocket' && p.calc.derived.key) out.push({ level: 'info', items: [p.item.name], message: `${p.item.name} has a bore keyway; shaft keyways are not modelled yet.` });
  return out;
}

/* ------------------------- interference ------------------------- */
interface Ring { p: Placed; axisPos: V3; rIn: number; rOut: number; s: [number, number] }
interface Box { p: Placed; min: V3; max: V3 }
function envelopes(p: Placed): { rings: Ring[]; boxes: Box[] } {
  const rings: Ring[] = [], boxes: Box[] = [];
  for (const g of p.geo) for (const pr of g.prims) {
    if (pr.kind === 'tube') rings.push({ p, axisPos: p.pos, rIn: pr.rIn, rOut: pr.rOut, s: axialRange(p, pr.z0, pr.z1, p.axis) });
    else if (pr.kind === 'prism') {
      const rOut = Math.max(...pr.outer.map((q) => Math.hypot(q[0], q[1])));
      const hole = pr.holes[0], holeCentred = pr.holes.length === 0 || (pr.holes.length === 1 && ('poly' in hole ? Math.abs(Math.min(...hole.poly.map((q) => q[0])) + Math.max(...hole.poly.map((q) => q[0]))) < 1e-3 : Math.hypot(hole.c[0], hole.c[1]) < 1e-6));
      // round-ish and centred on the axis (sprocket plates, hubs, hex nuts, hex bar; an off-axis outline has a low area ratio and stays a box): treat as a ring so coaxial fits are tested exactly
      if (holeCentred && polygonArea(pr.outer) / (Math.PI * rOut * rOut) >= 0.7) {
        const rIn = pr.holes.length === 0 ? 0 : 'poly' in hole ? Math.min(...hole.poly.map((q) => Math.hypot(q[0], q[1]))) : hole.r;
        rings.push({ p, axisPos: p.pos, rIn, rOut, s: axialRange(p, pr.z0, pr.z1, p.axis) });
        continue;
      }
      const xs = pr.outer.map((q) => q[0]), ys = pr.outer.map((q) => q[1]);
      const pts: V3[] = [];
      for (const x of [Math.min(...xs), Math.max(...xs)]) for (const y of [Math.min(...ys), Math.max(...ys)]) for (const z of [pr.z0, pr.z1]) pts.push(xf(p.M, p.pos, [x, y, z]));
      boxes.push({ p, min: [0, 1, 2].map((k) => Math.min(...pts.map((q) => q[k]))) as V3, max: [0, 1, 2].map((k) => Math.max(...pts.map((q) => q[k]))) as V3 });
    }
  }
  return { rings, boxes };
}
function ringBox(r: Ring): Box {
  const a = r.p.axis;
  const e = [0, 1, 2].map((k) => r.rOut * Math.sqrt(Math.max(0, 1 - a[k] * a[k])));
  // r.s are axial coordinates measured from the world origin; end points lie along the axis through axisPos
  const base = dot(r.axisPos, a);
  const q0 = [0, 1, 2].map((k) => r.axisPos[k] + a[k] * (r.s[0] - base)), q1 = [0, 1, 2].map((k) => r.axisPos[k] + a[k] * (r.s[1] - base));
  return { p: r.p, min: [0, 1, 2].map((k) => Math.min(q0[k], q1[k]) - e[k]) as V3, max: [0, 1, 2].map((k) => Math.max(q0[k], q1[k]) + e[k]) as V3 };
}
const boxOverlap = (a: Box, b: Box, tol: number) => [0, 1, 2].every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > tol);

export function checkInterference(placed: Placed[], tol = 0.01): Issue[] {
  const out: Issue[] = [], env = placed.map(envelopes);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const A = placed[i], B = placed[j];
    if (A.family.id === 'key' || B.family.id === 'key') continue; // keys sit in keyways that are not modelled
    const names = [A.item.name, B.item.name];
    let exact = false, hit = false, depth = 0;
    for (const ra of env[i].rings) for (const rb of env[j].rings) {
      if (coaxial(A, B)) {
        const rad = Math.min(ra.rOut, rb.rOut) - Math.max(ra.rIn, rb.rIn), ax = Math.min(ra.s[1], rb.s[1]) - Math.max(ra.s[0], rb.s[0]);
        if (rad > tol && ax > tol) { hit = true; exact = true; depth = Math.max(depth, Math.min(rad, ax)); }
      } else if (boxOverlap(ringBox(ra), ringBox(rb), tol)) { hit = true; }
    }
    if (!hit) {
      const ba = [...env[i].boxes, ...env[i].rings.map(ringBox)], bb = [...env[j].boxes, ...env[j].rings.map(ringBox)];
      const mixed = env[i].boxes.length + env[j].boxes.length > 0;
      if (mixed && ba.some((x) => bb.some((y) => boxOverlap(x, y, tol)))) hit = true;
    }
    if (hit) out.push({ level: exact ? 'error' : 'warning', items: names, exact, message: exact ? `${names[0]} and ${names[1]} overlap (${depth.toFixed(2)} mm of material interference).` : `${names[0]} and ${names[1]} may interfere (bounding-box check; exact test only for coaxial round parts).` });
  }
  return out;
}

/* ------------------------- BOM ------------------------- */
export interface BomRow { no: number; partNo: string; name: string; material: string; qty: number; massEach: number; massTotal: number }
export function buildBom(placed: Placed[]): BomRow[] {
  const map = new Map<string, BomRow>();
  for (const p of placed) {
    const key = p.family.id + JSON.stringify(p.item.params);
    const r = map.get(key);
    if (r) { r.qty += 1; r.massTotal = r.qty * r.massEach; }
    else map.set(key, { no: map.size + 1, partNo: p.family.partNo(p.item.params), name: p.family.name, material: p.family.materialOf(p.item.params), qty: 1, massEach: p.mass, massTotal: p.mass });
  }
  return [...map.values()];
}

/** World-space centre of an item's geometry (for exploded views). */
export function itemCentre(p: Placed): V3 {
  const [a, b] = p.zr;
  return xf(p.M, p.pos, [0, 0, (a + b) / 2]);
}
export function explodeOffsets(placed: Placed[], factor: number, size: number): V3[] {
  if (!placed.length) return [];
  const cs = placed.map(itemCentre), mean = cs.reduce((a, c) => add(a, c), [0, 0, 0] as V3).map((v) => v / cs.length) as V3;
  return placed.map((p, i) => {
    let d = sub(cs[i], mean);
    if (len(d) < 1e-6) d = p.axis;
    const n = norm(d);
    return [n[0] * factor * size, n[1] * factor * size, n[2] * factor * size] as V3;
  });
}

/* ------------------------- example ------------------------- */
export function exampleAssembly(): AsmItem[] {
  const sp = { ...sprocketDefaults('08B-1', 17), bore: 25, hubDia: 42, hubLength: 20, keyway: true };
  const shaft = { d1: 25, l1: 300, d2: 0, l2: 0, d3: 0, l3: 0, torque: 0, sf: 3, material: 'C45 Steel' };
  const brg = { designation: '6205', d: 25, D: 52, B: 15, material: 'Chrome Steel 100Cr6' };
  return [
    { id: newItemId(), familyId: 'shaft', name: 'Drive shaft', params: shaft, pos: [0, 0, 0], rot: [0, 0, 0] },
    { id: newItemId(), familyId: 'bearing', name: 'Bearing A', params: brg, pos: [0, 0, 30], rot: [0, 0, 0] },
    { id: newItemId(), familyId: 'sprocket', name: 'Drive sprocket', params: sp, pos: [0, 0, 100], rot: [0, 0, 0] },
    { id: newItemId(), familyId: 'bearing', name: 'Bearing B', params: brg, pos: [0, 0, 255], rot: [0, 0, 0] },
  ];
}
