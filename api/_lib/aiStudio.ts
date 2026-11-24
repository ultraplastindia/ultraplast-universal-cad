/** Design Studio AI: what the AI is asked, and strict readers for its answers. Shared by the server (api/ai.ts) and the browser.
 *  Nothing the AI says is applied directly: drawing readings become UNCONFIRMED items, and assistant answers become a list of
 *  allowed design actions that the person previews and accepts or rejects one by one. */

export interface AiDrawing {
  partType: string; material: string; notes: string;
  views: { name: string; box: [number, number, number, number] }[];
  /** coordinates in thousandths of the picture WIDTH, y pointing down */
  entities: ({ t: 'line'; a: [number, number]; b: [number, number] } | { t: 'circle'; c: [number, number]; r: number } | { t: 'arc'; c: [number, number]; r: number; a0: number; a1: number } | { t: 'poly'; pts: [number, number][]; closed: boolean })[];
  dimensions: { text: string; value: number | null; kind: 'length' | 'diameter' | 'radius' | 'angle' | 'count' | 'thread' | 'note'; at: [number, number]; confidence: number }[];
  missing: string[];
}

export const DRAWING_PROMPT = `You read ONE engineering drawing, sketch or photo of a conveyor component. Reply with JSON only (no other text) in this shape:
{"partType":"short name","material":"as written, or unknown","notes":"one or two sentences: what you are unsure of",
"views":[{"name":"front|top|side|section|isometric|detail|other","box":[x0,y0,x1,y1]}],
"entities":[{"t":"line","a":[x,y],"b":[x,y]},{"t":"circle","c":[x,y],"r":n},{"t":"arc","c":[x,y],"r":n,"a0":deg,"a1":deg},{"t":"poly","pts":[[x,y],...],"closed":true}],
"dimensions":[{"text":"exactly as written, e.g. Ø25 or R8 or 120","value":number or null,"kind":"length|diameter|radius|angle|count|thread|note","at":[x,y],"confidence":0..1}],
"missing":["each size or view that is needed to make the part but is NOT given on the drawing"]}
Rules:
- ALL coordinates and radii are in thousandths of the picture WIDTH (0..1000 across), y pointing DOWN, so circles stay round.
- "entities": the visible outline geometry of the MAIN view only (the view with the most dimensions): outer outline, holes, slots, internal profiles. Not dimension lines, arrows, text, hatching, borders or title blocks. At most 150 entities.
- "dimensions": only values that are WRITTEN on the drawing. Never calculate, estimate or invent a measurement. If a number is hard to read, give your reading with a low confidence.
- "missing": be specific, for example "thickness of the plate is not given" or "no side view, so the depth is unknown".
- Arcs: a0 and a1 in degrees, counter-clockwise with y pointing UP (as in CAD).`;

export type AiAction =
  | { type: 'setParam'; id: string; value: number }
  | { type: 'addHolePattern'; n: number; d: number; pcd: number; cx: number; cy: number; start: number }
  | { type: 'addGridHoles'; nx: number; ny: number; dx: number; dy: number; d: number; x0: number; y0: number }
  | { type: 'addSlot'; cx: number; cy: number; len: number; w: number; ang: number }
  | { type: 'addCircle'; cx: number; cy: number; d: number }
  | { type: 'addRect'; x: number; y: number; w: number; h: number }
  | { type: 'addPolygon'; cx: number; cy: number; n: number; r: number }
  | { type: 'extrude'; profile: string; depth: number; z0: number }
  | { type: 'revolve'; profile: string; axis: 'x' | 'y'; at: number }
  | { type: 'setBody'; id: string; key: 'depth' | 'z0' | 'fillet' | 'chamfer' | 'shell'; value: number }
  | { type: 'scale'; sx: number; sy: number; keepHoles: boolean }
  | { type: 'mirrorCopy'; axis: 'x' | 'y'; at: number }
  | { type: 'filletAll'; profile: string; r: number }
  | { type: 'setMaterial'; material: string }
  | { type: 'insertLibrary'; familyId: string; view: 'top' | 'side' }
  | { type: 'note'; text: string };
