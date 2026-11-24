import type { Pt } from '../core/types.ts';
import type { Body, Ent, Reference, StudioDoc } from './model.ts';
import { uid } from './model.ts';
import type { AiAction, AiAssist, AiDrawing, AiStep } from '../../api/_lib/aiStudio.ts';
import { ASSIST_PROMPT, parseAssist } from '../../api/_lib/aiStudio.ts';
import { boxOf, dist, geometryEnts, mirrorAff, transformEnt } from './geom.ts';
import { cornerPoly } from './edit.ts';
import { findLoops, loopInside } from './profiles.ts';
import { applyParam, detectParams, scaleXY } from './params.ts';
import type { Param } from './params.ts';
import { generate, insertLibrary, regenerate } from './features.ts';
import type { Built } from './solid.ts';
import { MATERIALS } from '../data/materials.ts';
import { FAMILIES } from '../families/index.ts';
import { toMm } from './compare.ts';

/* The Design Studio assistant. An instruction (typed by the engineer) becomes a list of ALLOWED design actions, made either by the
 * built-in command reader (no AI needed, works offline) or by the AI service. The actions are applied to a COPY for the preview;
 * the engineer accepts or rejects each one. Advice is always labelled as a suggestion, never as an engineering approval. */

export type { AiAction, AiAssist, AiStep };

/** Compact description of the design for the AI (ids, sizes, parameters). */
export function contextFor(d: StudioDoc, selection: string[]): string {
  const params = detectParams(d).slice(0, 120).map((p) => ({ id: p.id, group: p.group, label: p.label, value: p.value, unit: p.unit }));
  const { loops } = findLoops(d);
  const outlines = loops.slice(0, 60).map((l) => { const b = boxOf(d.ents.filter((e) => l.ids.includes(e.id))); return { id: l.ids[0], kind: l.circle ? `circle Ø${+(2 * l.circle.r).toFixed(3)}` : 'outline', box: [b.x0, b.y0, b.x1, b.y1].map((v) => +v.toFixed(2)), areaMm2: +l.area.toFixed(1) }; });
  return JSON.stringify({
    name: d.name, componentType: d.componentType, material: d.material, selection: selection.slice(0, 30),
    outlines, parameters: params,
    bodies: d.bodies.map((b) => ({ id: b.id, name: b.name, op: b.op, mode: b.mode, profile: b.profile, z0: b.z0, depth: b.depth, fillet: b.fillet ?? 0, chamfer: b.chamfer ?? 0, shell: b.shell ?? 0 })),
    materials: MATERIALS.map((m) => m.id), libraryFamilies: FAMILIES.map((f) => `${f.id} (${f.name})`).slice(0, 60),
  });
}
export const assistPrompt = (d: StudioDoc, selection: string[], instruction: string): string => ASSIST_PROMPT(contextFor(d, selection), instruction);
export function knownIds(d: StudioDoc) {
  return { params: detectParams(d).map((p) => p.id), ents: d.ents.map((e) => e.id), bodies: d.bodies.map((b) => b.id), materials: MATERIALS.map((m) => m.id), families: FAMILIES.map((f) => f.id) };
}
export const readAssist = (d: StudioDoc, text: string): AiAssist | { error: string } => parseAssist(text, knownIds(d));

