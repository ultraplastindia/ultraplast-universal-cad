import type { Pt } from '../core/types.ts';

export type Layer = 'outline' | 'hidden' | 'centre' | 'dim' | 'text' | 'hatch' | 'border';
export type Ent =
  | { t: 'line'; a: Pt; b: Pt; layer: Layer }
  | { t: 'circle'; c: Pt; r: number; layer: Layer }
  | { t: 'poly'; pts: Pt[]; closed: boolean; layer: Layer }
  | { t: 'text'; p: Pt; s: string; h: number; layer: Layer; anchor?: 'l' | 'c' | 'r'; rot?: number; edit?: { key: string; value: number } };
/** Model-space entities. `dim` and `hatch` are expanded at sheet scale by composeSheet. */
export type ModelEnt =
  | Ent
  | { t: 'dim'; a: Pt; b: Pt; off: number; text: string; edit?: { key: string; value: number } }
  | { t: 'hatch'; x0: number; y0: number; x1: number; y1: number };
export interface DrawView { name: string; ents: ModelEnt[] }

export interface SheetMeta {
  company: string; title: string; partId: string; drawingNo: string; revision: string;
  date: string; material: string; units: string; notes: string[];
}
export interface Sheet {
  ents: Ent[]; scale: number; scaleLabel: string;
  logoRect: { x: number; y: number; w: number; h: number };
  w: number; h: number;
}

export const SHEET = { w: 420, h: 297 };
const SCALES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
const AREA = { x0: 18, x1: 402, y0: 66, y1: 282 };
const MARGIN = 24;
const MARGIN_BOTTOM = 36;
const MARGIN_TOP = 18;

export const scaleLabel = (s: number): string => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

export function bbox(ents: ModelEnt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Pt) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
  for (const e of ents) {
    if (e.t === 'line' || e.t === 'dim') { add(e.a); add(e.b); }
    else if (e.t === 'circle') { add([e.c[0] - e.r, e.c[1] - e.r]); add([e.c[0] + e.r, e.c[1] + e.r]); }
    else if (e.t === 'poly') e.pts.forEach(add);
    else if (e.t === 'hatch') { add([e.x0, e.y0]); add([e.x1, e.y1]); }
  }
  return [x0, y0, x1, y1];
}

function expandDim(a: Pt, b: Pt, off: number, text: string, edit?: { key: string; value: number }): Ent[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const d: Pt = [dx / L, dy / L], n: Pt = [-d[1], d[0]], sg = off >= 0 ? 1 : -1;
  const A: Pt = [a[0] + n[0] * off, a[1] + n[1] * off], B: Pt = [b[0] + n[0] * off, b[1] + n[1] * off];
  const ext = (p: Pt, P: Pt): Ent => ({ t: 'line', a: [p[0] + n[0] * sg * 1.5, p[1] + n[1] * sg * 1.5], b: [P[0] + n[0] * sg * 2, P[1] + n[1] * sg * 2], layer: 'dim' });
  const arrow = (tip: Pt, dir: number): Ent => {
    const base: Pt = [tip[0] + d[0] * 2.8 * dir, tip[1] + d[1] * 2.8 * dir];
    return { t: 'poly', closed: true, layer: 'dim', pts: [tip, [base[0] + n[0] * 0.9, base[1] + n[1] * 0.9], [base[0] - n[0] * 0.9, base[1] - n[1] * 0.9]] };
  };
  const h = 3.2, mid: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const out: Ent[] = [ext(a, A), ext(b, B), { t: 'line', a: A, b: B, layer: 'dim' }, arrow(A, 1), arrow(B, -1)];
  const up = n[1] * sg;
  if (Math.abs(n[1]) >= Math.abs(n[0])) {
    const tp: Pt = [mid[0] + n[0] * sg, mid[1] + n[1] * sg + (up < 0 ? -h : 0)];
    out.push({ t: 'text', p: tp, s: text, h, layer: 'dim', anchor: 'c', edit });
  } else {
    const tp: Pt = [mid[0] + n[0] * sg + (n[0] * sg > 0 ? h : 0), mid[1]];
    out.push({ t: 'text', p: tp, s: text, h, layer: 'dim', anchor: 'c', rot: 90, edit });
  }
  return out;
}

function expandHatch(x0: number, y0: number, x1: number, y1: number, sp = 2): Ent[] {
  const out: Ent[] = [];
  const step = sp * Math.SQRT2;
  for (let c = x0 - y1; c <= x1 - y0; c += step) {
    const lo = Math.max(x0, y0 + c), hi = Math.min(x1, y1 + c);
    if (hi - lo > 1e-6) out.push({ t: 'line', a: [lo, lo - c], b: [hi, hi - c], layer: 'hatch' });
  }
  return out;
}