export interface AiStep { action: AiAction; why: string; critical: boolean }
export interface AiAssist { reply: string; steps: AiStep[]; suggestions: string[]; questions: string[]; dropped: string[] }

export const ASSIST_PROMPT = (context: string, instruction: string): string => `You are an engineering design assistant inside a 2D/3D CAD studio for conveyor components. Units: millimetres and degrees.
The current design (JSON): ${context}
The engineer asks: ${JSON.stringify(instruction.slice(0, 2000))}
Reply with JSON only (no other text): {"reply":"short answer in plain English","actions":[...],"suggestions":["..."],"questions":["..."]}
Each action is one of (add "why":"one sentence" to each):
{"type":"setParam","id":"<a parameter id from the design>","value":n}
{"type":"addHolePattern","n":int,"d":mm,"pcd":mm,"cx":mm,"cy":mm,"start":deg}
{"type":"addGridHoles","nx":int,"ny":int,"dx":mm,"dy":mm,"d":mm,"x0":mm,"y0":mm}
{"type":"addSlot","cx":mm,"cy":mm,"len":mm,"w":mm,"ang":deg}
{"type":"addCircle","cx":mm,"cy":mm,"d":mm}
{"type":"addRect","x":mm,"y":mm,"w":mm,"h":mm}
{"type":"addPolygon","cx":mm,"cy":mm,"n":int,"r":mm}
{"type":"extrude","profile":"<entity id of a closed outline>","depth":mm,"z0":mm}
{"type":"revolve","profile":"<entity id>","axis":"x"|"y","at":mm}
{"type":"setBody","id":"<body id>","key":"depth|z0|fillet|chamfer|shell","value":n}
{"type":"scale","sx":factor,"sy":factor,"keepHoles":true|false}
{"type":"mirrorCopy","axis":"x"|"y","at":mm}
{"type":"filletAll","profile":"<entity id of a polyline>","r":mm}
{"type":"setMaterial","material":"one of the listed materials"}
{"type":"insertLibrary","familyId":"one of the listed library families","view":"top|side"}
{"type":"note","text":"..."}
Rules: use only ids that appear in the design. Only change what was asked. If the request is unclear or a needed size is not given, ask in "questions" and give no action for it.
Put design advice (strength, thickness, clearance, tolerance, material, manufacturing method, material saving) in "suggestions" as plain sentences; these are suggestions, not engineering approval. Never claim a design is safe or approved.`;

const N = (v: unknown, lo: number, hi: number): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const S = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const P = (v: unknown, lo = -2000, hi = 3000): [number, number] | null => (Array.isArray(v) && v.length === 2 && N(v[0], lo, hi) !== null && N(v[1], lo, hi) !== null ? [Number(v[0]), Number(v[1])] : null);
function firstJson(text: string): Record<string, unknown> | null {
  const t = String(text ?? '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(t.slice(a, i + 1)) as Record<string, unknown>; } catch { return null; } } }
  }
  return null;
}