/* ---------- built-in command reader ---------- */
const NUM = '(-?\\d+(?:\\.\\d+)?)';
function mainOutline(d: StudioDoc, selection: string[]): { id: string; box: ReturnType<typeof boxOf>; centre: Pt } | null {
  const { loops } = findLoops(d);
  const sel = loops.find((l) => l.ids.some((x) => selection.includes(x)));
  const outer = sel ?? loops.filter((l) => !loops.some((o) => o !== l && loopInside(l, o))).sort((a, b) => b.area - a.area)[0];
  if (!outer) return null;
  const box = boxOf(d.ents.filter((e) => outer.ids.includes(e.id)));
  return { id: outer.ids[0], box, centre: outer.circle ? outer.circle.c : [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] };
}
function findParam(ps: Param[], words: string): Param | null {
  const w = words.toLowerCase().replace(/\b(the|a|an|of|plate|part|component|value)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const rules: [RegExp, (p: Param) => boolean][] = [
    [/(centre|center|middle) hole|bore/, (p) => /bore|centre hole/i.test(p.label) || (p.origin === 'library' && /^bore\b/i.test(p.label))],
    [/outer|outside|od\b|overall diameter/, (p) => /outer diameter|outside diameter/i.test(p.label)],
    [/thick|depth/, (p) => /thickness|extrude depth|cut depth/i.test(p.label)],
    [/teeth|tooth/, (p) => /teeth/i.test(p.label)],
    [/pitch circle|pcd|bolt circle/, (p) => /pitch circle/i.test(p.label)],
    [/number of holes|hole count|holes/, (p) => /number of (equally spaced )?holes/i.test(p.label)],
    [/hole (dia|diameter|size)|holes? dia/, (p) => /diameter of \d+ equal circles|hole diameter|circle diameter/i.test(p.label)],
    [/width|height/, (p) => /overall width/i.test(p.label)],
    [/length/, (p) => /overall length/i.test(p.label)],
    [/wall/, (p) => /wall thickness/i.test(p.label)],
    [/fillet|radius/, (p) => /fillet|radius/i.test(p.label)],
  ];
  for (const [re, f] of rules) if (re.test(w)) { const hit = ps.find(f); if (hit) return hit; }
  return ps.find((p) => p.label.toLowerCase().includes(w)) ?? null;
}

/** "increase the thickness to 8 mm", "reduce the length by 10%", "make the centre hole 35 mm" -> [_, what, 'to'|'by', number, unit] */
function valueChange(low: string): RegExpMatchArray | null {
  const a = low.match(new RegExp(`(?:increase|decrease|reduce|enlarge|set|change|make|update)\\s+(?:the\\s+)?(.+?)\\s+(to|by)\\s+${NUM}\\s*(mm|%|percent|°|deg)?`));
  if (a) return a;
  const b = low.match(new RegExp(`(?:set|make|change)\\s+(?:the\\s+)?(.+?)\\s*(?:=|:)?\\s*${NUM}\\s*(mm|°|deg)?\\s*$`));
  if (!b) return null;
  const out = [b[0], b[1], 'to', b[2], b[3] ?? ''] as unknown as RegExpMatchArray;
  return out;
}
/** Reads common instructions without AI. Unknown sizes are asked for, never invented. */
export function localPlan(d: StudioDoc, instruction: string, selection: string[], built: Built | null): AiAssist {
  const t = instruction.trim().replace(/,(\d)/g, '.$1');
  const low = t.toLowerCase();
  const steps: AiStep[] = [], questions: string[] = [], suggestions: string[] = [];
  const ps = detectParams(d);
  const mo = mainOutline(d, selection);
  const reply: string[] = [];
  let m: RegExpMatchArray | null;
  // holes
  if ((m = low.match(new RegExp(`add ${NUM} (?:equally spaced |equal )?holes?`)))) {
    const n = Number(m[1]);
    const dia = low.match(new RegExp(`(?:Ø|dia(?:meter)?\\.?|of|size)\\s*${NUM}\\s*(?:mm)?`, 'i')) ?? t.match(new RegExp(`Ø\\s*${NUM}`));
    const pcd = low.match(new RegExp(`(?:pcd|pitch circle(?: diameter)?|bolt circle(?: diameter)?|on a circle(?: of)?)\\s*(?:of\\s*)?${NUM}`));
    const centre = mo?.centre ?? [0, 0];
    if (!dia) questions.push(`What diameter should the ${n} holes have (mm)?`);
    let p = pcd ? Number(pcd[1]) : null;
    if (p === null && mo) { const bore = ps.find((x) => /centre hole/i.test(x.label)); const R = Math.min(mo.box.x1 - mo.box.x0, mo.box.y1 - mo.box.y0) / 2; if (!bore) questions.push(`On which pitch circle diameter (PCD) should the ${n} holes be? The outline is ${+(2 * R).toFixed(2)} mm across.`); else questions.push(`On which pitch circle diameter (PCD) should the ${n} holes be? (centre hole Ø${bore.value}, outline ${+(2 * R).toFixed(2)} mm across)`); }
    if (dia && p !== null) steps.push({ action: { type: 'addHolePattern', n, d: Number(dia[1]), pcd: p, cx: centre[0], cy: centre[1], start: 0 }, why: `${n} holes Ø${dia[1]} equally spaced on PCD ${p}, centred on the main outline.`, critical: false });
  }
  // set / change a value
  else if ((m = valueChange(low))) {
    const p = findParam(ps, m[1]);
    if (!p) questions.push(`I could not find "${m[1]}" in this design. Pick the value in the Parameters list, or name it as it is listed there.`);
    else {
      const v = Number(m[3]), rel = m[2] === 'by', pc = m[4] === '%' || m[4] === 'percent';
      const sgn = /decrease|reduce/.test(low) ? -1 : 1;
      const nv = rel ? (pc ? p.value * (1 + (sgn * v) / 100) : p.value + sgn * v) : v;
      steps.push({ action: { type: 'setParam', id: p.id, value: +nv.toFixed(6) }, why: `${p.group} - ${p.label}: ${p.value} → ${+nv.toFixed(6)}`, critical: /bore|thickness|wall|depth|shaft/i.test(p.label) });
    }
  }
  // 2D -> 3D
  else if (/(convert|turn|make).*(3d|3-d|solid|model)|^extrude/.test(low)) {
    if (!mo) questions.push('There is no closed outline to make a 3D model from. Draw or close an outline first.');
    else if (/revolve|turned|shaft|roller/.test(low)) {
      const axis = d.ents.find((e) => e.style === 'centre' && e.k === 'line');
      if (!axis || axis.k !== 'line') questions.push('Which line is the axis of the turned part? Draw a centre line (Centre-line tool) on the axis first.');
      else { const horiz = Math.abs(axis.a[1] - axis.b[1]) < Math.abs(axis.a[0] - axis.b[0]); steps.push({ action: { type: 'revolve', profile: mo.id, axis: horiz ? 'x' : 'y', at: horiz ? axis.a[1] : axis.a[0] }, why: 'Revolve the main outline about the centre line.', critical: false }); }
    } else {
      const dep = low.match(new RegExp(`(?:thick(?:ness)?|depth|extrude(?: by)?|height)\\s*(?:of\\s*)?${NUM}`)) ?? low.match(new RegExp(`${NUM}\\s*mm\\s*thick`));
      if (!dep) questions.push('How thick should the part be (mm)? The drawing does not say, so I will not guess.');
      else steps.push({ action: { type: 'extrude', profile: mo.id, depth: Number(dep[1]), z0: 0 }, why: `Extrude the main outline ${dep[1]} mm; holes inside it go through.`, critical: true });
    }
  }
  // symmetric
  else if (/symmetr|mirror/.test(low)) {
    const ax = /(vertical|y axis|y-axis|left.*right)/.test(low) ? 'y' : /(horizontal|x axis|x-axis|top.*bottom)/.test(low) ? 'x' : null;
    if (!ax || !mo) questions.push('About which centre line: the vertical one (left/right mirror) or the horizontal one (top/bottom mirror)?');
    else steps.push({ action: { type: 'mirrorCopy', axis: ax, at: ax === 'y' ? mo.centre[0] : mo.centre[1] }, why: `Mirror copy of the ${selection.length ? 'selected items' : 'drawing'} about the ${ax === 'y' ? 'vertical' : 'horizontal'} centre line of the outline.`, critical: false });
  }
  // fillets
  else if ((m = low.match(new RegExp(`(?:fillet|round)[^\\d]*${NUM}`)))) {
    const poly = d.ents.find((e) => (selection.length ? selection.includes(e.id) : true) && e.k === 'poly' && e.closed);
    if (!poly) questions.push('Select the closed polyline whose corners should be rounded.');
    else steps.push({ action: { type: 'filletAll', profile: poly.id, r: Number(m[1]) }, why: `Round every straight corner of the outline with R${m[1]}.`, critical: false });
  }
  // scale
  else if ((m = low.match(new RegExp(`scale\\s*(x|y|xy)?\\s*(?:by|to)?\\s*${NUM}\\s*(%)?`)))) {
    let f = Number(m[2]); if (m[3]) f = f / 100;
    steps.push({ action: { type: 'scale', sx: m[1] === 'y' ? 1 : f, sy: m[1] === 'x' ? 1 : f, keepHoles: /keep/.test(low) }, why: `Scale ${m[1] === 'x' ? 'along X' : m[1] === 'y' ? 'along Y' : 'in X and Y'} by ${f}.`, critical: true });
  }
  // material
  else if ((m = low.match(/material (?:to |is |=)?(.+)$/))) {
    const want = m[1].replace(/[^a-z0-9]/g, '');
    const mat = MATERIALS.find((x) => x.id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(want) || want.includes(x.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)));
    if (!mat) questions.push(`"${m[1]}" is not in the materials list: ${MATERIALS.map((x) => x.id).join(', ')}.`);
    else steps.push({ action: { type: 'setMaterial', material: mat.id }, why: `Material ${mat.id} (density ${mat.density * 1e6} g/cm³).`, critical: true });
  }
  // library shaft with bearing seats
  else if (/shaft/.test(low) && /bearing/.test(low)) {
    steps.push({ action: { type: 'insertLibrary', familyId: 'shaft', view: 'side' }, why: 'Stepped shaft from the library: the two end steps are the bearing seats. Set the diameters and lengths in Parameters.', critical: false });
  }
  if (/suggest|improve|recommend|reduce material|lighter|weight|optimi[sz]e|check/.test(low)) suggestions.push(...designAdvice(d, built));
  if (!steps.length && !questions.length && !suggestions.length) reply.push('The built-in reader did not understand this. Try for example: "set the centre hole to 35", "add 12 holes Ø10 on PCD 150", "increase thickness to 8", "convert to 3D, thickness 6", "fillet corners 5", "suggest improvements". With an AI service switched on in Settings, free wording is understood too.');
  else reply.push(steps.length ? `Proposed ${steps.length} change(s). Review them in the preview, then accept or reject.` : questions.length ? 'I need more information first.' : 'Here are some suggestions.');
  return { reply: reply.join(' '), steps, suggestions, questions, dropped: [] };
}

