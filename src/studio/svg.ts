import type { Pt } from '../core/types.ts';
import type { Ent } from './model.ts';
import { uid } from './model.ts';
import { applyAff, transformEnt } from './geom.ts';
import type { Affine } from './geom.ts';

/* SVG import (vector drawings exported from other programs). Reads path, line, rect, circle, ellipse, polyline, polygon and text,
 * with nested <g> transforms. Units: the root width/height in mm, cm or in together with the viewBox give the true size;
 * plain pixels are taken as 96 per inch. SVG's Y axis points down, so the drawing is flipped to the CAD Y-up direction.
 * Pure string parsing: no browser needed, so it is unit-tested. */

export interface SvgImport { ents: Ent[]; mmPerUnit: number; unitsNote: string; warnings: string[] }
interface Tag { name: string; attrs: Record<string, string>; close: boolean; selfClose: boolean; text?: string }

function tokenize(src: string): Tag[] {
  const out: Tag[] = [];
  const s = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[5] !== undefined) { const last = out[out.length - 1]; if (last && last.name === 'text' && !last.close) last.text = (last.text ?? '') + m[5]; continue; }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3]))) attrs[a[1]] = a[3] ?? a[4] ?? '';
    // style="stroke:...;fill:..." is not needed for geometry; display:none hides
    out.push({ name: m[2].replace(/^svg:/, ''), attrs, close: m[1] === '/', selfClose: m[4] === '/' });
  }
  return out;
}
const mulAff = (a: Affine, b: Affine): Affine => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[0] * b[4] + a[1] * b[5] + a[4], a[2] * b[4] + a[3] * b[5] + a[5]];
export function parseTransform(t: string | undefined): Affine {
  let m: Affine = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let x: RegExpExecArray | null;
  while ((x = re.exec(t))) {
    const v = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let k: Affine = [1, 0, 0, 1, 0, 0];
    if (x[1] === 'matrix' && v.length === 6) k = [v[0], v[2], v[1], v[3], v[4], v[5]];
    else if (x[1] === 'translate') k = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (x[1] === 'scale') k = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (x[1] === 'rotate') { const a = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = v[1] ?? 0, cy = v[2] ?? 0; k = [c, -s, s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; }
    else if (x[1] === 'skewX') k = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    else if (x[1] === 'skewY') k = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    m = mulAff(m, k);
  }
  return m;
}
const lenMm = (v: string | undefined): { mm: number | null; unitless: number | null } => {
  if (!v) return { mm: null, unitless: null };
  const m = v.trim().match(/^([\d.eE+-]+)\s*(mm|cm|in|pt|pc|px)?$/); if (!m) return { mm: null, unitless: null };
  const n = Number(m[1]), u = m[2] ?? '';
  const k = u === 'mm' ? 1 : u === 'cm' ? 10 : u === 'in' ? 25.4 : u === 'pt' ? 25.4 / 72 : u === 'pc' ? 25.4 / 6 : 25.4 / 96;
  return { mm: n * k, unitless: u === '' || u === 'px' ? n : null };
};

/** Path data -> list of polylines (each with a closed flag). Curves are divided into short straight pieces. */
export function pathToPolys(d: string, seg = 16): { pts: Pt[]; closed: boolean }[] {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], lastCtl: Pt | null = null, lastQ: Pt | null = null;
  let poly: Pt[] = [];
  const flush = (closed: boolean) => { if (poly.length >= 2) out.push({ pts: poly, closed }); poly = []; };
  const num = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => { for (let k = 1; k <= seg; k++) { const t = k / seg, u = 1 - t; poly.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
  const quad = (p0: Pt, p1: Pt, p2: Pt) => { for (let k = 1; k <= seg; k++) { const t = k / seg, u = 1 - t; poly.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); } };
  const arc = (p0: Pt, rx: number, ry: number, phi: number, large: number, sweep: number, p1: Pt) => {
    if (rx === 0 || ry === 0) { poly.push(p1); return; }
    rx = Math.abs(rx); ry = Math.abs(ry); const ph = (phi * Math.PI) / 180, c = Math.cos(ph), s = Math.sin(ph);
    const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2, x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
    const L = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry); if (L > 1) { rx *= Math.sqrt(L); ry *= Math.sqrt(L); }
    const sg = large === sweep ? -1 : 1, num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const co = sg * Math.sqrt(Math.max(0, num2 / den)), cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
    const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * seg / 2));
    for (let k = 1; k <= n; k++) { const t = t1 + (dt * k) / n; poly.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]); }
  };
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const P = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (C === 'Z') { if (poly.length) { flush(true); } cur = start; lastCtl = lastQ = null; continue; }
    if (!isNum()) { i++; continue; }
    if (C === 'M') { flush(false); cur = P(num(), num()); start = cur; poly = [cur]; cmd = rel ? 'l' : 'L'; lastCtl = lastQ = null; continue; }
    if (!poly.length) poly = [cur];
    if (C === 'L') { cur = P(num(), num()); poly.push(cur); lastCtl = lastQ = null; }
    else if (C === 'H') { const x = num(); cur = [rel ? cur[0] + x : x, cur[1]]; poly.push(cur); lastCtl = lastQ = null; }
    else if (C === 'V') { const y = num(); cur = [cur[0], rel ? cur[1] + y : y]; poly.push(cur); lastCtl = lastQ = null; }
    else if (C === 'C') { const p1 = P(num(), num()), p2 = P(num(), num()), p3 = P(num(), num()); cubic(cur, p1, p2, p3); lastCtl = p2; lastQ = null; cur = p3; }
    else if (C === 'S') { const p1: Pt = lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur; const p2 = P(num(), num()), p3 = P(num(), num()); cubic(cur, p1, p2, p3); lastCtl = p2; lastQ = null; cur = p3; }
    else if (C === 'Q') { const p1 = P(num(), num()), p2 = P(num(), num()); quad(cur, p1, p2); lastQ = p1; lastCtl = null; cur = p2; }
    else if (C === 'T') { const p1: Pt = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur; const p2 = P(num(), num()); quad(cur, p1, p2); lastQ = p1; lastCtl = null; cur = p2; }
    else if (C === 'A') { const rx = num(), ry = num(), ph = num(), la = num(), sw = num(), p1 = P(num(), num()); arc(cur, rx, ry, ph, la, sw, p1); cur = p1; lastCtl = lastQ = null; }
    else i++;
  }
  flush(false);
  return out;
}

