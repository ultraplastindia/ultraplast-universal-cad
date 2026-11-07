/** What the AI is asked to return, and a strict reader for the answer. Shared by the server (api/_lib/ai.ts) and the browser.
 *  All numbers are RELATIVE (any scale): the real size always comes from the one measurement the person types in. */
export type AiKind = 'flat' | 'turned' | 'stepped' | 'other';
export interface AiAnalysis {
  kind: AiKind; name: string; material: string; notes: string;
  /** flat plate: outline on a 0..100 grid (y down), holes as x,y,diameter on the same grid */
  flat?: { outline: [number, number][]; holes: [number, number, number][] };
  /** turned part along its axis, left to right: relative length and diameter of each section; bore = relative bore diameter (0 = solid) */
  turned?: { sections: { length: number; diameter: number }[]; bore: number };
  /** stepped block: slabs stacked in height, each a relative width x depth x height */
  stepped?: { slabs: { width: number; depth: number; height: number }[] };
}

export const ANALYSIS_PROMPT = `You look at a photo of ONE industrial conveyor component. Reply with JSON only, no other text, in this shape:
{"kind":"flat"|"turned"|"stepped"|"other","name":"short name","material":"steel|stainless|aluminium|plastic|unknown","notes":"one sentence, mention anything you are unsure of",
"flat":{"outline":[[x,y],...],"holes":[[x,y,diameter],...]},
"turned":{"sections":[{"length":n,"diameter":n},...],"bore":n},
"stepped":{"slabs":[{"width":n,"depth":n,"height":n},...]}}
Rules: kind "flat" = a plate or cut sheet part seen from the front (give "flat": outline as a closed polygon on a 0..100 grid with y pointing down, at most 60 points, plus round holes in the same units). kind "turned" = a round part like a shaft, roller, pulley, bush or hub (give "turned": sections from left to right, relative numbers, bore 0 if solid). kind "stepped" = stacked rectangular blocks (give "stepped"). Otherwise "other". Only include the object that matches the kind. All numbers are relative; do not invent absolute millimetres.`;

const num = (v: unknown, lo: number, hi: number): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Pulls the first JSON object out of the model's text (models sometimes wrap it in ``` fences) and checks every field. */
export function parseAnalysis(text: string): AiAnalysis | { error: string } {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return { error: 'The AI did not return the expected data.' };
  let j: Record<string, unknown>;
  try { j = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>; } catch { return { error: 'The AI answer could not be read.' }; }
  const kind: AiKind = j.kind === 'flat' || j.kind === 'turned' || j.kind === 'stepped' ? j.kind : 'other';
  const out: AiAnalysis = { kind, name: str(j.name, 80) || 'Component', material: str(j.material, 30).toLowerCase(), notes: str(j.notes, 300) };
  const f = j.flat as { outline?: unknown; holes?: unknown } | undefined;
  if (kind === 'flat' && f && Array.isArray(f.outline)) {
    const outline = (f.outline as unknown[]).slice(0, 80).map((p) => (Array.isArray(p) ? [num(p[0], 0, 100), num(p[1], 0, 100)] : [null, null])).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
    const holes = (Array.isArray(f.holes) ? (f.holes as unknown[]) : []).slice(0, 40).map((h) => (Array.isArray(h) ? [num(h[0], 0, 100), num(h[1], 0, 100), num(h[2], 0.1, 100)] : [null, null, null])).filter((h): h is [number, number, number] => h.every((x) => x !== null));
    if (outline.length >= 3) out.flat = { outline, holes };
  }
  const t = j.turned as { sections?: unknown; bore?: unknown } | undefined;
  if (kind === 'turned' && t && Array.isArray(t.sections)) {
    const sections = (t.sections as { length?: unknown; diameter?: unknown }[]).slice(0, 12).map((s) => ({ length: num(s?.length, 0.001, 1e6), diameter: num(s?.diameter, 0.001, 1e6) })).filter((s): s is { length: number; diameter: number } => s.length !== null && s.diameter !== null);
    if (sections.length) out.turned = { sections, bore: num(t.bore, 0, 1e6) ?? 0 };
  }
  const st = j.stepped as { slabs?: unknown } | undefined;
  if (kind === 'stepped' && st && Array.isArray(st.slabs)) {
    const slabs = (st.slabs as { width?: unknown; depth?: unknown; height?: unknown }[]).slice(0, 8).map((s) => ({ width: num(s?.width, 0.001, 1e6), depth: num(s?.depth, 0.001, 1e6), height: num(s?.height, 0.001, 1e6) })).filter((s): s is { width: number; depth: number; height: number } => s.width !== null && s.depth !== null && s.height !== null);
    if (slabs.length) out.stepped = { slabs };
  }
  if ((kind === 'flat' && !out.flat) || (kind === 'turned' && !out.turned) || (kind === 'stepped' && !out.stepped)) out.kind = 'other';
  return out;
}