/* ---------- applying actions ---------- */
export interface StepResult { ok: boolean; msg: string }
export function applySteps(d0: StudioDoc, steps: AiStep[], selection: string[]): { doc: StudioDoc; results: StepResult[] } {
  let d = d0; const results: StepResult[] = [];
  for (const s of steps) {
    try { const r = applyAction(d, s.action, selection); if (r.ok) { d = r.doc; results.push({ ok: true, msg: r.note ?? 'Done.' }); } else results.push({ ok: false, msg: r.error }); }
    catch (e) { results.push({ ok: false, msg: `Could not apply (${e instanceof Error ? e.message : String(e)}).` }); }
  }
  return { doc: d, results };
}
type R = { ok: true; doc: StudioDoc; note?: string } | { ok: false; error: string };
function addFeature(d: StudioDoc, f: Parameters<typeof regenerate>[1]): R { const g = generate(f); if (g.error) return { ok: false, error: g.error }; return { ok: true, doc: regenerate(d, f).doc }; }
export function applyAction(d: StudioDoc, a: AiAction, selection: string[]): R {
  switch (a.type) {
    case 'setParam': { const r = applyParam(d, a.id, a.value); return r.ok ? { ok: true, doc: r.doc, note: r.note } : r; }
    case 'addHolePattern': return addFeature(d, { id: uid('f'), t: 'holePattern', c: [a.cx, a.cy], pcd: a.pcd, n: a.n, d: a.d, start: a.start });
    case 'addGridHoles': return addFeature(d, { id: uid('f'), t: 'gridHoles', x0: a.x0, y0: a.y0, nx: a.nx, ny: a.ny, dx: a.dx, dy: a.dy, d: a.d });
    case 'addSlot': return addFeature(d, { id: uid('f'), t: 'slot', c: [a.cx, a.cy], len: a.len, w: a.w, ang: a.ang });
    case 'addPolygon': return addFeature(d, { id: uid('f'), t: 'polygon', c: [a.cx, a.cy], n: a.n, r: a.r, ang: 0 });
    case 'addCircle': return { ok: true, doc: { ...d, ents: [...d.ents, { id: uid(), layer: 'L0', source: 'ai', confirmed: true, k: 'circle', c: [a.cx, a.cy], r: a.d / 2 }] } };
    case 'addRect': return { ok: true, doc: { ...d, ents: [...d.ents, { id: uid(), layer: 'L0', source: 'ai', confirmed: true, k: 'poly', closed: true, pts: [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]] }] } };
    case 'extrude': case 'revolve': {
      const b: Body = a.type === 'extrude'
        ? { id: uid('b'), name: `Body ${d.bodies.length + 1}`, op: 'extrude', profile: a.profile, z0: a.z0, depth: a.depth, mode: d.bodies.length ? 'add' : 'new', material: d.material, color: '#8d96a0', visible: true }
        : { id: uid('b'), name: `Body ${d.bodies.length + 1}`, op: 'revolve', profile: a.profile, z0: 0, depth: 0, axis: a.axis, axisAt: a.at, angle: 360, mode: d.bodies.length ? 'add' : 'new', material: d.material, color: '#8d96a0', visible: true };
      return { ok: true, doc: { ...d, bodies: [...d.bodies, b] } };
    }
    case 'setBody': { const b = d.bodies.find((x) => x.id === a.id); if (!b) return { ok: false, error: '3D body not found.' }; if (a.key === 'depth' && a.value <= 0) return { ok: false, error: 'Depth must be above 0.' }; if (a.key !== 'z0' && a.value < 0) return { ok: false, error: 'Value cannot be negative.' }; return { ok: true, doc: { ...d, bodies: d.bodies.map((x) => (x.id === a.id ? { ...x, [a.key]: a.value } : x)) } }; }
    case 'scale': { const r = scaleXY(d, selection.length ? selection : null, a.sx, a.sy, a.keepHoles); return r.ok ? { ok: true, doc: r.doc, note: r.note } : r; }
    case 'mirrorCopy': {
      const src = (selection.length ? d.ents.filter((e) => selection.includes(e.id)) : geometryEnts(d)).filter((e) => e.k !== 'dim');
      if (!src.length) return { ok: false, error: 'Nothing to mirror.' };
      const m = a.axis === 'y' ? mirrorAff([a.at, 0], [a.at, 1]) : mirrorAff([0, a.at], [1, a.at]);
      const copies: Ent[] = src.map((e) => ({ ...transformEnt(e, m), id: uid(), feature: undefined, source: e.source === 'feature' || e.source === 'library' ? 'drawn' : e.source }));
      // copies lying exactly on an existing item are skipped
      const fresh = copies.filter((c) => !d.ents.some((e) => e.k === c.k && JSON.stringify(roundEnt(e)) === JSON.stringify(roundEnt({ ...c, id: e.id }))));
      return { ok: true, doc: { ...d, ents: [...d.ents, ...fresh] }, note: `${fresh.length} mirrored item(s) added.` };
    }
    case 'filletAll': {
      let e = d.ents.find((x) => x.id === a.profile); if (!e || e.k !== 'poly') return { ok: false, error: 'Pick a polyline outline.' };
      let done = 0, i = 0, guard = 0;
      while (e && e.k === 'poly' && i < e.pts.length && guard++ < 2000) {
        const r = cornerPoly(e, i, a.r, 'fillet');
        if (r.ok) { const ne = r.add[0]; e = { ...ne, id: e.id } as Ent; done++; i += 2; } else i++;
      }
      if (!done) return { ok: false, error: `No corner could take R${a.r}.` };
      return { ok: true, doc: { ...d, ents: d.ents.map((x) => (x.id === a.profile ? e! : x)) }, note: `${done} corner(s) rounded.` };
    }
    case 'setMaterial': return { ok: true, doc: { ...d, material: a.material, bodies: d.bodies.map((b) => ({ ...b, material: a.material })) } };
    case 'insertLibrary': { const r = insertLibrary(d, a.familyId, {}, 'beside', a.view, true); return r.error ? { ok: false, error: r.error } : { ok: true, doc: r.doc }; }
    case 'note': return { ok: true, doc: { ...d, notes: [...d.notes, a.text].slice(-50) } };
  }
}
function roundEnt(e: Ent): unknown { return JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v))); }

