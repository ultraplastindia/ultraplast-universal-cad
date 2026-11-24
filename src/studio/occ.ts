/* Exact 3D model of a studio design with the OpenCascade kernel (replicad), for STEP export and the "exact model" preview.
 * This file only runs in the browser after the kernel is loaded (src/exporters/kernel.ts). Each operation is wrapped so that a
 * kernel failure gives a readable message naming the body and the operation, and never changes the design. */
import type { Pt } from '../core/types.ts';
import type { Body, StudioDoc } from './model.ts';
import { findLoops, profileOf } from './profiles.ts';
import type { Profile } from './profiles.ts';
import { revolvePlace, revolveRegion } from './solid.ts';

type Shape = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Rep = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function polySketch(R: Rep, pts: Pt[], plane: 'XY' | 'XZ', offset = 0): Shape {
  let d = R.draw(pts[0]);
  for (const p of pts.slice(1)) d = d.lineTo(p);
  return d.close().sketchOnPlane(plane, offset);
}
function extrudeProfile(R: Rep, p: Profile, z0: number, h: number): Shape {
  let s = p.outer.circle ? R.makeCylinder(p.outer.circle.r, h, [p.outer.circle.c[0], p.outer.circle.c[1], z0], [0, 0, 1]) : polySketch(R, p.outer.pts, 'XY', z0).extrude(h);
  for (const hole of p.holes) s = s.cut(hole.circle ? R.makeCylinder(hole.circle.r, h + 2, [hole.circle.c[0], hole.circle.c[1], z0 - 1], [0, 0, 1]) : polySketch(R, hole.pts, 'XY', z0 - 1).extrude(h + 2));
  return s;
}
function revolveProfile(R: Rep, p: Profile, b: Body): Shape {
  const reg = revolveRegion(p, b.axis ?? 'y', b.axisAt ?? 0);
  // (radius, axial) drawn on the XZ plane = (x, z); revolved about the Z axis
  let s = polySketch(R, reg.outer, 'XZ').revolve([0, 0, 1]);
  for (const h of reg.holes) s = s.cut(polySketch(R, h, 'XZ').revolve([0, 0, 1]));
  const ang = b.angle ?? 360;
  if (ang < 360) {
    const big = 1e5, n = Math.max(2, Math.ceil(ang / 30)), sector: Pt[] = [[0, 0]];
    for (let i = 0; i <= n; i++) { const a = ((ang * i) / n) * (Math.PI / 180); sector.push([big * Math.cos(a), big * Math.sin(a)]); }
    s = s.intersect(polySketch(R, sector, 'XY', -big).extrude(2 * big));
  }
  const pl = revolvePlace(b.axis ?? 'y', b.axisAt ?? 0);
  if (pl.rot[0]) s = s.rotate(pl.rot[0], [0, 0, 0], [1, 0, 0]);
  if (pl.rot[1]) s = s.rotate(pl.rot[1], [0, 0, 0], [0, 1, 0]);
  return s.translate(pl.pos[0], pl.pos[1], pl.pos[2]);
}

export interface ExactResult { shape: Shape; solids: Shape[]; log: string[] }

/** Builds every visible body in order and combines them (new / add / cut / intersect). Throws Error with the body and step that failed. */
export function studioExact(R: Rep, doc: StudioDoc): ExactResult {
  const found = findLoops(doc);
  const solids: { id: string; s: Shape }[] = [];
  const log: string[] = [];
  const step = <T>(b: Body, what: string, f: () => T): T => { try { return f(); } catch (e) { throw new Error(`3D body "${b.name}", ${what}: the exact kernel could not do this (${e instanceof Error ? e.message : String(e)}). Try a smaller value.`); } };
  for (const b of doc.bodies) {
    if (!b.visible) continue;
    const others = new Set(doc.bodies.filter((x) => x.id !== b.id && x.profile !== b.profile).flatMap((x) => [x.profile, ...(x.profile2 ? [x.profile2] : [])]));
    const p = profileOf(doc, b.profile, found, others);
    if ('error' in p) throw new Error(`3D body "${b.name}": ${p.error}`);
    let s: Shape;
    if (b.op === 'extrude') s = step(b, 'extrude', () => extrudeProfile(R, p, b.z0, b.depth));
    else if (b.op === 'revolve') s = step(b, 'revolve', () => revolveProfile(R, p, b));
    else {
      const p2 = b.profile2 ? profileOf(doc, b.profile2, found) : null;
      if (!p2 || 'error' in p2) throw new Error(`3D body "${b.name}": the loft needs a second closed profile.`);
      s = step(b, 'loft', () => polySketch(R, p.outer.pts, 'XY', b.z0).loftWith(polySketch(R, p2.outer.pts, 'XY', b.z0 + b.depth)));
    }
    if (b.fillet) s = step(b, `fillet R${b.fillet}`, () => s.fillet(b.fillet));
    if (b.chamfer) s = step(b, `chamfer ${b.chamfer}`, () => s.chamfer(b.chamfer));
    if (b.shell) { if (b.op === 'revolve') throw new Error(`3D body "${b.name}": shell is available for extruded and lofted bodies only.`); const top = b.z0 + b.depth; s = step(b, `shell ${b.shell} mm`, () => s.shell(b.shell, (f: Shape) => f.inPlane('XY', top))); }
    if (b.pattern && b.pattern.n > 1) {
      const base = s;
      for (let k = 1; k < b.pattern.n; k++) {
        const pat = b.pattern;
        const copy = step(b, 'pattern', () => (pat.kind === 'circular' ? base.clone().rotate((360 * k) / pat.n, [0, 0, 0], [0, 0, 1]) : base.clone().translate(pat.dx * k, pat.dy * k, 0)));
        s = step(b, 'pattern (join copies)', () => s.fuse(copy));
      }
    }
    if (b.mode === 'new' || !solids.length) { solids.push({ id: b.id, s }); log.push(`${b.name}: ${b.op}`); continue; }
    const targetIdx = b.target ? solids.findIndex((x) => x.id === b.target) : solids.length - 1;
    const t = solids[targetIdx < 0 ? solids.length - 1 : targetIdx];
    if (b.mode === 'add') t.s = step(b, 'add (union)', () => t.s.fuse(s));
    else if (b.mode === 'cut') t.s = step(b, 'cut (subtract)', () => t.s.cut(s));
    else t.s = step(b, 'intersect', () => t.s.intersect(s));
    log.push(`${b.name}: ${b.mode} into ${doc.bodies.find((x) => x.id === t.id)?.name ?? 'body'}`);
  }
  if (!solids.length) throw new Error('There are no visible 3D bodies. Make one in the 3D tab first.');
  const all = solids.map((x) => x.s);
  const mk = R.compoundShapes ?? R.makeCompound;
  const shape = all.length === 1 ? all[0] : mk ? mk(all) : all.reduce((a: Shape, b2: Shape) => a.fuse(b2));
  return { shape, solids: all, log };
}

/** Triangles of the exact model for the preview (and its volume from the mesh, mm³). */
export function meshOf(shape: Shape, tol = 0.05): { vertices: number[]; triangles: number[]; volume: number } {
  const m = shape.mesh({ tolerance: tol, angularTolerance: 0.2 }) as { vertices: number[]; triangles: number[] };
  let v = 0;
  const V = m.vertices, T = m.triangles;
  for (let i = 0; i + 2 < T.length; i += 3) {
    const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
    v += (V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c])) / 6;
  }
  return { vertices: m.vertices, triangles: m.triangles, volume: Math.abs(v) };
}