export function parseDrawing(text: string): AiDrawing | { error: string } {
  const j = firstJson(text);
  if (!j) return { error: 'The AI answer was not readable (no JSON).' };
  const ents: AiDrawing['entities'] = [];
  for (const e of Array.isArray(j.entities) ? j.entities.slice(0, 300) : []) {
    const x = e as Record<string, unknown>;
    if (x.t === 'line') { const a = P(x.a), b = P(x.b); if (a && b && (a[0] !== b[0] || a[1] !== b[1])) ents.push({ t: 'line', a, b }); }
    else if (x.t === 'circle') { const c = P(x.c), r = N(x.r, 0.01, 2000); if (c && r !== null) ents.push({ t: 'circle', c, r }); }
    else if (x.t === 'arc') { const c = P(x.c), r = N(x.r, 0.01, 2000), a0 = N(x.a0, -720, 720), a1 = N(x.a1, -720, 720); if (c && r !== null && a0 !== null && a1 !== null) ents.push({ t: 'arc', c, r, a0, a1 }); }
    else if (x.t === 'poly' && Array.isArray(x.pts)) { const pts = x.pts.slice(0, 400).map((p) => P(p)).filter((p): p is [number, number] => !!p); if (pts.length >= 2) ents.push({ t: 'poly', pts, closed: x.closed !== false && pts.length >= 3 }); }
  }
  const kinds = ['length', 'diameter', 'radius', 'angle', 'count', 'thread', 'note'] as const;
  const dims: AiDrawing['dimensions'] = [];
  for (const d of Array.isArray(j.dimensions) ? j.dimensions.slice(0, 400) : []) {
    const x = d as Record<string, unknown>, text2 = S(x.text, 40), at = P(x.at);
    if (!text2 || !at) continue;
    const kind = (kinds as readonly string[]).includes(String(x.kind)) ? (x.kind as AiDrawing['dimensions'][number]['kind']) : 'note';
    dims.push({ text: text2, value: N(x.value, -1e6, 1e6), kind, at, confidence: N(x.confidence, 0, 1) ?? 0.5 });
  }
  const views: AiDrawing['views'] = [];
  for (const v of Array.isArray(j.views) ? j.views.slice(0, 12) : []) { const x = v as Record<string, unknown>; const b = Array.isArray(x.box) && x.box.length === 4 && x.box.every((q) => N(q, -100, 3000) !== null) ? (x.box.map(Number) as [number, number, number, number]) : null; if (b) views.push({ name: S(x.name, 30) || 'view', box: b }); }
  if (!ents.length && !dims.length) return { error: 'The AI found no geometry or dimensions in this picture.' };
  return { partType: S(j.partType, 80) || 'unknown', material: S(j.material, 60) || 'unknown', notes: S(j.notes, 400), views, entities: ents, dimensions: dims, missing: (Array.isArray(j.missing) ? j.missing : []).map((m) => S(m, 200)).filter(Boolean).slice(0, 30) };
}