/* ---------- design advice (rule based; suggestions only) ---------- */
export function designAdvice(d: StudioDoc, built: Built | null): string[] {
  const out: string[] = [];
  const { loops } = findLoops(d);
  const outers = loops.filter((l) => !loops.some((o) => o !== l && loopInside(l, o)));
  for (const o of outers) {
    const holes = loops.filter((l) => l !== o && loopInside(l, o) && l.circle);
    for (const h of holes) {
      const c = h.circle!;
      let edge = Infinity; for (let i = 0; i < o.pts.length; i++) { const p = o.pts[i], q = o.pts[(i + 1) % o.pts.length]; const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((c.c[0] - p[0]) * dx + (c.c[1] - p[1]) * dy) / L2)) : 0; edge = Math.min(edge, Math.hypot(c.c[0] - p[0] - dx * t, c.c[1] - p[1] - dy * t)); }
      const lig = edge - c.r;
      if (lig < Math.max(1.5, c.r)) { out.push(`Suggestion: the edge distance of hole Ø${+(2 * c.r).toFixed(2)} is ${+lig.toFixed(2)} mm (less than about one hole radius). Consider moving it inwards or making the part wider; thin edges can tear under load.`); break; }
    }
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) { const a = holes[i].circle!, b = holes[j].circle!, gap = dist(a.c, b.c) - a.r - b.r; if (gap < Math.max(1.5, Math.min(a.r, b.r))) { out.push(`Suggestion: two holes are only ${+gap.toFixed(2)} mm apart. A wider web between holes is stronger and easier to make.`); i = holes.length; break; } }
    const solid = o.area - holes.reduce((s, h) => s + h.area, 0);
    if (!holes.length && o.area > 40000) out.push('Suggestion: the plate has no holes. If its load allows, lightening holes or pockets can save material and weight; check stiffness after any change.');
    else if (solid / o.area > 0.9 && o.area > 40000) out.push('Suggestion: more than 90% of the outline is solid material. Pockets or lightening holes away from load paths could reduce weight.');
  }
  const sharp = d.ents.filter((e) => e.k === 'poly' && e.closed && !e.bulge?.some((b) => b !== 0) && e.pts.length >= 3).length;
  if (sharp) out.push(`Suggestion: ${sharp} outline(s) have sharp corners. Internal corners cause stress concentration, and milled pockets cannot have sharp inside corners: add fillets (a radius at least the cutter radius).`);
  for (const b of d.bodies) if (b.op === 'extrude' && b.mode !== 'cut' && b.depth < 2) out.push(`Suggestion: body "${b.name}" is only ${b.depth} mm thick. Check stiffness and whether this thickness is available as sheet/plate.`);
  if (built && built.mass > 0) out.push(`Information: the model mass is ${built.mass.toFixed(3)} kg in ${d.material}. Changing to a plastic (UHMW-PE, POM, PA6) or aluminium changes mass and strength a lot; check the load first.`);
  out.push('Manufacturing: flat parts with holes suit laser/waterjet cutting or punching; turned parts suit a lathe; plastic conveyor parts in volume suit injection moulding (needs draft angles and even wall thickness).');
  out.push('These are suggestions from simple rules, not an engineering check. Strength, fits, tolerances and load ratings must be confirmed by an engineer.');
  return out;
}

