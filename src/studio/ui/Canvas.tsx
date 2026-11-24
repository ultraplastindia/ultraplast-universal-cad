import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pt } from '../../core/types.ts';
import type { Constraint, Ent, EntOf, StudioDoc, Unit } from '../model.ts';
import { fmtLen, uid } from '../model.ts';
import {
  angOf, boxAdd, boxOf, boxOk, dimGeometry, dimLabel, dist, emptyBox, ellipsePt, entBox, entDist, handles, mid, mirrorAff, polarPt, polyPts,
  rotateAff, setHandle, snapPoints, splinePts, sub, sweepOf, tess, transformEnt, translateAff, crossings, norm, add, mul, findEnt,
} from '../geom.ts';
import { chamferLines, cornerPoly, extendLine, filletLines, nearestOn, offsetEnt, simplifyStroke, trimEnt } from '../edit.ts';
import type { EditResult } from '../edit.ts';
import { circumcentre } from '../../core/geom.ts';
import { regenerate } from '../features.ts';
import { solve } from '../solver.ts';
import type { Comparison } from '../compare.ts';
import { toMm } from '../compare.ts';
import type { KeyEv, PtrEv } from './Fields.tsx';

export type Tool = 'select' | 'pan' | 'line' | 'polyline' | 'rect' | 'circle' | 'arc' | 'ellipse' | 'polygon' | 'spline' | 'freehand' | 'text' | 'centreline' | 'construction'
  | 'dim' | 'measure' | 'move' | 'copy' | 'rotate' | 'mirror' | 'offset' | 'trim' | 'extend' | 'fillet' | 'chamfer' | 'holes' | 'slot' | 'calibrate';
export interface ToolOpts {
  dist: number; radius: number; chamfer: number; sides: number; angle: number; text: string; textH: number;
  dimMode: 'auto' | 'h' | 'v' | 'angle'; holeN: number; holeD: number; holePcd: number; slotLen: number; slotW: number; slotAng: number;
  rectConstrain: boolean; mirrorCopy: boolean; smooth: boolean;
}
export const DEFAULT_OPTS: ToolOpts = { dist: 5, radius: 5, chamfer: 3, sides: 6, angle: 90, text: 'NOTE', textH: 5, dimMode: 'auto', holeN: 6, holeD: 10, holePcd: 80, slotLen: 30, slotW: 10, slotAng: 0, rectConstrain: true, mirrorCopy: true, smooth: true };
export interface Snaps { grid: boolean; step: number; ends: boolean; mids: boolean; centres: boolean; inters: boolean; near: boolean; ortho: boolean }
export const DEFAULT_SNAPS: Snaps = { grid: true, step: 0, ends: true, mids: true, centres: true, inters: true, near: false, ortho: false };

export const TOOL_HELP: Record<Tool, string> = {
  select: 'Click to select (Shift adds). Drag on empty space for a box selection. Drag a blue handle to move a point.',
  pan: 'Drag to move the view. Mouse wheel zooms; the middle mouse button pans with any tool.',
  line: 'Click the start, then the end (or type x,y / @dx,dy / @length<angle, or just a length). Keeps going from the last point; Esc stops.',
  polyline: 'Click points. Enter or double-click finishes; click the first point to close it.',
  rect: 'Click two opposite corners (or type the second corner as @width,height).',
  circle: 'Click the centre, then a point on the circle (or type the radius).', arc: 'Click start point, a point on the arc, then the end point.',
  ellipse: 'Click the centre, the end of the long axis, then a point for the short axis.', polygon: 'Click the centre, then a corner. Number of sides is in the tool options.',
  spline: 'Click points the curve passes through. Enter finishes.', freehand: 'Press and draw with the mouse, finger or pen. The stroke is smoothed when you let go.',
  text: 'Click where the text goes (the text is in the tool options).', centreline: 'Like Line, drawn as a centre line (axis for revolving).', construction: 'Like Line, drawn as a helper line that never becomes part of a 3D profile.',
  dim: 'Click a line, circle or arc to dimension it, or two points for a distance (mode in the options). Two lines in Angle mode.',
  measure: 'Click two points to read the distance and angle (nothing is added).', move: 'Select items first. Click a base point, then the new position.', copy: 'Select items first. Click a base point, then where the copy goes.',
  rotate: 'Select items first. Click the centre of rotation; the angle is in the tool options.', mirror: 'Select items first. Click two points on the mirror line.',
  offset: 'Click a line, circle or outline, then click the side for the copy (distance in the options).', trim: 'Click the part of a line, arc or circle to cut away (between crossings).',
  extend: 'Click near the end of a line to extend it to the next item.', fillet: 'Click two lines, or click near a corner of a polyline (radius in the options).', chamfer: 'Click two lines, or a polyline corner (distance in the options).',
  holes: 'Click the centre of a hole pattern (count, diameter and PCD in the options). It stays editable in Parameters.', slot: 'Click the centre of a slot (length, width and angle in the options).',
  calibrate: 'Set scale: click two points on the picture whose real distance you know, then type that distance.',
};

interface VP { cx: number; cy: number; s: number }
interface Props {
  doc: StudioDoc; sel: string[]; setSel: (s: string[]) => void; tool: Tool; opts: ToolOpts; snaps: Snaps;
  commit: (d: StudioDoc, label: string) => void; status: (m: string, kind?: 'ok' | 'err' | 'info') => void;
  preview?: StudioDoc | null; highlight?: Set<string>; compare?: Comparison | null; compareRef?: string | null;
  fit: number; onCursor?: (p: Pt | null) => void; onCalibrate?: (p1: Pt, p2: Pt) => void; onPickDetected?: (id: string) => void; onToolDone?: () => void;
  unit: Unit;
}

const niceStep = (raw: number) => { const p = 10 ** Math.floor(Math.log10(raw)); const m = raw / p; return (m < 2 ? 2 : m < 5 ? 5 : 10) * p; };
const B = (layer: string) => ({ layer, source: 'drawn' as const });

