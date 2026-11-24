import type { Detected } from './model.ts';
import { uid } from './model.ts';

/* Reads dimension-like text from a drawing (PDF text or AI): "Ø25", "R12.5", "M10", "45°", "6 x Ø8", "120", "2.5 in".
 * The values are only DETECTED: the person matches each one to the drawing and confirms it. Nothing is invented. */

export interface DimText { value: number | null; unit: string; kind: Detected['kind']; count?: number }

export function parseDimText(raw: string): DimText | null {
  const s = raw.replace(/\s+/g, ' ').replace(/,(\d)/g, '.$1').replace(/⌀|∅|ø/g, 'Ø').trim();
  if (!s || s.length > 40) return null;
  // thread
  let m = s.match(/^M\s?(\d+(?:\.\d+)?)(?:\s?[x×]\s?(\d+(?:\.\d+)?))?\b/i);
  if (m) return { value: Number(m[1]), unit: 'mm', kind: 'thread' };
  // count x diameter (e.g. "6 x Ø8", "6 HOLES Ø8", "6-Ø8")
  m = s.match(/^(\d+)\s?(?:x|×|-|holes?|nos?\.?|off)\s?(?:Ø|DIA\.?\s?)(\d+(?:\.\d+)?)/i);
  if (m) return { value: Number(m[2]), unit: 'mm', kind: 'diameter', count: Number(m[1]) };
  // diameter
  m = s.match(/^(?:Ø|DIA\.?\s?|D=)\s?(\d+(?:\.\d+)?)/i) ?? s.match(/^(\d+(?:\.\d+)?)\s?(?:Ø|DIA\.?)$/i);
  if (m) return { value: Number(m[1]), unit: 'mm', kind: 'diameter' };
  // radius
  m = s.match(/^R\s?(\d+(?:\.\d+)?)/i);
  if (m) return { value: Number(m[1]), unit: 'mm', kind: 'radius' };
  // angle
  m = s.match(/^(\d+(?:\.\d+)?)\s?(?:°|deg)$/i);
  if (m) return { value: Number(m[1]), unit: 'deg', kind: 'angle' };
  // plain length, optional unit and tolerance ("120", "120 mm", "120±0.1", "4.5\"")
  m = s.match(/^(\d+(?:\.\d+)?)\s?(mm|cm|m|in|"|inch)?\s?(?:±\s?\d+(?:\.\d+)?|\+\d+(?:\.\d+)?\s?\/?\s?-\d+(?:\.\d+)?|h\d|H\d)?$/i);
  if (m) { const u = (m[2] ?? 'mm').toLowerCase(); const k = u === 'cm' ? 10 : u === 'm' ? 1000 : u === 'in' || u === '"' || u === 'inch' ? 25.4 : 1; const v = Number(m[1]) * k; return v > 0 && v < 1e6 ? { value: v, unit: 'mm', kind: 'length' } : null; }
  // scale note
  m = s.match(/SCALE\s?[:=]?\s?(\d+(?:\.\d+)?)\s?:\s?(\d+(?:\.\d+)?)/i);
  if (m) return { value: Number(m[1]) / Number(m[2]), unit: 'ratio', kind: 'note' };
  return null;
}

/** Drawing scale written on the sheet ("SCALE 1:2" -> 0.5), if any. */
export function scaleFromTexts(texts: string[]): number | null {
  for (const t of texts) { const m = t.match(/SCALE\s?[:=]?\s?(\d+(?:\.\d+)?)\s?:\s?(\d+(?:\.\d+)?)/i); if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]); }
  return null;
}

/** Turns positioned text items into detected dimension candidates. Pieces next to each other on one line ("Ø" + "25") are joined first. */
export function detectFromItems(items: { str: string; x: number; y: number; h: number }[], from: Detected['from']): Detected[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: { str: string; x: number; y: number; h: number }[] = [];
  for (const it of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(1, it.h * 0.4) && it.x - (last.x + last.str.length * last.h * 0.55) < it.h * 0.8 && /^(Ø|⌀|R|M|\d+\s?[x×])$/i.test(last.str.trim())) { last.str = `${last.str.trim()}${it.str.trim()}`; continue; }
    merged.push({ ...it });
  }
  const out: Detected[] = [];
  for (const it of merged) {
    const d = parseDimText(it.str);
    if (!d) continue;
    out.push({ id: uid('t'), text: it.str.trim().slice(0, 40), value: d.value, unit: d.unit, kind: d.count ? 'diameter' : d.kind, px: it.x, py: it.y, from, confidence: from === 'pdf-text' ? 0.9 : 0.6, status: 'detected' });
    if (d.count) out.push({ id: uid('t'), text: `${d.count} holes`, value: d.count, unit: 'count', kind: 'count', px: it.x, py: it.y, from, confidence: from === 'pdf-text' ? 0.9 : 0.6, status: 'detected' });
  }
  return out.slice(0, 2000);
}