export function parseSvg(text: string, layer: string, maxEnts = 30000): SvgImport {
  if (text.length > 30_000_000) throw new Error('The SVG file is too large (limit about 30 MB).');
  const tags = tokenize(text);
  const root = tags.find((t) => t.name === 'svg' && !t.close);
  if (!root) throw new Error('This does not look like an SVG file.');
  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  const W = lenMm(root.attrs.width), Hh = lenMm(root.attrs.height);
  let mmPerUnit = 25.4 / 96, unitsNote = 'pixels (96 per inch)';
  const warnings: string[] = [];
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0) {
    if (W.mm !== null && W.unitless === null) { mmPerUnit = W.mm / vb[2]; unitsNote = `true size from width ${root.attrs.width}`; }
    else if (W.unitless !== null) { mmPerUnit = (W.unitless * 25.4) / 96 / vb[2]; unitsNote = 'pixels (96 per inch): set the scale from a known size'; }
    else unitsNote = 'no size given: user units taken as pixels (96 per inch); set the scale from a known size';
  } else if (W.mm !== null && W.unitless === null) unitsNote = 'no viewBox: user units taken as pixels (96 per inch)';
  const vbH = vb.length === 4 && Number.isFinite(vb[3]) ? (vb[1] || 0) + vb[3] : (Hh.unitless ?? (Hh.mm ? Hh.mm / mmPerUnit : 0));
  // SVG user units -> mm, Y up
  const base: Affine = [mmPerUnit, 0, 0, -mmPerUnit, 0, vbH * mmPerUnit];
  const stack: Affine[] = [base]; const hidden: boolean[] = [false];
  const ents: Ent[] = [];
  const B = () => ({ id: uid('v'), layer, source: 'imported' as const, confirmed: true });
  const num = (t: Tag, k: string, d = 0) => { const v = Number.parseFloat(t.attrs[k] ?? ''); return Number.isFinite(v) ? v : d; };
  let skipped = 0;
  for (const t of tags) {
    if (t.close) { if (t.name === 'g' || t.name === 'svg' || t.name === 'a') { stack.pop(); hidden.pop(); } continue; }
    const M = mulAff(stack[stack.length - 1], parseTransform(t.attrs.transform));
    const hide = hidden[hidden.length - 1] || t.attrs.display === 'none' || /display\s*:\s*none/.test(t.attrs.style ?? '');
    if (t.name === 'g' || t.name === 'svg' || t.name === 'a') { if (!t.selfClose) { stack.push(t.name === 'svg' && t === root ? stack[0] : M); hidden.push(hide); } continue; }
    if (hide || t.name === 'defs' || t.name === 'clipPath' || t.name === 'mask') continue;
    if (ents.length >= maxEnts) { warnings.push(`Only the first ${maxEnts} shapes were imported.`); break; }
    const T = (p: Pt) => applyAff(M, p);
    const add = (e: Ent) => ents.push(e);
    if (t.name === 'line') add({ ...B(), k: 'line', a: T([num(t, 'x1'), num(t, 'y1')]), b: T([num(t, 'x2'), num(t, 'y2')]) });
    else if (t.name === 'rect') { const x = num(t, 'x'), y = num(t, 'y'), w = num(t, 'width'), h = num(t, 'height'); if (w > 0 && h > 0) { add({ ...B(), k: 'poly', closed: true, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p) => T(p as Pt)) }); if (num(t, 'rx') > 0 || num(t, 'ry') > 0) warnings.push('Rounded rectangle corners were imported as sharp corners; use Fillet to round them again.'); } }
    else if (t.name === 'circle') { const r = num(t, 'r'); if (r > 0) add(transformEnt({ ...B(), k: 'circle', c: [num(t, 'cx'), num(t, 'cy')], r }, M)); }
    else if (t.name === 'ellipse') { const rx = num(t, 'rx'), ry = num(t, 'ry'); if (rx > 0 && ry > 0) add(transformEnt({ ...B(), k: 'ellipse', c: [num(t, 'cx'), num(t, 'cy')], rx, ry, rot: 0 }, M)); }
    else if (t.name === 'polyline' || t.name === 'polygon') { const v = (t.attrs.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number); const pts: Pt[] = []; for (let k = 0; k + 1 < v.length; k += 2) pts.push(T([v[k], v[k + 1]])); if (pts.length >= 2) add({ ...B(), k: 'poly', closed: t.name === 'polygon', pts }); }
    else if (t.name === 'path') for (const p of pathToPolys(t.attrs.d ?? '')) add({ ...B(), k: 'poly', closed: p.closed, pts: p.pts.map(T) });
    else if (t.name === 'text') { if (t.text?.trim()) add({ ...B(), k: 'text', p: T([num(t, 'x'), num(t, 'y')]), s: t.text.trim().slice(0, 300), h: Math.max(1, num(t, 'font-size', 12) * mmPerUnit) }); }
    else if (['image', 'use', 'pattern', 'symbol', 'marker', 'filter', 'linearGradient', 'radialGradient', 'stop', 'style', 'title', 'desc', 'metadata', 'tspan'].includes(t.name)) { if (t.name === 'image' || t.name === 'use') skipped++; }
  }
  if (skipped) warnings.push(`${skipped} embedded picture(s) or <use> reference(s) were not imported.`);
  if (unitsNote.includes('set the scale')) warnings.push('The SVG does not state a real-world size. Measure one known distance and use "Set scale" so the drawing is true size.');
  return { ents, mmPerUnit, unitsNote, warnings };
}