const MM = [-1e6, 1e6] as const;
/** Checks every action against the allowed list and ranges. Anything not allowed is dropped and listed (never applied). */
export function parseAssist(text: string, known: { params: string[]; ents: string[]; bodies: string[]; materials: string[]; families: string[] }): AiAssist | { error: string } {
  const j = firstJson(text);
  if (!j) return { error: 'The AI answer was not readable (no JSON).' };
  const steps: AiStep[] = [], dropped: string[] = [];
  for (const a of Array.isArray(j.actions) ? j.actions.slice(0, 40) : []) {
    const x = a as Record<string, unknown>, why = S(x.why, 300), t = String(x.type ?? '');
    const bad = (m: string) => dropped.push(`${t || 'action'}: ${m}`);
    const n = (k: string, lo: number = MM[0], hi: number = MM[1]) => N(x[k], lo, hi);
    let act: AiAction | null = null; let critical = false;
    switch (t) {
      case 'setParam': { const id = S(x.id, 200), v = n('value'); if (!known.params.includes(id)) { bad(`unknown parameter "${id}"`); break; } if (v === null) { bad('value is not a number'); break; } act = { type: t, id, value: v }; critical = /bore|shaft|thickness|wall|depth/i.test(id); break; }
      case 'addHolePattern': { const nn = n('n', 1, 360), d = n('d', 0.1, 1e5), pcd = n('pcd', 0, 1e6), cx = n('cx'), cy = n('cy'), st = n('start', -360, 360) ?? 0; if (nn === null || !Number.isInteger(nn) || d === null || pcd === null || cx === null || cy === null) { bad('missing or invalid values'); break; } act = { type: t, n: nn, d, pcd, cx, cy, start: st }; break; }
      case 'addGridHoles': { const nx = n('nx', 1, 200), ny = n('ny', 1, 200), dx = n('dx', 0, 1e5), dy = n('dy', 0, 1e5), d = n('d', 0.1, 1e5), x0 = n('x0'), y0 = n('y0'); if ([nx, ny, dx, dy, d, x0, y0].some((v) => v === null) || !Number.isInteger(nx) || !Number.isInteger(ny)) { bad('missing or invalid values'); break; } act = { type: t, nx: nx!, ny: ny!, dx: dx!, dy: dy!, d: d!, x0: x0!, y0: y0! }; break; }
      case 'addSlot': { const v = ['cx', 'cy', 'len', 'w', 'ang'].map((k) => n(k)); if (v.some((q) => q === null) || v[3]! <= 0 || v[2]! < 0) { bad('missing or invalid values'); break; } act = { type: t, cx: v[0]!, cy: v[1]!, len: v[2]!, w: v[3]!, ang: v[4]! }; break; }
      case 'addCircle': { const cx = n('cx'), cy = n('cy'), d = n('d', 0.01, 1e6); if (cx === null || cy === null || d === null) { bad('missing or invalid values'); break; } act = { type: t, cx, cy, d }; break; }
      case 'addRect': { const v = ['x', 'y', 'w', 'h'].map((k) => n(k)); if (v.some((q) => q === null) || v[2]! <= 0 || v[3]! <= 0) { bad('missing or invalid values'); break; } act = { type: t, x: v[0]!, y: v[1]!, w: v[2]!, h: v[3]! }; break; }
      case 'addPolygon': { const cx = n('cx'), cy = n('cy'), nn = n('n', 3, 200), r = n('r', 0.01, 1e6); if (cx === null || cy === null || nn === null || !Number.isInteger(nn) || r === null) { bad('missing or invalid values'); break; } act = { type: t, cx, cy, n: nn, r }; break; }
      case 'extrude': { const p = S(x.profile, 64), dep = n('depth', 0.001, 1e6), z0 = n('z0') ?? 0; if (!known.ents.includes(p)) { bad(`unknown outline "${p}"`); break; } if (dep === null) { bad('depth missing'); break; } act = { type: t, profile: p, depth: dep, z0 }; critical = true; break; }
      case 'revolve': { const p = S(x.profile, 64), ax = x.axis === 'x' ? 'x' : x.axis === 'y' ? 'y' : null, at = n('at') ?? 0; if (!known.ents.includes(p) || !ax) { bad('unknown outline or axis'); break; } act = { type: t, profile: p, axis: ax, at }; break; }
      case 'setBody': { const id = S(x.id, 64), key = ['depth', 'z0', 'fillet', 'chamfer', 'shell'].includes(String(x.key)) ? (x.key as 'depth' | 'z0' | 'fillet' | 'chamfer' | 'shell') : null, v = n('value'); if (!known.bodies.includes(id) || !key || v === null) { bad('unknown body, key or value'); break; } act = { type: t, id, key, value: v }; critical = key !== 'z0'; break; }
      case 'scale': { const sx = n('sx', 1e-4, 1e4), sy = n('sy', 1e-4, 1e4); if (sx === null || sy === null) { bad('scale factors 0.0001 to 10000'); break; } act = { type: t, sx, sy, keepHoles: x.keepHoles !== false }; critical = true; break; }
      case 'mirrorCopy': { const ax = x.axis === 'x' ? 'x' : x.axis === 'y' ? 'y' : null, at = n('at') ?? 0; if (!ax) { bad('axis must be x or y'); break; } act = { type: t, axis: ax, at }; break; }
      case 'filletAll': { const p = S(x.profile, 64), r = n('r', 0.001, 1e5); if (!known.ents.includes(p) || r === null) { bad('unknown outline or radius'); break; } act = { type: t, profile: p, r }; break; }
      case 'setMaterial': { const m = S(x.material, 60); if (!known.materials.includes(m)) { bad(`material "${m}" is not in the materials list`); break; } act = { type: t, material: m }; critical = true; break; }
      case 'insertLibrary': { const f = S(x.familyId, 40); if (!known.families.includes(f)) { bad(`library family "${f}" does not exist`); break; } act = { type: t, familyId: f, view: x.view === 'side' ? 'side' : 'top' }; break; }
      case 'note': { const s = S(x.text, 300); if (s) act = { type: t, text: s }; break; }
      default: bad('not an allowed action');
    }
    if (act) steps.push({ action: act, why, critical });
  }
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((s) => S(s, max)).filter(Boolean).slice(0, 20);
  return { reply: S(j.reply, 1500), steps, suggestions: list(j.suggestions, 500), questions: list(j.questions, 300), dropped };
}
