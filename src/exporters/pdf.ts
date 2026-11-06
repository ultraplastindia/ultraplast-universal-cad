import { jsPDF } from 'jspdf';
import type { Layer, Sheet } from '../cad2d/sheet.ts';

export interface Logo { dataUrl: string; w: number; h: number }
export interface PdfData { title: string; partNo: string; drawingNo: string; revision: string; date: string; sheet: Sheet; sections: { title: string; rows: string[] }[] }

export async function loadLogo(): Promise<Logo | null> {
  try {
    const r = await fetch('/assets/Logo.png');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('image')) return null;
    const blob = await r.blob();
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(blob); });
    const dim = await new Promise<{ w: number; h: number }>((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.width, h: im.height }); im.onerror = () => rej(new Error('img')); im.src = dataUrl; });
    return { dataUrl, ...dim };
  } catch { return null; }
}

const STYLE: Record<Layer, { w: number; dash: number[]; rgb: [number, number, number] }> = {
  outline: { w: 0.5, dash: [], rgb: [17, 17, 17] }, hidden: { w: 0.25, dash: [3, 1.5], rgb: [85, 85, 85] }, centre: { w: 0.25, dash: [9, 1.5, 1.5, 1.5], rgb: [176, 0, 32] },
  dim: { w: 0.25, dash: [], rgb: [10, 107, 45] }, text: { w: 0.2, dash: [], rgb: [17, 17, 17] }, hatch: { w: 0.15, dash: [], rgb: [119, 119, 119] }, border: { w: 0.7, dash: [], rgb: [17, 17, 17] },
};

function watermark(doc: jsPDF, cx: number, cy: number, size: number, angle: number) {
  doc.setTextColor(236, 238, 241); doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
  const w = doc.getTextWidth('ULTRAPLAST'), a = (angle * Math.PI) / 180;
  doc.text('ULTRAPLAST', cx - (w / 2) * Math.cos(a), cy + (w / 2) * Math.sin(a), { angle });
  doc.setFont('helvetica', 'normal');
}

function drawSheet(doc: jsPDF, sheet: Sheet, logo: Logo | null) {
  const H = sheet.h, Y = (y: number) => H - y;
  watermark(doc, 210, 150, 96, 28); // drawn first, pale, behind all linework
  for (const e of sheet.ents) {
    const s = STYLE[e.layer];
    doc.setDrawColor(...s.rgb); doc.setFillColor(...s.rgb); doc.setTextColor(...s.rgb); doc.setLineWidth(s.w);
    doc.setLineDashPattern(s.dash, 0);
    if (e.t === 'line') doc.line(e.a[0], Y(e.a[1]), e.b[0], Y(e.b[1]));
    else if (e.t === 'circle') doc.circle(e.c[0], Y(e.c[1]), e.r, 'S');
    else if (e.t === 'poly') {
      if (e.layer === 'dim' && e.closed && e.pts.length === 3) doc.triangle(e.pts[0][0], Y(e.pts[0][1]), e.pts[1][0], Y(e.pts[1][1]), e.pts[2][0], Y(e.pts[2][1]), 'F');
      else { const n = e.pts.length, m = e.closed ? n : n - 1; for (let i = 0; i < m; i++) { const a = e.pts[i], b = e.pts[(i + 1) % n]; doc.line(a[0], Y(a[1]), b[0], Y(b[1])); } }
    } else {
      doc.setFontSize(e.h * 3.9);
      const w = doc.getTextWidth(e.s), k = e.anchor === 'c' ? 0.5 : e.anchor === 'r' ? 1 : 0, r = ((e.rot ?? 0) * Math.PI) / 180;
      doc.text(e.s, e.p[0] - w * k * Math.cos(r), Y(e.p[1] - w * k * Math.sin(r)), e.rot ? { angle: e.rot } : undefined);
    }
  }
  doc.setLineDashPattern([], 0);
  if (logo) { const r = sheet.logoRect, k = Math.min(r.w / logo.w, r.h / logo.h), w = logo.w * k, h = logo.h * k; doc.addImage(logo.dataUrl, 'PNG', r.x + (r.w - w) / 2, Y(r.y + r.h) + (r.h - h) / 2, w, h); }
}

function specPages(doc: jsPDF, d: PdfData, logo: Logo | null) {
  let y = 28;
  const page = () => { watermark(doc, 105, 150, 70, 40); doc.setTextColor(20); if (logo) { const k = Math.min(40 / logo.w, 12 / logo.h); doc.addImage(logo.dataUrl, 'PNG', 14, 8, logo.w * k, logo.h * k); } };
  page();
  const line = (s: string, size = 9, bold = false, indent = 0) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(20);
    for (const part of doc.splitTextToSize(s, 182 - indent) as string[]) { if (y > 280) { doc.addPage('a4', 'portrait'); page(); y = 24; } doc.text(part, 14 + indent, y); y += size * 0.5 + 1.4; }
  };
  line('Ultraplast Chainbelts Private Limited', 14, true);
  line('Technical specification report', 11); y += 2;
  line(`${d.title}  |  Part ${d.partNo}  |  Drawing ${d.drawingNo}  |  Rev ${d.revision}  |  ${d.date}`, 9);
  line('STATUS: PRELIMINARY - not validated for manufacture.', 10, true); y += 2;
  for (const s of d.sections) { if (!s.rows.length) continue; y += 2; line(s.title, 11, true); s.rows.forEach((r) => line(r, 9, false, 3)); }
  y += 4; line('Website: https://www.ultraplastindia.com/', 9);
}

export function buildPdf(d: PdfData, logo: Logo | null, which: 'drawing' | 'spec'): Blob {
  const doc = which === 'drawing' ? new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' }) : new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${d.title} ${d.partNo}`, author: 'Ultraplast Chainbelts Private Limited', subject: 'PRELIMINARY engineering drawing' });
  if (which === 'drawing') drawSheet(doc, d.sheet, logo); else specPages(doc, d, logo);
  return doc.output('blob');
}