export function StudioCanvas(p: Props) {
  const { doc, sel, tool, opts, snaps } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [vp, setVp] = useState<VP>({ cx: 100, cy: 60, s: 3 });
  const [cur, setCur] = useState<{ p: Pt; snap?: string } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [picks, setPicks] = useState<string[]>([]); // entity picks for two-item tools
  const [live, setLive] = useState<StudioDoc | null>(null); // document while dragging a handle
  const [box, setBox] = useState<[Pt, Pt] | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [typed, setTyped] = useState('');
  const drag = useRef<{ kind: 'pan' | 'box' | 'handle' | 'free'; sx: number; sy: number; vp: VP; e?: string; i?: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ d: number; vp: VP } | null>(null);
  const view = live ?? doc;
  const layer = (style?: 'construction' | 'centre') => (style === 'construction' ? doc.layers.find((l) => l.id === 'L1')?.id ?? doc.layers[0].id : doc.layers.find((l) => !l.locked && l.id === 'L0')?.id ?? doc.layers.find((l) => !l.locked)?.id ?? doc.layers[0].id);
  const lockedLayers = useMemo(() => new Set(doc.layers.filter((l) => l.locked).map((l) => l.id)), [doc.layers]);
  const visLayers = useMemo(() => new Set(doc.layers.filter((l) => l.visible).map((l) => l.id)), [doc.layers]);
  const fm = (mm: number) => fmtLen(mm, p.unit, 3);

  useEffect(() => { const el = wrap.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) })); ro.observe(el); return () => ro.disconnect(); }, []);
  // fit to the drawing
  useEffect(() => {
    const b = boxOf(doc.ents.filter((e) => visLayers.has(e.layer)));
    for (const r of doc.refs) if (r.visible) { boxAdd(b, [r.x, r.y]); boxAdd(b, [r.x + r.pxW * r.mmPerPx, r.y + r.pxH * r.mmPerPx]); }
    if (!boxOk(b)) { setVp({ cx: 100, cy: 60, s: Math.min(size.w / 260, size.h / 180) }); return; }
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    setVp({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s: Math.min((size.w * 0.85) / w, (size.h * 0.85) / h, 400) });
  }, [p.fit, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPts([]); setPicks([]); setTyped(''); setStroke(null); }, [tool]);

  const toWorld = (sx: number, sy: number): Pt => [vp.cx + (sx - size.w / 2) / vp.s, vp.cy - (sy - size.h / 2) / vp.s];
  const toScreen = (q: Pt): Pt => [size.w / 2 + (q[0] - vp.cx) * vp.s, size.h / 2 - (q[1] - vp.cy) * vp.s];
  const gridStep = snaps.step > 0 ? snaps.step : niceStep(14 / vp.s);
  const pickTol = 7 / vp.s;

  /** nearest entity under the cursor (visible, unlocked layers) */
  const pickAt = (q: Pt, filter?: (e: Ent) => boolean): Ent | null => {
    let best: Ent | null = null, bd = pickTol;
    for (const e of view.ents) { if (!visLayers.has(e.layer) || (filter && !filter(e))) continue; const d = entDist(e, q, view); if (d < bd) { bd = d; best = e; } }
    return best;
  };
  /** snapping of a raw world point */
  const snapPt = (raw: Pt, from?: Pt): { p: Pt; snap?: string } => {
    const r = 10 / vp.s; let best: { p: Pt; snap?: string } | null = null, bd = r;
    const near = view.ents.filter((e) => visLayers.has(e.layer) && e.k !== 'dim' && (() => { const b = entBox(e); return raw[0] > b.x0 - r && raw[0] < b.x1 + r && raw[1] > b.y0 - r && raw[1] < b.y1 + r; })()).slice(0, 400);
    for (const e of near) for (const s of snapPoints(e)) {
      if ((s.kind === 'end' && !snaps.ends) || (s.kind === 'mid' && !snaps.mids) || ((s.kind === 'centre' || s.kind === 'quad') && !snaps.centres)) continue;
      const d = dist(s.p, raw); if (d < bd) { bd = d; best = { p: s.p, snap: s.kind }; }
    }
    if (snaps.inters && !best) { const cand = near.filter((e) => entDist(e, raw) < r * 2).slice(0, 12); for (const e of cand) for (const x of crossings(e, cand)) { const d = dist(x, raw); if (d < bd) { bd = d; best = { p: x, snap: 'intersection' }; } } }
    if (best) return best;
    if (snaps.near) { const e = near.find((x) => entDist(x, raw) < r); const q = e ? nearestOn(e, raw) : null; if (q) return { p: q, snap: 'nearest' }; }
    let q = raw;
    if (snaps.ortho && from) { const dx = Math.abs(raw[0] - from[0]), dy = Math.abs(raw[1] - from[1]); q = dx > dy ? [raw[0], from[1]] : [from[0], raw[1]]; }
    if (snaps.grid) q = [Math.round(q[0] / gridStep) * gridStep, Math.round(q[1] / gridStep) * gridStep];
    if (snaps.ortho && from) { const dx = Math.abs(q[0] - from[0]), dy = Math.abs(q[1] - from[1]); q = dx > dy ? [q[0], from[1]] : [from[0], q[1]]; }
    return { p: q };
  };

  const add2 = (ents: Ent[], label: string, constraints: Constraint[] = []) => { p.commit({ ...doc, ents: [...doc.ents, ...ents], constraints: [...doc.constraints, ...constraints] }, label); };
  const applyEdit = (r: EditResult, label: string) => {
    if (!r.ok) { p.status(r.error, 'err'); return false; }
    const rm = new Set(r.remove);
    const ents = [...doc.ents.filter((e) => !rm.has(e.id)), ...r.add];
    const keep = (c: Constraint) => !JSON.stringify(c).split('"').some((s) => rm.has(s));
    p.commit({ ...doc, ents: ents.filter((e) => !(e.k === 'dim' && JSON.stringify(e.d).split('"').some((s) => rm.has(s)))), constraints: doc.constraints.filter(keep), bodies: doc.bodies.map((b) => (rm.has(b.profile) && r.add[0] ? { ...b, profile: r.add[0].id } : b)) }, label);
    if (r.note) p.status(r.note, 'info');
    return true;
  };
  const selEnts = () => doc.ents.filter((e) => sel.includes(e.id) && !lockedLayers.has(e.layer));
  const transformSel = (m: Parameters<typeof transformEnt>[1], label: string, copy: boolean) => {
    const s = selEnts().filter((e) => e.k !== 'dim'); if (!s.length) { p.status('Select the items first (Select tool).', 'err'); return; }
    if (copy) { const c = s.map((e) => ({ ...transformEnt(e, m), id: uid(), feature: undefined, source: e.source === 'feature' || e.source === 'library' ? ('drawn' as const) : e.source })); add2(c, label); p.setSel(c.map((e) => e.id)); }
    else {
      const ids = new Set(s.map((e) => e.id));
      // moving all items of a feature moves the feature itself, so it stays editable
      let next: StudioDoc = { ...doc, ents: doc.ents.map((e) => (ids.has(e.id) && !e.feature ? transformEnt(e, m) : e)) };
      for (const f of doc.features) { const mine = doc.ents.filter((e) => e.feature === f.id); if (!mine.length || !mine.some((e) => ids.has(e.id))) continue; const T = (q: Pt) => [m[0] * q[0] + m[1] * q[1] + m[4], m[2] * q[0] + m[3] * q[1] + m[5]] as Pt; const nf = f.t === 'gridHoles' ? { ...f, ...(() => { const q = T([f.x0, f.y0]); return { x0: q[0], y0: q[1] }; })() } : f.t === 'library' ? { ...f, at: T(f.at) } : { ...f, c: T(f.c) }; next = regenerate(next, nf as typeof f).doc; }
      const s2 = solve(next); p.commit(s2.ok ? s2.doc : next, label); if (!s2.ok) p.status(`Moved, but the constraints could not all be kept: ${s2.error}`, 'info');
    }
  };

  /** a point was given (click or typed) */
  const givePoint = (q: Pt) => {
    const all = [...pts, q];
    const L = layer();
    switch (tool) {
      case 'line': case 'centreline': case 'construction':
        if (all.length === 2) { if (dist(all[0], all[1]) < 1e-9) return; const style = tool === 'centreline' ? 'centre' : tool === 'construction' ? 'construction' : undefined; add2([{ ...B(layer(style === 'construction' ? 'construction' : undefined)), id: uid(), k: 'line', a: all[0], b: all[1], ...(style ? { style } : {}) }], tool === 'line' ? 'Line' : tool === 'centreline' ? 'Centre line' : 'Construction line'); setPts([q]); } else setPts(all); return;
      case 'polyline': case 'spline':
        if (all.length > 2 && dist(q, all[0]) < pickTol) { finishPoly(all.slice(0, -1), true); return; }
        setPts(all); return;
      case 'rect':
        if (all.length === 2) {
          const [a, b] = all; if (Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9) { p.status('The rectangle has no width or height.', 'err'); return; }
          const id = uid(); const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
          const cons: Constraint[] = opts.rectConstrain ? [0, 1, 2, 3].map((s) => ({ id: uid('k'), t: s % 2 ? 'vertical' : 'horizontal', l: { e: id, seg: s } }) as Constraint) : [];
          add2([{ ...B(L), id, k: 'poly', closed: true, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }], 'Rectangle', cons); setPts([]);
        } else setPts(all); return;
      case 'circle': if (all.length === 2) { const r = dist(all[0], all[1]); if (r > 1e-9) add2([{ ...B(L), id: uid(), k: 'circle', c: all[0], r }], 'Circle'); setPts([]); } else setPts(all); return;
      case 'arc':
        if (all.length === 3) {
          const c = circumcentre(all[0], all[1], all[2]);
          if (!c || !Number.isFinite(c[0])) { p.status('The three points are in a straight line.', 'err'); setPts([]); return; }
          const r = dist(c, all[0]); let a0 = angOf(c, all[0]), a1 = angOf(c, all[2]); const am = angOf(c, all[1]);
          if (!(sweepOf(a0, am) < sweepOf(a0, a1))) [a0, a1] = [a1, a0];
          add2([{ ...B(L), id: uid(), k: 'arc', c, r, a0, a1 }], 'Arc'); setPts([]);
        } else setPts(all); return;
      case 'ellipse':
        if (all.length === 3) { const [c, a, b] = all; const rx = dist(c, a), rot = angOf(c, a); const u = norm(sub(a, c)); const ry = Math.abs((b[0] - c[0]) * -u[1] + (b[1] - c[1]) * u[0]); if (rx > 1e-9 && ry > 1e-9) add2([{ ...B(L), id: uid(), k: 'ellipse', c, rx, ry, rot }], 'Ellipse'); setPts([]); } else setPts(all); return;
      case 'polygon': if (all.length === 2) { const r = dist(all[0], all[1]); if (r > 1e-9) { const f = { id: uid('f'), t: 'polygon' as const, c: all[0], n: Math.max(3, Math.min(200, Math.round(opts.sides))), r, ang: (angOf(all[0], all[1]) * 180) / Math.PI }; p.commit(regenerate(doc, f).doc, 'Polygon'); } setPts([]); } else setPts(all); return;
      case 'text': if (opts.text.trim()) add2([{ ...B(doc.layers.find((l) => l.id === 'L3')?.id ?? L), id: uid(), k: 'text', p: q, s: opts.text.trim(), h: Math.max(0.5, opts.textH) }], 'Text'); return;
      case 'measure': if (all.length === 2) { const d = dist(all[0], all[1]); p.status(`Distance ${fm(d)} ${p.unit}   ΔX ${fm(all[1][0] - all[0][0])}   ΔY ${fm(all[1][1] - all[0][1])}   angle ${((angOf(all[0], all[1]) * 180) / Math.PI).toFixed(3)}°`, 'info'); setPts([]); } else setPts(all); return;
      case 'move': case 'copy': if (all.length === 2) { transformSel(translateAff(all[1][0] - all[0][0], all[1][1] - all[0][1]), tool === 'copy' ? 'Copy' : 'Move', tool === 'copy'); setPts([]); } else setPts(all); return;
      case 'rotate': transformSel(rotateAff(q, opts.angle), `Rotate ${opts.angle}°`, false); return;
      case 'mirror': if (all.length === 2) { if (dist(all[0], all[1]) > 1e-9) transformSel(mirrorAff(all[0], all[1]), 'Mirror', opts.mirrorCopy); setPts([]); } else setPts(all); return;
      case 'holes': { const f = { id: uid('f'), t: 'holePattern' as const, c: q, pcd: opts.holePcd, n: Math.round(opts.holeN), d: opts.holeD, start: 0 }; const r = regenerate(doc, f); if (r.error) p.status(r.error, 'err'); else p.commit(r.doc, `${f.n} holes`); return; }
      case 'slot': { const f = { id: uid('f'), t: 'slot' as const, c: q, len: opts.slotLen, w: opts.slotW, ang: opts.slotAng }; const r = regenerate(doc, f); if (r.error) p.status(r.error, 'err'); else p.commit(r.doc, 'Slot'); return; }
      case 'calibrate': if (all.length === 2) { p.onCalibrate?.(all[0], all[1]); setPts([]); } else setPts(all); return;
      case 'dim': if (all.length === 2) { dimTwoPoints(all[0], all[1]); setPts([]); } else setPts(all); return;
      default: return;
    }
  };
  const finishPoly = (list: Pt[], closed: boolean) => {
    const clean = list.filter((q, i) => i === 0 || dist(q, list[i - 1]) > 1e-9);
    if (clean.length < 2 || (closed && clean.length < 3)) { setPts([]); return; }
    add2([{ ...B(layer()), id: uid(), ...(tool === 'spline' ? { k: 'spline' as const, pts: clean, closed } : { k: 'poly' as const, pts: clean, closed }) } as Ent], tool === 'spline' ? 'Spline' : 'Polyline');
    setPts([]);
  };
  /** point references for a dimension between two clicked points (they must be points of existing items) */
  const refAt = (q: Pt) => { for (const e of view.ents) { if (e.k === 'dim' || e.k === 'text') continue; const h = handles(e); const i = h.findIndex((x) => dist(x, q) < 1e-6); if (i >= 0) return { e: e.id, i }; } return null; };
  const dimTwoPoints = (a: Pt, b: Pt) => {
    const r1 = refAt(a), r2 = refAt(b);
    if (!r1 || !r2) { p.status('Snap both points onto end points or centres of existing items (the dimension is tied to them).', 'err'); return; }
    const kind = opts.dimMode === 'h' ? 'hdist' : opts.dimMode === 'v' ? 'vdist' : 'dist';
    add2([{ ...B(doc.layers.find((l) => l.id === 'L2')?.id ?? layer()), id: uid('d'), k: 'dim', d: { kind, p1: r1, p2: r2, off: 10 / vp.s * 3 } }], 'Dimension');
  };
  const clickEntityTool = (q: Pt) => {
    const nonDim = (e: Ent) => e.k !== 'dim' && e.k !== 'text' && !lockedLayers.has(e.layer);
    if (tool === 'dim') {
      if (opts.dimMode === 'angle') {
        const e = pickAt(q, (x) => x.k === 'line' || x.k === 'poly'); if (!e) return false;
        const lref = e.k === 'poly' ? { e: e.id, seg: nearestSeg(e, q) } : { e: e.id };
        if (!picks.length) { setPicks([JSON.stringify(lref)]); p.status('Now click the second line.', 'info'); return true; }
        add2([{ ...B(doc.layers.find((l) => l.id === 'L2')?.id ?? layer()), id: uid('d'), k: 'dim', d: { kind: 'angle', l1: JSON.parse(picks[0]), l2: lref, rad: 25 / vp.s } }], 'Angle dimension'); setPicks([]); return true;
      }
      if (pts.length) return false;
      const e = pickAt(q, (x) => x.k === 'line' || x.k === 'circle' || x.k === 'arc' || x.k === 'poly');
      if (!e) return false;
      const DL = doc.layers.find((l) => l.id === 'L2')?.id ?? layer();
      if (e.k === 'circle' || e.k === 'arc') add2([{ ...B(DL), id: uid('d'), k: 'dim', d: { kind: e.k === 'circle' ? 'diameter' : 'radius', e: e.id, ang: angOf(e.c, q) } }], 'Dimension');
      else add2([{ ...B(DL), id: uid('d'), k: 'dim', d: { kind: 'length', l: e.k === 'poly' ? { e: e.id, seg: nearestSeg(e, q) } : { e: e.id }, off: 24 / vp.s } }], 'Dimension');
      return true;
    }
    if (tool === 'offset') {
      if (!picks.length) { const e = pickAt(q, nonDim); if (!e) { p.status('Click a line, circle or outline to offset.', 'err'); return true; } setPicks([e.id]); p.status('Now click the side where the copy should go.', 'info'); return true; }
      const e = findEnt(doc, picks[0]); setPicks([]); if (e) applyEdit(offsetEnt(e, opts.dist, q), `Offset ${opts.dist}`); return true;
    }
    if (tool === 'trim') { const e = pickAt(q, nonDim); if (!e) return true; applyEdit(trimEnt(e, q, doc.ents.filter((x) => x.id !== e.id && visLayers.has(x.layer))), 'Trim'); return true; }
    if (tool === 'extend') { const e = pickAt(q, (x) => x.k === 'line' && nonDim(x)); if (!e || e.k !== 'line') { p.status('Click near the end of a line.', 'err'); return true; } applyEdit(extendLine(e, q, doc.ents.filter((x) => visLayers.has(x.layer))), 'Extend'); return true; }
    if (tool === 'fillet' || tool === 'chamfer') {
      const e = pickAt(q, (x) => (x.k === 'line' || x.k === 'poly') && nonDim(x)); if (!e) return true;
      if (e.k === 'poly') { let bi = 0, bd = Infinity; e.pts.forEach((v, i) => { const d = dist(v, q); if (d < bd) { bd = d; bi = i; } }); applyEdit(cornerPoly(e, bi, tool === 'fillet' ? opts.radius : opts.chamfer, tool), tool === 'fillet' ? `Fillet R${opts.radius}` : `Chamfer ${opts.chamfer}`); setPicks([]); return true; }
      if (!picks.length) { setPicks([e.id]); p.status('Now click the second line.', 'info'); return true; }
      const a = findEnt(doc, picks[0]); setPicks([]);
      if (a?.k === 'line' && e.k === 'line' && a.id !== e.id) applyEdit(tool === 'fillet' ? filletLines(a, e, opts.radius) : chamferLines(a, e, opts.chamfer), tool === 'fillet' ? `Fillet R${opts.radius}` : `Chamfer ${opts.chamfer}`);
      return true;
    }
    return false;
  };
  const nearestSeg = (e: EntOf<'poly'>, q: Pt) => { let bi = 0, bd = Infinity; const n = e.pts.length; for (let i = 0; i < (e.closed ? n : n - 1); i++) { const a = e.pts[i], b = e.pts[(i + 1) % n]; const d = entDist({ ...e, k: 'line', a, b } as Ent, q); if (d < bd) { bd = d; bi = i; } } return bi; };

  /* ---------- typed input: "x,y", "@dx,dy", "@len<ang", "len" (along the cursor direction), radius for circles ---------- */
  const submitTyped = () => {
    const t = typed.trim().replace(/\s+/g, ''); if (!t) return;
    const last = pts[pts.length - 1];
    const k = p.unit === 'mm' ? 1 : p.unit === 'cm' ? 10 : p.unit === 'm' ? 1000 : 25.4;
    let q: Pt | null = null;
    let m = t.match(/^@(-?[\d.]+)<(-?[\d.]+)$/);
    if (m && last) q = polarPt(last, Number(m[1]) * k, (Number(m[2]) * Math.PI) / 180);
    else if ((m = t.match(/^@(-?[\d.]+)[,;](-?[\d.]+)$/)) && last) q = [last[0] + Number(m[1]) * k, last[1] + Number(m[2]) * k];
    else if ((m = t.match(/^(-?[\d.]+)[,;](-?[\d.]+)$/))) q = [Number(m[1]) * k, Number(m[2]) * k];
    else if ((m = t.match(/^(-?[\d.]+)$/)) && last) { const dir = cur ? norm(sub(cur.p, last)) : [1, 0] as Pt; q = add(last, mul(dir[0] || dir[1] ? dir : [1, 0], Number(m[1]) * k)); }
    if (!q || !q.every(Number.isFinite)) { p.status('Type x,y (absolute), @dx,dy (relative), @length<angle, or one length along the cursor direction.', 'err'); return; }
    setTyped(''); givePoint(q);
  };

  /* ---------- pointer handling ---------- */
  const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = wrap.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDown = (ev: PtrEv) => {
    const [sx, sy] = local(ev);
    pointers.current.set(ev.pointerId, [sx, sy]);
    (ev.target as Element | null)?.setPointerCapture?.(ev.pointerId);
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vp }; drag.current = null; return; }
    const raw = toWorld(sx, sy);
    if (ev.button === 1 || ev.button === 2 && tool === 'select' || tool === 'pan') { drag.current = { kind: 'pan', sx, sy, vp, moved: false }; return; }
    if (ev.button === 2) { // right click ends the current tool
      if ((tool === 'polyline' || tool === 'spline') && pts.length >= 2) finishPoly(pts, false); else { setPts([]); setPicks([]); }
      return;
    }
    if (tool === 'freehand') { drag.current = { kind: 'free', sx, sy, vp, moved: false }; setStroke([raw]); return; }
    if (tool === 'select') {
      // grab a handle of a selected item
      for (const id of sel) { const e = findEnt(doc, id); if (!e || lockedLayers.has(e.layer) || e.feature) continue; const h = handles(e); const i = h.findIndex((x) => dist(x, raw) < pickTol); if (i >= 0) { drag.current = { kind: 'handle', sx, sy, vp, e: id, i, moved: false }; return; } }
      drag.current = { kind: 'box', sx, sy, vp, moved: false };
      return;
    }
    if (clickEntityTool(raw)) return;
    givePoint(snapPt(raw, pts[pts.length - 1]).p);
  };
  const onMove = (ev: PtrEv) => {
    const [sx, sy] = local(ev);
    if (pointers.current.has(ev.pointerId)) pointers.current.set(ev.pointerId, [sx, sy]);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      setVp({ ...pinch.current.vp, s: Math.max(1e-3, Math.min(5000, (pinch.current.vp.s * d) / Math.max(1, pinch.current.d))) }); return;
    }
    const raw = toWorld(sx, sy), dr = drag.current;
    if (dr) {
      if (Math.hypot(sx - dr.sx, sy - dr.sy) > 3) dr.moved = true;
      if (dr.kind === 'pan') { setVp({ ...dr.vp, cx: dr.vp.cx - (sx - dr.sx) / dr.vp.s, cy: dr.vp.cy + (sy - dr.sy) / dr.vp.s }); return; }
      if (dr.kind === 'box') { setBox([toWorld(dr.sx, dr.sy), raw]); return; }
      if (dr.kind === 'free') { setStroke((s) => (s && dist(s[s.length - 1], raw) > 1.5 / vp.s ? [...s, raw] : s)); return; }
      if (dr.kind === 'handle' && dr.e !== undefined && dr.i !== undefined) { const q = snapPt(raw).p; const e = findEnt(doc, dr.e)!; setLive({ ...doc, ents: doc.ents.map((x) => (x.id === e.id ? setHandle(e, dr.i!, q) : x)) }); setCur({ p: q }); return; }
    }
    const s = tool === 'select' || tool === 'pan' ? { p: raw } : snapPt(raw, pts[pts.length - 1]);
    setCur(s); p.onCursor?.(s.p);
  };
  const onUp = (ev: PtrEv) => {
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dr = drag.current; drag.current = null;
    if (!dr) return;
    const [sx, sy] = local(ev); const raw = toWorld(sx, sy);
    if (dr.kind === 'box') {
      setBox(null);
      if (!dr.moved) { const e = pickAt(raw); if (e) p.setSel(ev.shiftKey ? (sel.includes(e.id) ? sel.filter((x) => x !== e.id) : [...sel, e.id]) : [e.id]); else if (!ev.shiftKey) p.setSel([]);
        // detected dimension markers on the reference
        for (const r of doc.refs) if (r.visible) for (const t of r.detected) { const m = toMm(r, [t.px, t.py]); if (dist(m, raw) < pickTol * 1.5) p.onPickDetected?.(t.id); }
        return; }
      const a = toWorld(dr.sx, dr.sy), x0 = Math.min(a[0], raw[0]), x1 = Math.max(a[0], raw[0]), y0 = Math.min(a[1], raw[1]), y1 = Math.max(a[1], raw[1]);
      const inside = view.ents.filter((e) => { if (!visLayers.has(e.layer)) return false; if (e.k === 'dim') { const g = dimGeometry(view, e); return !!g && [g.a, g.b].every((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1); } const b = entBox(e); return b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1; }).map((e) => e.id);
      p.setSel(ev.shiftKey ? [...new Set([...sel, ...inside])] : inside);
      return;
    }
    if (dr.kind === 'free') {
      const s = stroke ?? []; setStroke(null);
      if (s.length < 2) return;
      const simp = simplifyStroke(s, 1.2 / vp.s);
      const closed = simp.length > 3 && dist(simp[0], simp[simp.length - 1]) < 12 / vp.s;
      const ptsF = closed ? simp.slice(0, -1) : simp;
      add2([{ ...B(layer()), id: uid(), ...(opts.smooth && ptsF.length >= 3 ? { k: 'spline' as const, pts: ptsF, closed } : { k: 'poly' as const, pts: ptsF, closed }) } as Ent], 'Freehand');
      return;
    }
    if (dr.kind === 'handle') {
      const ld = live; setLive(null);
      if (ld && dr.moved) { const s = solve(ld, { fixed: [] }); p.commit(s.ok ? s.doc : ld, 'Move point'); if (!s.ok) p.status(`Point moved, but constraints conflict: ${s.error}`, 'info'); }
    }
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault?.();
    const [sx, sy] = local(ev); const w = toWorld(sx, sy); const k = Math.exp(-ev.deltaY * 0.0015);
    const s = Math.max(1e-3, Math.min(5000, vp.s * k));
    setVp({ s, cx: w[0] - (sx - size.w / 2) / s, cy: w[1] + (sy - size.h / 2) / s });
  };
  useEffect(() => { const el = wrap.current; if (!el) return; const h = (e: WheelEvent) => onWheel(e); el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h); });
  // keyboard: Enter / Esc / Delete while the canvas has focus is handled by the page; Enter finishes polylines here
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.classList.contains('cmdline')) return;
      if (e.key === 'Escape') { setPts([]); setPicks([]); setStroke(null); }
      if (e.key === 'Enter' && (tool === 'polyline' || tool === 'spline') && pts.length >= 2 && !typed) { finishPoly(pts, false); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  /* ---------- drawing ---------- */
  const px = 1 / vp.s; // one screen pixel in mm
  const ents = view.ents.filter((e) => visLayers.has(e.layer));
  const colorOf = (e: Ent) => (sel.includes(e.id) ? '#ea580c' : p.highlight?.has(e.id) ? '#2563eb' : (e.source === 'traced' || e.source === 'ai') && !e.confirmed ? '#d97706' : e.style === 'centre' ? '#b91c1c' : e.style === 'construction' ? '#64748b' : doc.layers.find((l) => l.id === e.layer)?.color ?? '#0f172a');
  const dash = (e: Ent) => (e.style === 'centre' ? `${12 * px} ${3 * px} ${2 * px} ${3 * px}` : e.style === 'construction' ? `${6 * px} ${4 * px}` : (e.source === 'traced' || e.source === 'ai') && !e.confirmed ? `${5 * px} ${3 * px}` : undefined);
  const shape = (e: Ent, stroke: string, w: number, da?: string, key?: string) => {
    const k0 = key ?? e.id;
    const common = { fill: 'none', stroke, strokeWidth: w * px, strokeDasharray: da, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
    if (e.k === 'line') return <line key={k0} {...common} x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} />;
    if (e.k === 'circle') return <circle key={k0} {...common} cx={e.c[0]} cy={e.c[1]} r={e.r} />;
    if (e.k === 'ellipse') return <ellipse key={k0} {...common} cx={e.c[0]} cy={e.c[1]} rx={e.rx} ry={e.ry} transform={`rotate(${(e.rot * 180) / Math.PI} ${e.c[0]} ${e.c[1]})`} />;
    if (e.k === 'text') return <g key={k0}><text x={0} y={0} transform={`translate(${e.p[0]} ${e.p[1]}) scale(1 -1)`} fontSize={e.h} fill={stroke} style={{ userSelect: 'none' }}>{e.s}</text>{e.arrowTo && <line {...common} x1={e.p[0]} y1={e.p[1]} x2={e.arrowTo[0]} y2={e.arrowTo[1]} />}</g>;
    if (e.k === 'dim') return dimShape(e, stroke, k0);
    const pl = e.k === 'poly' ? polyPts(e, Math.max(0.002, 0.3 * px)) : e.k === 'spline' ? splinePts(e.pts, e.closed, 24) : tess(e, Math.max(0.002, 0.3 * px))[0];
    return <polyline key={k0} {...common} points={pl.map((q) => `${q[0]},${q[1]}`).join(' ')} />;
  };
  const dimShape = (e: EntOf<'dim'>, stroke: string, key: string) => {
    const g = dimGeometry(view, e); if (!g) return null;
    const label = dimLabel(view, e, fm) + (e.drive !== undefined ? '' : '');
    const arrow = (tip: Pt, dir: Pt) => { const n: Pt = [-dir[1], dir[0]], L = 9 * px, W = 3 * px; return <polygon key={`${tip[0]},${tip[1]}`} points={[tip, add(add(tip, mul(dir, L)), mul(n, W)), add(add(tip, mul(dir, L)), mul(n, -W))].map((q) => q.join(',')).join(' ')} fill={stroke} />; };
    const u = norm(sub(g.b, g.a));
    const fs = 12 * px;
    const isLin = e.d.kind !== 'radius' && e.d.kind !== 'diameter' && e.d.kind !== 'angle';
    return (
      <g key={key}>
        {isLin && <line x1={g.p[0]} y1={g.p[1]} x2={g.a[0]} y2={g.a[1]} stroke={stroke} strokeWidth={0.8 * px} />}
        {isLin && <line x1={g.q[0]} y1={g.q[1]} x2={g.b[0]} y2={g.b[1]} stroke={stroke} strokeWidth={0.8 * px} />}
        <line x1={g.a[0]} y1={g.a[1]} x2={g.b[0]} y2={g.b[1]} stroke={stroke} strokeWidth={0.9 * px} />
        {e.d.kind !== 'angle' && arrow(g.b, mul(u, -1))}{(isLin || e.d.kind === 'diameter') && arrow(g.a, u)}
        <g transform={`translate(${g.textAt[0]} ${g.textAt[1]}) scale(1 -1)`}>
          <rect x={-label.length * fs * 0.3 - 2 * px} y={-fs * 0.95} width={label.length * fs * 0.6 + 4 * px} height={fs * 1.2} fill="#ffffffd9" />
          <text x={0} y={0} textAnchor="middle" fontSize={fs} fill={stroke} fontWeight={e.drive !== undefined ? 700 : 400} style={{ userSelect: 'none' }}>{label}</text>
        </g>
      </g>
    );
  };

  // grid lines in view
  const grid = useMemo(() => {
    if (!snaps.grid) return null;
    const a = toWorld(0, size.h), b = toWorld(size.w, 0);
    const step = gridStep, lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const nx = Math.ceil((b[0] - a[0]) / step), ny = Math.ceil((b[1] - a[1]) / step);
    if (nx > 400 || ny > 400) return null;
    for (let i = Math.floor(a[0] / step); i * step <= b[0]; i++) lines.push({ x1: i * step, y1: a[1], x2: i * step, y2: b[1], major: i % 5 === 0 });
    for (let j = Math.floor(a[1] / step); j * step <= b[1]; j++) lines.push({ x1: a[0], y1: j * step, x2: b[0], y2: j * step, major: j % 5 === 0 });
    return lines;
  }, [vp, size, snaps.grid, gridStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // rubber band of the current tool
  const rubber = (() => {
    const c = cur?.p; if (!c) return null;
    const last = pts[pts.length - 1];
    const st = { fill: 'none' as const, stroke: '#2563eb', strokeWidth: 1 * px, strokeDasharray: `${4 * px} ${3 * px}` };
    if (!last) return null;
    switch (tool) {
      case 'line': case 'centreline': case 'construction': case 'measure': case 'move': case 'copy': case 'mirror': case 'calibrate': case 'dim': return <line {...st} x1={last[0]} y1={last[1]} x2={c[0]} y2={c[1]} />;
      case 'polyline': return <polyline {...st} points={[...pts, c].map((q) => q.join(',')).join(' ')} />;
      case 'spline': return <polyline {...st} points={splinePts([...pts, c], false, 12).map((q) => q.join(',')).join(' ')} />;
      case 'rect': return <rect {...st} x={Math.min(last[0], c[0])} y={Math.min(last[1], c[1])} width={Math.abs(c[0] - last[0])} height={Math.abs(c[1] - last[1])} />;
      case 'circle': case 'polygon': return <circle {...st} cx={pts[0][0]} cy={pts[0][1]} r={dist(pts[0], c)} />;
      case 'arc': { if (pts.length < 2) return <line {...st} x1={last[0]} y1={last[1]} x2={c[0]} y2={c[1]} />; const cc = circumcentre(pts[0], pts[1], c); return cc && Number.isFinite(cc[0]) ? <circle {...st} cx={cc[0]} cy={cc[1]} r={dist(cc, c)} /> : null; }
      case 'ellipse': { if (pts.length < 2) return <line {...st} x1={last[0]} y1={last[1]} x2={c[0]} y2={c[1]} />; const [cc, a] = pts; const rx = dist(cc, a), rot = angOf(cc, a), u = norm(sub(a, cc)), ry = Math.abs((c[0] - cc[0]) * -u[1] + (c[1] - cc[1]) * u[0]); return <polyline {...st} points={Array.from({ length: 65 }, (_, i) => ellipsePt({ c: cc, rx, ry: Math.max(ry, 1e-6), rot }, (i / 64) * Math.PI * 2).join(',')).join(' ')} />; }
      default: return null;
    }
  })();
  const status = (() => {
    const c = cur?.p, last = pts[pts.length - 1];
    if (!c) return '';
    const base = `X ${fm(c[0])}  Y ${fm(c[1])}`;
    return last ? `${base}   length ${fm(dist(last, c))}  angle ${((angOf(last, c) * 180) / Math.PI).toFixed(2)}°` : base;
  })();
  const pv = p.preview;
  const changed = useMemo(() => { if (!pv) return null; const old = new Map(doc.ents.map((e) => [e.id, JSON.stringify(e)])); return { added: pv.ents.filter((e) => old.get(e.id) !== JSON.stringify(e)), removed: doc.ents.filter((e) => !pv.ents.some((x) => x.id === e.id)) }; }, [pv, doc.ents]);
  const cmpRef = p.compare && p.compareRef ? doc.refs.find((r) => r.id === p.compareRef) : null;
  const scoreOf = useMemo(() => new Map((p.compare?.scores ?? []).map((s) => [s.id, s.score])), [p.compare]);

  return (
    <div className="st-canvas" ref={wrap} style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { setCur(null); p.onCursor?.(null); }}
      onDoubleClick={() => { if ((tool === 'polyline' || tool === 'spline') && pts.length >= 2) finishPoly(pts.slice(0, -1).length >= 2 ? pts.slice(0, -1) : pts, false); }}
      onContextMenu={(e: { preventDefault(): void }) => e.preventDefault()}>
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label="Design Studio drawing area">
        <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${vp.s} ${-vp.s}) translate(${-vp.cx} ${-vp.cy})`}>
          {grid?.map((l, i) => <line key={`g${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.major ? '#d6dee8' : '#edf1f6'} strokeWidth={px} />)}
          <line x1={-1e5} y1={0} x2={1e5} y2={0} stroke="#f2b8b8" strokeWidth={px} /><line x1={0} y1={-1e5} x2={0} y2={1e5} stroke="#b8d4f2" strokeWidth={px} />
          {doc.refs.filter((r) => r.visible && r.dataUrl).map((r) => { const w = r.pxW * r.mmPerPx, h = r.pxH * r.mmPerPx; return <image key={r.id} href={r.dataUrl} x={0} y={0} width={w} height={h} opacity={r.opacity} transform={`translate(${r.x} ${r.y + h}) scale(1 -1)`} preserveAspectRatio="none" />; })}
          {doc.refs.filter((r) => r.visible).flatMap((r) => r.detected.filter((t) => t.status !== 'rejected').map((t) => { const m = toMm(r, [t.px, t.py]); return <g key={t.id}><circle cx={m[0]} cy={m[1]} r={5 * px} fill={t.status === 'confirmed' ? '#16a34a' : '#f59e0b'} opacity={0.85} /><g transform={`translate(${m[0] + 7 * px} ${m[1]}) scale(1 -1)`}><text fontSize={11 * px} fill="#92400e">{t.text}</text></g></g>; }))}
          {ents.map((e) => shape(e, cmpRef && scoreOf.has(e.id) && (scoreOf.get(e.id) ?? 1) < 0.6 ? '#dc2626' : colorOf(e), sel.includes(e.id) ? 2.2 : e.k === 'dim' ? 1 : 1.5, dash(e)))}
          {cmpRef && p.compare?.uncovered.map((u, i) => { const m = toMm(cmpRef, u.p); return <circle key={`u${i}`} cx={m[0]} cy={m[1]} r={Math.max(6 * px, Math.sqrt(u.n) * cmpRef.mmPerPx)} fill="#dc262633" stroke="#dc2626" strokeWidth={px} />; })}
          {changed?.removed.map((e) => shape(e, '#dc2626', 2, `${3 * px} ${3 * px}`, `rm${e.id}`))}
          {changed?.added.map((e) => shape(e, '#16a34a', 2.4, undefined, `pv${e.id}`))}
          {sel.flatMap((id) => { const e = findEnt(view, id); if (!e || e.feature) return []; return handles(e).map((h, i) => <rect key={`${id}h${i}`} x={h[0] - 4 * px} y={h[1] - 4 * px} width={8 * px} height={8 * px} fill="#fff" stroke="#2563eb" strokeWidth={1.4 * px} />); })}
          {pts.map((q, i) => <circle key={`p${i}`} cx={q[0]} cy={q[1]} r={3 * px} fill="#2563eb" />)}
          {rubber}
          {stroke && <polyline points={stroke.map((q) => q.join(',')).join(' ')} fill="none" stroke="#2563eb" strokeWidth={1.6 * px} />}
          {box && <rect x={Math.min(box[0][0], box[1][0])} y={Math.min(box[0][1], box[1][1])} width={Math.abs(box[1][0] - box[0][0])} height={Math.abs(box[1][1] - box[0][1])} fill="#2563eb14" stroke="#2563eb" strokeWidth={px} strokeDasharray={`${4 * px} ${2 * px}`} />}
          {cur?.snap && <g><rect x={cur.p[0] - 5 * px} y={cur.p[1] - 5 * px} width={10 * px} height={10 * px} fill="none" stroke="#16a34a" strokeWidth={1.6 * px} /><g transform={`translate(${cur.p[0] + 8 * px} ${cur.p[1] + 8 * px}) scale(1 -1)`}><text fontSize={10 * px} fill="#15803d">{cur.snap}</text></g></g>}
        </g>
      </svg>
      <div className="st-hud">
        <span>{status}</span>
        {tool !== 'select' && tool !== 'pan' && <input className="cmdline" value={typed} placeholder="type x,y  @dx,dy  @len<angle  or a length, then Enter" onChange={(e: { target: { value: string } }) => setTyped(e.target.value)} onKeyDown={(e: KeyEv) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } if (e.key === 'Escape') { setTyped(''); setPts([]); } }} onPointerDown={(e: PtrEv) => e.stopPropagation()} aria-label="Typed coordinates" />}
        <span className="muted">grid {fm(gridStep)} {p.unit} · zoom {vp.s >= 1 ? vp.s.toFixed(1) : vp.s.toFixed(3)} px/mm</span>
      </div>
    </div>
  );
}
export { mid };
