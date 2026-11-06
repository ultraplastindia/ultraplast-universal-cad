import type { Ent, Layer, Sheet } from '../cad2d/sheet.ts';

const STYLE: Record<Layer, { w: number; dash?: string; color: string }> = {
  outline: { w: 0.5, color: '#111' }, hidden: { w: 0.25, dash: '3 1.5', color: '#555' }, centre: { w: 0.25, dash: '9 1.5 1.5 1.5', color: '#b00020' },
  dim: { w: 0.25, color: '#0a6b2d' }, text: { w: 0.2, color: '#111' }, hatch: { w: 0.15, color: '#777' }, border: { w: 0.7, color: '#111' },
};
export const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => +n.toFixed(3);


const attrs = (l: Layer, color?: string, w?: number) => { const s = STYLE[l]; return `stroke="${color ?? s.color}" stroke-width="${w ?? s.w}" fill="none"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"`; };
/** One entity as SVG (sheet coordinates, y up). `color`/`w` override the layer style (used for selection highlight). */
export function entSvg(e: Ent, color?: string, w?: number): string {
  if (e.t === 'line') return `<line x1="${f(e.a[0])}" y1="${f(e.a[1])}" x2="${f(e.b[0])}" y2="${f(e.b[1])}" ${attrs(e.layer, color, w)}/>`;
  if (e.t === 'circle') return `<circle cx="${f(e.c[0])}" cy="${f(e.c[1])}" r="${f(e.r)}" ${attrs(e.layer, color, w)}/>`;
  if (e.t === 'poly') {
    const fill = e.layer === 'dim' && e.closed ? (color ?? STYLE.dim.color) : 'none';
    return `<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" ${attrs(e.layer, color, w).replace('fill="none"', `fill="${fill}"`)}/>`;
  }
  const a = e.anchor === 'c' ? 'middle' : e.anchor === 'r' ? 'end' : 'start';
  return `<text transform="translate(${f(e.p[0])},${f(e.p[1])})${e.rot ? ` rotate(${e.rot})` : ''} scale(1,-1)" font-size="${f(e.h * 1.4)}" font-family="Arial, Helvetica, sans-serif" text-anchor="${a}" fill="${color ?? STYLE[e.layer].color}"${color ? ' font-weight="bold"' : ''}>${escXml(e.s)}</text>`;
}

export interface SvgOpts { hide?: Set<Layer>; grid?: boolean; logoHref?: string | null }

/** Children of the sheet drawing, in sheet coordinates (y up) wrapped by a flip transform. */
export function sheetSvgInner(sheet: Sheet, o: SvgOpts = {}): string {
  const hide = o.hide ?? new Set<Layer>();
  const parts: string[] = [];
  if (o.grid) {
    for (let x = 0; x <= sheet.w; x += 10) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${sheet.h}" stroke="#e3e8ee" stroke-width="0.1"/>`);
    for (let y = 0; y <= sheet.h; y += 10) parts.push(`<line x1="0" y1="${y}" x2="${sheet.w}" y2="${y}" stroke="#e3e8ee" stroke-width="0.1"/>`);
  }
  for (const e of sheet.ents as Ent[]) { if (!hide.has(e.layer)) parts.push(entSvg(e)); }
  return parts.join('');
}

export function logoElement(sheet: Sheet, href: string | null | undefined): string {
  if (!href) return '';
  const r = sheet.logoRect;
  return `<image href="${escXml(href)}" x="${r.x}" y="${sheet.h - r.y - r.h}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMid meet" onerror="this.style.display='none'"/>`;
}

/** Complete stand-alone SVG document (A3 landscape, mm). */
export function sheetToSvg(sheet: Sheet, o: SvgOpts = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${sheet.h}mm" viewBox="0 0 ${sheet.w} ${sheet.h}"><rect width="${sheet.w}" height="${sheet.h}" fill="#fff"/><g transform="translate(0,${sheet.h}) scale(1,-1)">${sheetSvgInner(sheet, o)}</g>${logoElement(sheet, o.logoHref)}</svg>`;
}