function titleBlock(m: SheetMeta, sl: string): { ents: Ent[]; logo: Sheet['logoRect'] } {
  const E: Ent[] = [];
  const L = (a: Pt, b: Pt) => E.push({ t: 'line', a, b, layer: 'border' });
  const R = (x0: number, y0: number, x1: number, y1: number) => E.push({ t: 'poly', closed: true, layer: 'border', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const T = (x: number, y: number, s: string, h = 3.2, anchor: 'l' | 'c' | 'r' = 'l') => E.push({ t: 'text', p: [x, y], s, h, layer: 'text', anchor });
  R(10, 10, 410, 287);
  R(230, 10, 410, 62);
  [50, 38, 26, 18].forEach((y) => L([230, y], [410, y]));
  L([272, 50], [272, 62]);
  T(275, 54.5, m.company.toUpperCase(), 3.6);
  T(232, 41.5, `TITLE: ${m.title}`, 4);
  T(232, 29.5, `PART ID: ${m.partId}`); T(318, 29.5, `DWG NO: ${m.drawingNo}`); T(392, 29.5, `REV: ${m.revision}`);
  T(232, 21.5, `MATERIAL: ${m.material}`); T(330, 21.5, `SCALE: ${sl}`); T(372, 21.5, `UNITS: ${m.units}`);
  T(232, 13.5, `DATE: ${m.date}`); T(290, 13.5, 'PRELIMINARY - NOT FOR MANUFACTURE', 3.2);
  T(14, 58, 'NOTES:', 3.2);
  m.notes.slice(0, 10).forEach((n, i) => T(14, 53 - i * 4, `${i + 1}. ${n}`, 2.8));
  return { ents: E, logo: { x: 231, y: 51, w: 40, h: 10 } };
}

export function composeSheet(views: DrawView[], meta: SheetMeta): Sheet {
  const boxes = views.map((v) => bbox(v.ents));
  const ws = boxes.map((b) => b[2] - b[0]), hs = boxes.map((b) => b[3] - b[1]);
  const aw = AREA.x1 - AREA.x0, ah = AREA.y1 - AREA.y0;
  const cols = views.length <= 2 ? views.length : Math.ceil(views.length / 2);
  const rows: number[][] = [];
  for (let i = 0; i < views.length; i += cols) rows.push(views.map((_, k) => k).slice(i, i + cols));
  const lab = views.map((v) => v.name.length * 3.6 * 0.6 + 8);
  const cell = (i: number, c: number) => Math.max(ws[i] * c + 2 * MARGIN, lab[i]);
  const fits = (c: number) => rows.every((r) => r.reduce((a, i) => a + cell(i, c), 0) <= aw) && rows.reduce((a, r) => a + Math.max(...r.map((i) => hs[i] * c)) + MARGIN_BOTTOM + MARGIN_TOP, 0) <= ah;
  let s = SCALES[0];
  for (const c of SCALES) if (fits(c)) s = c;
  const sl = scaleLabel(s);
  const ents: Ent[] = [];
  let yTop = AREA.y1;
  const rowHs = rows.map((r) => Math.max(...r.map((i) => hs[i] * s)) + MARGIN_BOTTOM + MARGIN_TOP);
  const used = rowHs.reduce((a, b) => a + b, 0);
  yTop -= Math.max(0, (ah - used) / 2);
  rows.forEach((r, ri) => {
    const total = r.reduce((a, i) => a + cell(i, s), 0);
    let cursor = AREA.x0 + (aw - total) / 2;
    const yMid = yTop - rowHs[ri] / 2 + (MARGIN_BOTTOM - MARGIN_TOP) / 2;
    for (const i of r) {
      const v = views[i], [bx0, by0] = boxes[i];
      const cw = cell(i, s), ox = cursor + (cw - ws[i] * s) / 2, oy = yMid - (hs[i] * s) / 2;
      const T = (p: Pt): Pt => [ox + (p[0] - bx0) * s, oy + (p[1] - by0) * s];
      for (const e of v.ents) {
        if (e.t === 'line') ents.push({ ...e, a: T(e.a), b: T(e.b) });
        else if (e.t === 'circle') ents.push({ ...e, c: T(e.c), r: e.r * s });
        else if (e.t === 'poly') ents.push({ ...e, pts: e.pts.map(T) });
        else if (e.t === 'text') ents.push({ ...e, p: T(e.p) });
        else if (e.t === 'dim') ents.push(...expandDim(T(e.a), T(e.b), e.off, e.text, e.edit));
        else { const a = T([e.x0, e.y0]), b = T([e.x1, e.y1]); ents.push(...expandHatch(a[0], a[1], b[0], b[1])); }
      }
      ents.push({ t: 'text', p: [ox + (ws[i] * s) / 2, oy - MARGIN_BOTTOM + 4], s: v.name, h: 3.6, layer: 'text', anchor: 'c' });
      cursor += cw;
    }
    yTop -= rowHs[ri];
  });
  const tb = titleBlock(meta, sl);
  return { ents: [...tb.ents, ...ents], scale: s, scaleLabel: sl, logoRect: tb.logo, w: SHEET.w, h: SHEET.h };
}

/** Helpers for family drawing modules. */
export const crossLines = (c: Pt, r: number): ModelEnt[] => [
  { t: 'line', a: [c[0] - r, c[1]], b: [c[0] + r, c[1]], layer: 'centre' },
  { t: 'line', a: [c[0], c[1] - r], b: [c[0], c[1] + r], layer: 'centre' },
];