/* ---------- AI drawing reading -> unconfirmed geometry ---------- */
/** Places the AI's reading on the reference: geometry becomes UNCONFIRMED items on the import layer, written dimensions become detected values. */
export function drawingToDoc(d: StudioDoc, refId: string, dr: AiDrawing, layer: string): { doc: StudioDoc; added: number } {
  const ref = d.refs.find((r) => r.id === refId); if (!ref) return { doc: d, added: 0 };
  const k = ref.pxW / 1000; // AI units are thousandths of the picture width
  const P = (p: [number, number]): Pt => toMm(ref, [p[0] * k, p[1] * k]);
  const s = k * ref.mmPerPx;
  const base = { layer, source: 'ai' as const, confirmed: false, refId: ref.id };
  const ents: Ent[] = [];
  for (const e of dr.entities) {
    if (e.t === 'line') ents.push({ ...base, id: uid('a'), k: 'line', a: P(e.a), b: P(e.b) });
    else if (e.t === 'circle') ents.push({ ...base, id: uid('a'), k: 'circle', c: P(e.c), r: e.r * s });
    else if (e.t === 'arc') ents.push({ ...base, id: uid('a'), k: 'arc', c: P(e.c), r: e.r * s, a0: (e.a0 * Math.PI) / 180, a1: (e.a1 * Math.PI) / 180 });
    else ents.push({ ...base, id: uid('a'), k: 'poly', closed: e.closed, pts: e.pts.map(P) });
  }
  const detected = dr.dimensions.map((x) => ({ id: uid('t'), text: x.text, value: x.value, unit: x.kind === 'angle' ? 'deg' : x.kind === 'count' ? 'count' : 'mm', kind: x.kind, px: x.at[0] * k, py: x.at[1] * k, from: 'ai' as const, confidence: x.confidence, status: 'detected' as const }));
  const notes = [`AI reading of "${ref.name}": ${dr.partType}${dr.material !== 'unknown' ? `, material ${dr.material}` : ''}. ${dr.notes}`.trim(), ...dr.missing.map((m) => `Missing on the drawing: ${m}`)];
  const refs: Reference[] = d.refs.map((r) => (r.id === refId ? { ...r, detected: [...r.detected, ...detected] } : r));
  return { doc: { ...d, ents: [...d.ents, ...ents], refs, notes: [...d.notes, ...notes].slice(-60) }, added: ents.length };
}
