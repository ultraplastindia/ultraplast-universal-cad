import type { Family, Variant } from '../../core/family.ts';
import type { CalcResult, ParamField, Params, Pt, Row } from '../../core/types.ts';
import type { GeoPart, Hole, Prim } from '../../core/prims.ts';
import { hexPoly, polyProps, rectPoly } from '../../core/prims.ts';
import { primsSolid } from '../../core/primsSolid.ts';
import { circlePts } from '../../core/geom.ts';
import { geoView } from '../../core/project.ts';
import type { ViewId } from '../../core/project.ts';
import type { AsmInfo } from '../../core/asminfo.ts';
import type { DrawView, ModelEnt } from '../../cad2d/sheet.ts';
import { fmt, num } from '../../core/util.ts';
import { ROLLER_CHAINS } from '../../data/chains.ts';
import { R, dim, done, failed } from './common.ts';
import { f2, isCustom, kd, MATERIAL_FIELDS, matInfo, V } from '../custom/custom.ts';

/* Dedicated models for the conveyor components that earlier had only a generic shape:
 *   modbelt (modular chain / belt), chainlink (roller / attachment / hollow-pin chain), brghousing (flange / pillow housing),
 *   coupling, collar, circlip, takeup (take-up / tensioning unit), lbracket (brackets, guards, stops, clamps, mounts),
 *   motor (motor / gearbox envelope), setscrew, greasenipple.
 * They are generic, standard-style parametric models built from the values typed in. They are NOT Ultraplast's own proprietary
 * chain or belt geometry. Every family keeps the same rules as the others: limits on every value, readable errors, and the
 * drawing, 3D model, STEP and mass all come from one description (GeoPart). */

const num0 = (p: Params, k: string): number => { const v = num(p, k); return Number.isFinite(v) ? v : NaN; };
const nm = (label: string, v: number, o: { min?: number; max?: number; int?: boolean } = {}): string | null => {
  if (!Number.isFinite(v)) return `${label}: enter a number.`;
  if (o.int && !Number.isInteger(v)) return `${label}: use a whole number.`;
  if (o.min !== undefined && v < o.min) return `${label}: ${fmt(v, 3)} is below the minimum of ${o.min}.`;
  if (o.max !== undefined && v > o.max) return `${label}: ${fmt(v, 3)} is above the maximum of ${o.max}.`;
  return null;
};
const check = (list: [string, number, { min?: number; max?: number; int?: boolean }?][]): string[] => list.map(([l, v, o]) => nm(l, v, o ?? {})).filter((x): x is string => !!x);
const fld = (key: string, label: string, unit: string, min: number, max: number, step = 0.1, extra: Partial<ParamField> = {}): ParamField => ({ key, label, unit, kind: 'number', min, max, step, ...extra } as ParamField);
const sel = (key: string, label: string, opts: [string, string][], extra: Partial<ParamField> = {}): ParamField => ({ key, label, kind: 'select', options: opts.map(([value, l]) => ({ value, label: l })), ...extra } as ParamField);

/** volume of the solid primitives in mm^3 (overlaps are counted twice, so this is approximate for parts made of touching prims) */
export function geoVolume(parts: GeoPart[]): number {
  let v = 0;
  for (const g of parts) for (const q of g.prims) {
    if (q.kind === 'tube') v += Math.PI * (q.rOut * q.rOut - q.rIn * q.rIn) * (q.z1 - q.z0);
    else if (q.kind === 'sphere') v += (4 / 3) * Math.PI * q.r ** 3;
    else v += (polyProps(q.outer).A - q.holes.reduce((a, h) => a + ('poly' in h ? polyProps(h.poly).A : Math.PI * h.r * h.r), 0)) * (q.z1 - q.z0);
  }
  return v;
}
const circ = (c: Pt, r: number): Hole => ({ c, r });
const prism = (outer: Pt[], z0: number, z1: number, holes: Hole[] = []): Prim => ({ kind: 'prism', outer, holes, z0, z1 });
const tube = (rIn: number, rOut: number, z0: number, z1: number): Prim => ({ kind: 'tube', rIn, rOut, z0, z1 });
const part = (id: string, name: string, color: string, prims: Prim[]): GeoPart => ({ id, name, color, prims, explode: [0, 0, 0] });
/** a stadium (slot with round ends) along X */
const stadium = (cx: number, cy: number, len: number, w: number): Pt[] => {
  const r = w / 2, a = Math.max(0, len - w) / 2, pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 10; pts.push([cx + a + r * Math.cos(t), cy + r * Math.sin(t)]); }
  for (let i = 0; i <= 10; i++) { const t = Math.PI / 2 + (Math.PI * i) / 10; pts.push([cx - a + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
};
const bounds = (parts: GeoPart[]) => {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  const add = (x: number, y: number, z: number) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); };
  for (const g of parts) for (const q of g.prims) {
    if (q.kind === 'tube') { add(-q.rOut, -q.rOut, q.z0); add(q.rOut, q.rOut, q.z1); }
    else if (q.kind === 'sphere') { add(q.c[0] - q.r, q.c[1] - q.r, q.c[2] - q.r); add(q.c[0] + q.r, q.c[1] + q.r, q.c[2] + q.r); }
    else for (const [x, y] of q.outer) { add(x, y, q.z0); add(x, y, q.z1); }
  }
  return b;
};

/* ---------- the shared family builder ---------- */
interface Built { inputs: Row[]; errors: string[]; geo?: GeoPart[]; rows?: Row[]; assumptions?: string[]; warnings?: string[]; dims?: Partial<Record<ViewId, ModelEnt[]>>; key?: Row[]; notes?: string[]; asm?: AsmInfo; noMass?: boolean }
interface Spec {
  id: string; name: string; category: string; subcategory: string; description: string; keywords: string[]; applications: string[]; standards: string[];
  fields: ParamField[]; defaults: Params; variants: Variant[]; related?: string[];
  build: (p: Params, mi: { density: number; color: string; id: string }) => Built;
  partNo: (p: Params) => string;
}
interface Derived { massKg?: number; geo: GeoPart[]; dims: Partial<Record<ViewId, ModelEnt[]>>; key: Row[]; notes: string[]; asm: AsmInfo }
function family(s: Spec): Omit<Family, 'basic' | 'autofill'> {
  const calculate = (p: Params): CalcResult => {
    const mi = matInfo(p);
    if (typeof mi === 'string') return failed([R('Material', String(p.material))], [mi], s.standards);
    let b: Built;
    try { b = s.build(p, mi); } catch { return failed([], ['These values cannot be turned into a shape. Check the sizes.'], s.standards); }
    if (b.errors.length || !b.geo) return failed(b.inputs, b.errors, s.standards);
    const vol = geoVolume(b.geo), mass = vol * mi.density, bb = bounds(b.geo);
    const rows = [...(b.rows ?? []), R('Overall size', `${fmt(bb.x1 - bb.x0, 1)} x ${fmt(bb.y1 - bb.y0, 1)} x ${fmt(bb.z1 - bb.z0, 1)}`, 'mm'), ...(b.noMass ? [] : [R('Approx. mass', mass, 'kg', 3)])];
    const d: Derived = { massKg: b.noMass ? undefined : mass, geo: b.geo, dims: b.dims ?? {}, key: [...(b.key ?? []), ...(b.noMass ? [] : [{ label: 'Approx. mass', value: f2(mass), unit: 'kg' }])], notes: b.notes ?? [], asm: b.asm ?? { role: 'other' } };
    return done(b.inputs, rows, [...(b.assumptions ?? []), 'Generic standard-style shape from the typed values; not a manufacturer\'s proprietary geometry.', ...(b.noMass ? [] : ['Mass = volume of the modelled solids x density (overlapping solids are counted twice, so treat it as approximate).'])], b.warnings ?? [], s.standards, d);
  };
  const views = (d: Derived): DrawView[] => (['front', 'top', 'right'] as ViewId[]).map((v) => { const gv = geoView(d.geo, v); return { ...gv, ents: [...gv.ents, ...(d.dims[v] ?? [])] }; }).concat([geoView(d.geo, 'iso')]);
  return {
    id: s.id, name: s.name, category: s.category, subcategory: s.subcategory, description: s.description, keywords: s.keywords, materials: [], applications: s.applications, standards: s.standards, related: s.related ?? [],
    fields: s.fields, defaults: s.defaults, variants: s.variants, calculate, views, geo: (d: Derived) => d.geo, solid: (Rr: unknown, d: Derived) => primsSolid(Rr, d.geo), asm: (d: Derived) => d.asm,
    partNo: s.partNo, materialOf: (p) => (isCustom(p) ? `Custom ${f2(num(p, 'density'))} g/cm3` : String(p.material)), keyDims: (d: Derived) => d.key, notes: (d: Derived) => [...d.notes, 'ALL DIMENSIONS IN MM UNLESS STATED'],
  } as Omit<Family, 'basic' | 'autofill'>;
}
const STEEL = '#9aa3ad';
/** a dimension whose first number is always the true distance between its anchor points */
const D = (a: [number, number], b: [number, number], off: number, text: string): ModelEnt => dim(a, b, off, text.replace(/-?\d+(?:\.\d+)?/, fmt(Math.hypot(b[0] - a[0], b[1] - a[1]), 2)));

/* ======================= 1. Modular chain / belt ======================= */
const MB_STYLES: [string, string][] = [['flat', 'Flat top (closed surface)'], ['grid', 'Open / flush grid (slots)'], ['perforated', 'Perforated (round holes)'], ['friction', 'Friction top (rubber layer)'], ['rollertop', 'Roller / ball top'], ['cleated', 'Cleated (flights)'], ['ribbed', 'Ribbed (rails along the belt)']];
const MB_FIELDS: ParamField[] = [
  sel('style', 'Surface style', MB_STYLES),
  fld('pitch', 'Pitch (hinge to hinge)', 'mm', 10, 100, 0.01), fld('width', 'Belt / chain width', 'mm', 20, 2000, 1), fld('modules', 'Number of modules along the length', '', 1, 40, 1),
  fld('thickness', 'Module thickness', 'mm', 2.5, 40, 0.1), fld('pinDia', 'Hinge rod diameter', 'mm', 2, 14, 0.1),
  fld('openW', 'Slot width / hole diameter / rail width / ball diameter (style dependent)', 'mm', 0, 60, 0.1, { showIf: (p) => ['grid', 'perforated', 'ribbed', 'rollertop'].includes(String(p.style)) }),
  fld('openPitch', 'Spacing of slots, holes, rails or balls across the width', 'mm', 0, 200, 0.5, { showIf: (p) => ['grid', 'perforated', 'ribbed', 'rollertop'].includes(String(p.style)) }),
  fld('topH', 'Height above the surface (rubber layer, cleat, rail)', 'mm', 0, 100, 0.5, { showIf: (p) => ['friction', 'cleated', 'ribbed'].includes(String(p.style)) }),
  fld('every', 'A cleat on every n-th module', '', 1, 40, 1, { showIf: (p) => p.style === 'cleated' }),
  ...MATERIAL_FIELDS,
];
const mbDefaults: Params = { style: 'flat', pitch: 25.4, width: 300, modules: 8, thickness: 8, pinDia: 5, openW: 0, openPitch: 0, topH: 0, every: 4, material: 'Acetal POM', density: 1.41 };
function buildModBelt(p: Params, mi: { density: number; color: string; id: string }): Built {
  const st = String(p.style), pitch = num0(p, 'pitch'), W = num0(p, 'width'), n = num0(p, 'modules'), t = num0(p, 'thickness'), pd = num0(p, 'pinDia');
  const ow = num0(p, 'openW'), op = num0(p, 'openPitch'), th = num0(p, 'topH'), ev = num0(p, 'every');
  const inputs = [R('Style', st), R('Pitch', pitch, 'mm'), R('Width', W, 'mm'), R('Modules', n), R('Thickness', t, 'mm'), R('Hinge rod', pd, 'mm'), R('Material', String(p.material))];
  const errors = check([['pitch', pitch, { min: 10, max: 100 }], ['width', W, { min: 20, max: 2000 }], ['modules', n, { min: 1, max: 40, int: true }], ['thickness', t, { min: 2.5, max: 40 }], ['hinge rod diameter', pd, { min: 2, max: 14 }]]);
  if (!MB_STYLES.some((s) => s[0] === st)) errors.push('Choose one of the listed surface styles.');
  if (!errors.length && pd > t - 0.5) errors.push('The hinge rod must be at least 0.5 mm smaller than the module thickness.');
  const edge = Math.max(pd, 3);
  if (!errors.length && (st === 'grid' || st === 'perforated')) {
    errors.push(...check([['opening size', ow, { min: 1 }], ['opening spacing', op, { min: 2 }]]));
    if (!errors.length) {
      if (ow >= op - 1) errors.push('The opening size must be at least 1 mm smaller than the spacing between openings.');
      if (ow > pitch - 2 * edge - 1) errors.push(`The opening is too large for the module: it must be no more than ${fmt(pitch - 2 * edge - 1, 1)} mm so the hinge area stays solid.`);
      if (W - 2 * edge < op) errors.push('The belt is too narrow for this opening spacing.');
    }
  }
  if (!errors.length && (st === 'friction' || st === 'cleated' || st === 'ribbed')) errors.push(...check([['height above surface', th, { min: 0.5, max: 100 }]]));
  if (!errors.length && (st === 'ribbed' || st === 'rollertop')) { errors.push(...check([['rail / ball size', ow, { min: 1 }], ['spacing', op, { min: 2 }]])); if (!errors.length && ow >= op - 1) errors.push('The rail or ball size must be at least 1 mm smaller than its spacing.'); }
  if (!errors.length && st === 'cleated') errors.push(...check([['cleat spacing', ev, { min: 1, max: 40, int: true }]]));
  const L = pitch * n;
  const nAcross = (st === 'grid' || st === 'perforated') ? Math.floor((W - 2 * edge - ow) / op) + 1 : 0;
  const nAlong = st === 'perforated' ? Math.max(1, Math.floor((pitch - 2 * edge - ow) / op) + 1) : 1;
  if (!errors.length && nAcross * nAlong * n > 600) errors.push(`That would make ${nAcross * nAlong * n} openings (limit 600). Increase the spacing or use fewer modules.`);
  const nRib = st === 'ribbed' ? Math.max(1, Math.floor((W - ow) / op) + 1) : st === 'rollertop' ? Math.max(1, Math.floor((W - 2 * edge - ow) / op) + 1) : 0;
  if (!errors.length && st === 'rollertop' && nRib * n > 400) errors.push(`That would make ${nRib * n} balls (limit 400). Increase the spacing.`);
  if (errors.length) return { inputs, errors };
  const plates: Prim[] = [], tops: Prim[] = [], pins: Prim[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * pitch, holes: Hole[] = [];
    for (let k = 0; k < nAcross; k++) {
      const yc = edge + ow / 2 + k * op;
      if (st === 'grid') holes.push({ poly: rectPoly(x0 + edge, yc - ow / 2, x0 + pitch - edge, yc + ow / 2) });
      else for (let j = 0; j < nAlong; j++) holes.push(circ([x0 + edge + ow / 2 + j * op, yc], ow / 2));
    }
    plates.push(prism(rectPoly(x0, 0, x0 + pitch, W), 0, t, holes));
    if (st === 'cleated' && i % ev === 0) tops.push(prism(rectPoly(x0 + pitch * 0.4, 0, x0 + pitch * 0.6, W), t, t + th));
    if (st === 'rollertop') for (let k = 0; k < nRib; k++) tops.push({ kind: 'sphere', c: [x0 + pitch / 2, edge + ow / 2 + k * op, t], r: ow / 2 });
  }
  if (st === 'friction') tops.push(prism(rectPoly(0, 0, L, W), t, t + th));
  if (st === 'ribbed') for (let k = 0; k < nRib; k++) tops.push(prism(rectPoly(0, k * op, L, k * op + ow), t, t + th));
  for (let i = 0; i <= n; i++) pins.push(prism(rectPoly(i * pitch - pd / 2, 0, i * pitch + pd / 2, W), t / 2 - pd / 2, t / 2 + pd / 2));
  const geo = [part('modules', 'Modules', mi.color, plates), ...(tops.length ? [part('top', 'Surface layer / cleats / rails', st === 'friction' ? '#2b2b2b' : '#d6d3c4', tops)] : []), part('rods', 'Hinge rods', STEEL, pins)];
  const dims: Built['dims'] = { top: [D([0, -4], [L, -4], -10, `${fmt(L, 1)} (${n} x ${fmt(pitch, 2)} pitch)`), D([L, 0], [L, W], -14, fmt(W, 1))], front: [D([L, 0], [L, t], -10, fmt(t, 1))] };
  const warnings: string[] = [];
  if (W / pitch > 60) warnings.push('Very wide for the pitch; confirm the module makes this width in one piece or in brick-laid sections.');
  return { inputs, errors, geo, dims, rows: [R('Length', L, 'mm', 2), R('Pitch', pitch, 'mm', 3), ...(nAcross ? [R('Openings', nAcross * nAlong * n)] : []), ...(st === 'rollertop' ? [R('Balls', nRib * n)] : [])], warnings,
    assumptions: ['Modules are shown as flat plates side by side with a square-section hinge rod at each joint (the rod is drawn square because the model builds round rods only along the part axis). Hinge knuckles, side tabs and tooth drive pockets are not modelled.'],
    key: [kd('Length', L), kd('Width', W), kd('Pitch', pitch), kd('Thickness', t)], notes: [`${st.toUpperCase()} STYLE, ${n} MODULES AT ${f2(pitch)} PITCH`, 'GENERIC SHAPE - NOT MANUFACTURER GEOMETRY'] };
}
const mbV = (id: string, name: string, o: Params): Variant => V(id, name, { ...mbDefaults, ...o });

/* ======================= 2. Roller / attachment / hollow-pin chain ======================= */
const CH_FIELDS: ParamField[] = [
  sel('chain', 'Chain size (ISO 606 / ASME B29.1)', ROLLER_CHAINS.map((c) => [c.id, `${c.id} (${c.pitch} mm pitch)`])),
  fld('links', 'Number of links (2 to 60)', '', 2, 60, 1), sel('attach', 'Attachment', [['none', 'None'], ['k1', 'Flat attachment lugs (K1 style) on every 2nd outer link']]),
  sel('hollow', 'Pin type', [['solid', 'Solid pin'], ['hollow', 'Hollow pin (cross rods can pass through)']]), ...MATERIAL_FIELDS,
];
const chDefaults: Params = { chain: '08B-1', links: 12, attach: 'none', hollow: 'solid', material: 'C45 Steel', density: 7.85 };
function buildChain(p: Params, mi: { density: number; color: string; id: string }): Built {
  const c = ROLLER_CHAINS.find((x) => x.id === p.chain), n = num0(p, 'links'), at = String(p.attach), hollow = p.hollow === 'hollow';
  const inputs = [R('Chain', String(p.chain)), R('Links', n), R('Attachment', at), R('Pin', String(p.hollow)), R('Material', String(p.material))];
  const errors = check([['links', n, { min: 2, max: 60, int: true }]]);
  if (!c) errors.push('Choose a chain size from the list.');
  if (errors.length || !c) return { inputs, errors };
  const pt = c.pitch, d1 = c.rollerDia, iw = c.innerWidth, pinD = +(d1 * 0.5).toFixed(2), pth = Math.max(0.8, +(pt * 0.1).toFixed(2)), h = +(pt * 0.82).toFixed(2), g = 0.15;
  const zIA = pth + g, zRol0 = zIA + pth, zRol1 = zRol0 + iw, zIB1 = zRol1 + pth, zO2 = zIB1 + g, Zw = zO2 + pth;
  const plateOf = (x0: number, x1: number): Pt[] => {
    const r = h / 2, pts: Pt[] = [];
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 10; pts.push([x1 + r * Math.cos(a), r * Math.sin(a)]); }
    for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + (Math.PI * i) / 10; pts.push([x0 + r * Math.cos(a), r * Math.sin(a)]); }
    return pts;
  };
  const plates: Prim[] = [], lugs: Prim[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * pt, x1 = x0 + pt, inner = i % 2 === 0, hl = [circ([x0, 0], pinD / 2), circ([x1, 0], pinD / 2)];
    if (inner) { plates.push(prism(plateOf(x0, x1), zIA, zIA + pth, hl), prism(plateOf(x0, x1), zRol1, zIB1, hl));  }
    else {
      plates.push(prism(plateOf(x0, x1), 0, pth, hl), prism(plateOf(x0, x1), zO2, Zw, hl));
      if (at === 'k1' && Math.floor(i / 2) % 2 === 0) lugs.push(prism(rectPoly(x0 + pt * 0.05, h / 2 - 1, x1 - pt * 0.05, h / 2 + pt * 0.7), 0, pth, [circ([x0 + pt / 2, h / 2 + pt * 0.35], Math.min(pt * 0.18, pt * 0.35 - 0.5))]));
    }
  }
  // pins and rollers sit at different x positions, so they are built as circular prisms (rings) instead of origin-centred tubes
  const ring = (cx: number, rIn: number, rOut: number, z0: number, z1: number): Prim => prism(circlePts(rOut, 0, [cx, 0]), z0, z1, rIn > 0 ? [circ([cx, 0], rIn)] : []);
  const rolls: Prim[] = [], pinPrims: Prim[] = [];
  for (let j = 0; j <= n; j++) {
    pinPrims.push(ring(j * pt, hollow ? pinD * 0.28 : 0, pinD / 2, -0.4, Zw + 0.4));
    const innerAt = (j % 2 === 0 && j < n) || (j % 2 === 1 && j - 1 >= 0 && (j - 1) % 2 === 0);
    if (innerAt) rolls.push(ring(j * pt, pinD / 2, d1 / 2, zRol0, zRol1));
  }
  const geo = [part('plates', 'Link plates', mi.color, [...plates, ...lugs]), part('rollers', 'Rollers', '#b9c2cc', rolls), part('pins', 'Pins', STEEL, pinPrims)];
  const L = n * pt;
  return { inputs, errors, geo, rows: [R('Pitch', pt, 'mm', 3), R('Roller diameter', d1, 'mm', 3), R('Inner width', iw, 'mm', 3), R('Pin diameter (estimated)', pinD, 'mm', 2), R('Plate height (estimated)', h, 'mm', 2), R('Plate thickness (estimated)', pth, 'mm', 2), R('Chain length', L, 'mm', 2), R('Width over pins', Zw + 0.8, 'mm', 2)],
    dims: { top: [D([0, -h / 2 - 2], [L, -h / 2 - 2], -8, `${fmt(L, 1)} (${n} x ${fmt(pt, 3)})`), D([0, h / 2], [0, -h / 2], 8, fmt(h, 1))], front: [D([L, 0], [L, Zw], -8, fmt(Zw, 1))] },
    warnings: n % 2 === 1 ? ['An odd number of links needs an offset (cranked) link in a closed loop. Use an even number for an endless chain.'] : [],
    assumptions: [`Pitch, roller diameter and inner width are the standard values for ${c.id} (${c.std}). Pin diameter, plate height and plate thickness are estimated from the pitch because they are not in the stored table: check them against the maker's data sheet.`, 'Pins are shown without heads or split pins. Bushes are not drawn separately.'],
    key: [kd('Pitch', pt, 'mm'), kd('Links', n, ''), kd('Length', L)], notes: [`${c.id} ROLLER CHAIN, ${n} LINKS${at === 'k1' ? ', K1 ATTACHMENTS' : ''}${hollow ? ', HOLLOW PINS' : ''}`, 'PIN, PLATE SIZES ESTIMATED - CHECK WITH MAKER'], asm: { role: 'other', chain: c.id, chainPitch: pt } };
}

/* ======================= 3. Bearing housing (flange / pillow block) ======================= */
const BH_FIELDS: ParamField[] = [
  sel('type', 'Housing type', [['flange4', 'Square flange, 4 bolts'], ['flange_round', 'Round flange, 3 or 4 bolts'], ['pillow', 'Pillow block (foot mounted)']]),
  fld('bore', 'Bore (shaft or bearing insert seat)', 'mm', 5, 150, 0.1), fld('hubDia', 'Boss / housing outer diameter', 'mm', 10, 300, 0.5), fld('length', 'Housing length along the shaft', 'mm', 5, 200, 0.5),
  fld('size', 'Flange size (square side or round diameter) / pillow block base length', 'mm', 30, 400, 1), fld('flangeThk', 'Flange or base thickness', 'mm', 3, 50, 0.5),
  fld('boltSpacing', 'Bolt spacing (square) or bolt circle diameter (round)', 'mm', 0, 360, 0.5, { showIf: (p) => p.type !== 'pillow' }), fld('boltDia', 'Bolt hole diameter', 'mm', 3, 30, 0.1, { showIf: (p) => p.type !== 'pillow' }),
  sel('nBolts', 'Number of bolts (round flange)', [['3', '3'], ['4', '4']], { showIf: (p) => p.type === 'flange_round' }), fld('height', 'Pillow block: shaft centre height above the base', 'mm', 15, 250, 0.5, { showIf: (p) => p.type === 'pillow' }), ...MATERIAL_FIELDS,
];
const bhDefaults: Params = { type: 'flange4', bore: 25, hubDia: 45, length: 30, size: 95, flangeThk: 12, boltSpacing: 70, boltDia: 11, nBolts: '4', height: 36, material: 'S235 Steel', density: 7.85 };
function buildBearingHousing(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ty = String(p.type), bore = num0(p, 'bore'), hub = num0(p, 'hubDia'), len = num0(p, 'length'), A = num0(p, 'size'), ft = num0(p, 'flangeThk'), j = num0(p, 'boltSpacing'), bd = num0(p, 'boltDia'), nb = Number(p.nBolts), H = num0(p, 'height');
  const inputs = [R('Type', ty), R('Bore', bore, 'mm'), R('Boss OD', hub, 'mm'), R('Length', len, 'mm'), R('Size', A, 'mm'), R('Flange thickness', ft, 'mm'), R('Material', String(p.material))];
  const errors = check([['bore', bore, { min: 5, max: 150 }], ['boss diameter', hub, { min: 10, max: 300 }], ['length', len, { min: 5, max: 200 }], ['size', A, { min: 30, max: 400 }], ['thickness', ft, { min: 3, max: 50 }]]);
  if (!errors.length) {
    if (hub < bore + 6) errors.push('The boss outer diameter must be at least 6 mm larger than the bore (3 mm wall).');
    if (len < ft && ty !== 'pillow') errors.push('The length along the shaft must not be less than the flange thickness.');
    if (ty === 'pillow') { errors.push(...check([['centre height', H, { min: 15, max: 250 }]])); if (!errors.length && H - hub / 2 < 3) errors.push('The centre height must leave at least 3 mm of base under the boss: raise it or reduce the boss diameter.'); if (!errors.length && ft >= H - hub / 2 + 0.01 && H - hub / 2 < ft) errors.push('The base is thicker than the space under the boss. Reduce the base thickness or raise the centre height.'); }
    else {
      errors.push(...check([['bolt spacing / circle', j, { min: 1, max: 360 }], ['bolt hole', bd, { min: 3, max: 30 }]]));
      if (!errors.length) {
        const reach = ty === 'flange4' ? j * Math.SQRT1_2 + bd / 2 : j / 2 + bd / 2, half = ty === 'flange4' ? A / 2 : A / 2;
        const boltMax = ty === 'flange4' ? Math.max(j / 2 + bd / 2, 0) : reach;
        if (ty === 'flange4' && j / 2 + bd / 2 + 1 > half) errors.push('The bolt holes break through the edge of the flange. Reduce the bolt spacing or hole size, or enlarge the flange.');
        if (ty === 'flange_round' && boltMax + 1 > half) errors.push('The bolt circle is too large for the flange diameter.');
        const clear = ty === 'flange4' ? j * Math.SQRT1_2 : j / 2;
        if (!errors.length && clear - bd / 2 < hub / 2 - 0.01) errors.push('The bolt holes overlap the boss. Increase the bolt spacing, reduce the boss, or make the holes smaller.');
        if (!errors.length && A < hub + 4) errors.push('The flange must be larger than the boss.');
      }
    }
  }
  if (errors.length) return { inputs, errors };
  const prims: Prim[] = [];
  const dims: Built['dims'] = {};
  if (ty === 'pillow') {
    const nw = hub * 0.8;
    prims.push(prism(rectPoly(-A / 2, -H, A / 2, -H + ft), 0, len), prism(rectPoly(-nw / 2, -H + ft - 0.01, nw / 2, 0), 0, len), tube(bore / 2, hub / 2, 0, len));
    dims.top = [D([-A / 2, -H], [A / 2, -H], -8, fmt(A, 1)), D([A / 2, -H], [A / 2, 0], -10, `${fmt(H, 1)} centre height`)];
  } else {
    const holes: Hole[] = [circ([0, 0], bore / 2)];
    if (ty === 'flange4') for (const sx of [-1, 1]) for (const sy of [-1, 1]) holes.push(circ([sx * j / 2, sy * j / 2], bd / 2));
    else for (let i = 0; i < nb; i++) { const a = (2 * Math.PI * i) / nb + Math.PI / 4; holes.push(circ([(j / 2) * Math.cos(a), (j / 2) * Math.sin(a)], bd / 2)); }
    prims.push(prism(ty === 'flange4' ? rectPoly(-A / 2, -A / 2, A / 2, A / 2) : circlePts(A / 2), 0, ft, holes));
    if (len > ft) prims.push(tube(bore / 2, hub / 2, ft, len));
    dims.top = [D([-A / 2, -A / 2], [A / 2, -A / 2], -8, fmt(A, 1)), D([-j / 2, j / 2 + bd], [j / 2, j / 2 + bd], 0, ty === 'flange4' ? `${fmt(j, 1)} bolt spacing` : `Ø${fmt(j, 1)} bolt circle`)];
  }
  return { inputs, errors, geo: [part('housing', ty === 'pillow' ? 'Pillow block' : 'Flange housing', mi.color, prims)], dims, rows: [R('Bore', bore, 'mm', 2), R('Boss wall', (hub - bore) / 2, 'mm', 2)],
    assumptions: [ty === 'pillow' ? 'Pillow block: the bolt holes in the base are not modelled in 3D (the model builds holes only along the shaft axis). Add them from your drawing.' : 'Housing only: the bearing insert, seals and grease fitting are not modelled.'],
    warnings: (hub - bore) / 2 < 5 ? ['Boss wall is thin (under 5 mm).'] : [], key: [kd('Bore', bore), kd('Size', A), kd('Length', len)], notes: [`${ty === 'pillow' ? 'PILLOW BLOCK' : ty === 'flange4' ? '4-BOLT FLANGE HOUSING' : `${nb}-BOLT ROUND FLANGE HOUSING`}, BORE Ø${f2(bore)}`], asm: { role: 'bore', bore } };
}
const bhV = (id: string, name: string, o: Params): Variant => V(id, name, { ...bhDefaults, ...o });

/* ======================= 4. Shaft coupling ======================= */
const CP_FIELDS: ParamField[] = [
  sel('type', 'Coupling type', [['sleeve', 'Rigid sleeve'], ['jaw', 'Jaw coupling with elastic spider'], ['flange', 'Flange coupling (bolted)']]),
  fld('bore1', 'Bore on side 1', 'mm', 4, 150, 0.1), fld('bore2', 'Bore on side 2', 'mm', 4, 150, 0.1), fld('od', 'Outer diameter', 'mm', 12, 400, 0.5), fld('length', 'Overall length', 'mm', 15, 400, 0.5),
  fld('hubOd', 'Hub diameter (jaw and flange types)', 'mm', 10, 300, 0.5, { showIf: (p) => p.type !== 'sleeve' }), fld('boltDia', 'Flange bolt hole diameter', 'mm', 3, 25, 0.1, { showIf: (p) => p.type === 'flange' }), ...MATERIAL_FIELDS,
];
const cpDefaults: Params = { type: 'sleeve', bore1: 20, bore2: 20, od: 40, length: 60, hubOd: 36, boltDia: 6.6, material: 'C45 Steel', density: 7.85 };
function buildCoupling(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ty = String(p.type), b1 = num0(p, 'bore1'), b2 = num0(p, 'bore2'), od = num0(p, 'od'), L = num0(p, 'length'), hub = ty === 'sleeve' ? od : num0(p, 'hubOd'), bd = num0(p, 'boltDia');
  const inputs = [R('Type', ty), R('Bore 1', b1, 'mm'), R('Bore 2', b2, 'mm'), R('Outer diameter', od, 'mm'), R('Length', L, 'mm'), R('Material', String(p.material))];
  const errors = check([['bore 1', b1, { min: 4, max: 150 }], ['bore 2', b2, { min: 4, max: 150 }], ['outer diameter', od, { min: 12, max: 400 }], ['length', L, { min: 15, max: 400 }]]);
  if (!errors.length) {
    if (Math.max(b1, b2) + 6 > Math.min(ty === 'sleeve' ? od : hub, od)) errors.push('The larger bore leaves less than 3 mm of wall. Increase the outer / hub diameter or reduce the bore.');
    if (ty !== 'sleeve') { errors.push(...check([['hub diameter', hub, { min: 10, max: 300 }]])); if (!errors.length && hub > od) errors.push('The hub diameter cannot be larger than the outer diameter.'); }
    if (!errors.length && ty === 'flange') { errors.push(...check([['bolt hole', bd, { min: 3, max: 25 }]])); if (!errors.length && (od - hub) / 2 < bd + 2) errors.push('The flange is too narrow for the bolt holes: increase the outer diameter or reduce the hub or hole.'); }
    if (!errors.length && L < 8) errors.push('The coupling is too short.');
  }
  if (errors.length) return { inputs, errors };
  const prims: Prim[] = [], gp: GeoPart[] = [];
  if (ty === 'sleeve') { prims.push(tube(b1 / 2, od / 2, 0, L / 2), tube(b2 / 2, od / 2, L / 2, L)); gp.push(part('sleeve', 'Sleeve', mi.color, prims)); }
  else if (ty === 'jaw') {
    const gap = Math.max(3, L * 0.14), hl = (L - gap) / 2;
    gp.push(part('hub1', 'Hub 1', mi.color, [tube(b1 / 2, hub / 2, 0, hl)]), part('spider', 'Elastic spider', '#c75a2b', [tube(Math.max(b1, b2) / 2 + 1, od / 2, hl, hl + gap)]), part('hub2', 'Hub 2', mi.color, [tube(b2 / 2, hub / 2, hl + gap, L)]));
  } else {
    const ft = Math.max(6, L * 0.2), pcd = (od + hub) / 2, hs: Hole[][] = [[], []];
    for (let i = 0; i < 4; i++) { const a = (Math.PI * i) / 2 + Math.PI / 4; hs[0].push(circ([(pcd / 2) * Math.cos(a), (pcd / 2) * Math.sin(a)], bd / 2)); }
    gp.push(part('half1', 'Half 1', mi.color, [tube(b1 / 2, hub / 2, 0, L / 2 - ft), prism(circlePts(od / 2), L / 2 - ft, L / 2, [circ([0, 0], b1 / 2), ...hs[0]])]), part('half2', 'Half 2', mi.color, [prism(circlePts(od / 2), L / 2, L / 2 + ft, [circ([0, 0], b2 / 2), ...hs[0]]), tube(b2 / 2, hub / 2, L / 2 + ft, L)]));
  }
  const mr = od / 2;
  return { inputs, errors, geo: gp, rows: [R('Bore ratio (larger bore / outer diameter)', Math.max(b1, b2) / od, '', 2)], dims: { front: [D([mr, 0], [mr, L], -10, fmt(L, 1))], top: [D([-mr, -mr - 2], [mr, -mr - 2], -8, `Ø${fmt(od, 1)}`), D([-Math.max(b1, b2) / 2, 0], [Math.max(b1, b2) / 2, 0], 0, `Ø${fmt(Math.max(b1, b2), 1)} bore`)] },
    assumptions: ['Keyways, set screws, clamping screws and the spider teeth are not modelled.', ty === 'flange' ? 'The flange bolts are not drawn; only the bolt holes.' : 'Torque rating is not calculated: take it from the maker\'s catalogue.'], warnings: Math.max(b1, b2) / od > 0.7 ? ['The bore is large compared with the outer diameter; check the torque rating with the maker.'] : [],
    key: [kd('Bore 1', b1), kd('Bore 2', b2), kd('Outer dia', od), kd('Length', L)], notes: [`${ty === 'sleeve' ? 'RIGID SLEEVE' : ty === 'jaw' ? 'JAW' : 'FLANGE'} COUPLING, BORES Ø${f2(b1)} / Ø${f2(b2)}`], asm: { role: 'bore', bore: Math.max(b1, b2) } };
}

/* ======================= 5. Shaft collar ======================= */
const CO_FIELDS: ParamField[] = [sel('type', 'Collar type', [['setscrew', 'Set screw collar'], ['clamp', 'Clamp / lock collar (one-piece, with clamp lug)'], ['split', 'Split collar (two halves)']]), fld('bore', 'Bore', 'mm', 3, 150, 0.1), fld('od', 'Outer diameter', 'mm', 8, 300, 0.5), fld('width', 'Width', 'mm', 3, 80, 0.5), ...MATERIAL_FIELDS];
const coDefaults: Params = { type: 'setscrew', bore: 25, od: 45, width: 16, material: 'C45 Steel', density: 7.85 };
function buildCollar(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ty = String(p.type), bore = num0(p, 'bore'), od = num0(p, 'od'), w = num0(p, 'width');
  const inputs = [R('Type', ty), R('Bore', bore, 'mm'), R('Outer diameter', od, 'mm'), R('Width', w, 'mm'), R('Material', String(p.material))];
  const errors = check([['bore', bore, { min: 3, max: 150 }], ['outer diameter', od, { min: 8, max: 300 }], ['width', w, { min: 3, max: 80 }]]);
  if (!errors.length && od < bore + 6) errors.push('The outer diameter must be at least 6 mm larger than the bore (3 mm wall).');
  if (errors.length) return { inputs, errors };
  const prims: Prim[] = [tube(bore / 2, od / 2, 0, w)];
  if (ty === 'clamp') prims.push(prism(rectPoly(od / 2 - 2, -w * 0.3, od / 2 + w * 0.45, w * 0.3), 0, w));
  if (ty === 'split') prims.push(prism(rectPoly(-1, -od / 2 - 0.01, 1, -bore / 2 + 0.01), 0, w));
  return { inputs, errors, geo: [part('collar', 'Collar', mi.color, prims)], rows: [R('Wall thickness', (od - bore) / 2, 'mm', 2)], dims: { front: [D([od / 2, 0], [od / 2, w], -10, fmt(w, 1))], top: [D([-od / 2, -od / 2 - 2], [od / 2, -od / 2 - 2], -8, `Ø${fmt(od, 1)}`)] },
    assumptions: ['Set screw holes, clamp screw holes and the split line are not cut: shown only as the lug or a thin web.'], key: [kd('Bore', bore), kd('Outer dia', od), kd('Width', w)], notes: [`${ty === 'setscrew' ? 'SET SCREW' : ty === 'clamp' ? 'CLAMP / LOCK' : 'SPLIT'} COLLAR, BORE Ø${f2(bore)}`], asm: { role: 'bore', bore } };
}

/* ======================= 6. Retaining ring (circlip) ======================= */
const CL_FIELDS: ParamField[] = [sel('type', 'Ring type', [['external', 'External (shaft groove, like DIN 471)'], ['internal', 'Internal (bore groove, like DIN 472)']]), fld('d', 'Shaft or bore diameter the ring sits on', 'mm', 3, 200, 0.1), fld('s', 'Ring thickness', 'mm', 0.4, 6, 0.05), fld('b', 'Ring radial width', 'mm', 0.8, 15, 0.05), fld('gd', 'Groove depth', 'mm', 0.2, 6, 0.05), fld('gap', 'Opening angle', 'deg', 10, 90, 1), ...MATERIAL_FIELDS];
const clDefaults: Params = { type: 'external', d: 20, s: 1.2, b: 2.2, gd: 0.9, gap: 40, material: 'C45 Steel', density: 7.85 };
function buildCirclip(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ty = String(p.type), d = num0(p, 'd'), s = num0(p, 's'), b = num0(p, 'b'), gd = num0(p, 'gd'), gap = num0(p, 'gap');
  const inputs = [R('Type', ty), R('Diameter', d, 'mm'), R('Thickness', s, 'mm'), R('Radial width', b, 'mm'), R('Groove depth', gd, 'mm'), R('Opening angle', gap, 'deg')];
  const errors = check([['diameter', d, { min: 3, max: 200 }], ['thickness', s, { min: 0.4, max: 6 }], ['radial width', b, { min: 0.8, max: 15 }], ['groove depth', gd, { min: 0.2, max: 6 }], ['opening angle', gap, { min: 10, max: 90 }]]);
  if (!errors.length && gd * 2 >= d) errors.push('The groove is deeper than the shaft allows.');
  if (!errors.length && ty === 'external' && b <= gd) errors.push('The ring must be wider than the groove depth, or it will not stand proud of the shaft.');
  if (errors.length) return { inputs, errors };
  const ri = ty === 'external' ? d / 2 - gd : d / 2 + gd - b, ro = ty === 'external' ? ri + b : d / 2 + gd;
  if (ri <= 0.2) return { inputs, errors: ['The ring would have no opening in the middle. Reduce the groove depth or ring width.'] };
  const n = 36, a0 = (gap / 2) * Math.PI / 180, a1 = 2 * Math.PI - a0, pts: Pt[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([ro * Math.cos(a), ro * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([ri * Math.cos(a), ri * Math.sin(a)]); }
  return { inputs, errors, geo: [part('ring', 'Retaining ring', mi.color, [prism(pts, 0, s)])], rows: [R('Free inner radius', ri, 'mm', 2), R('Free outer radius', ro, 'mm', 2)], dims: { front: [D([ro, 0], [ro, s], -8, fmt(s, 2))], top: [D([-ro, -ro - 2], [ro, -ro - 2], -8, `Ø${fmt(2 * ro, 2)}`)] },
    assumptions: ['Plain C-shaped ring. The lug holes (eyes) for pliers and the exact free-state taper are not modelled. Take real sizes from DIN 471 / 472 tables.'], warnings: [],
    key: [kd('Ring OD', 2 * ro), kd('Ring ID', 2 * ri), kd('Thickness', s)], notes: [`${ty.toUpperCase()} RETAINING RING FOR Ø${f2(d)}`], asm: { role: 'other' } };
}

/* ======================= 7. Take-up / tensioning unit ======================= */
const TU_FIELDS: ParamField[] = [fld('bore', 'Shaft / bearing bore', 'mm', 8, 100, 0.1), fld('travel', 'Adjustment travel', 'mm', 5, 500, 1), fld('plateLen', 'Plate length', 'mm', 60, 900, 1), fld('plateWid', 'Plate width', 'mm', 30, 300, 1), fld('plateThk', 'Plate thickness', 'mm', 3, 30, 0.5),
  fld('blockSize', 'Sliding block size (square)', 'mm', 25, 200, 1), fld('blockThk', 'Sliding block thickness', 'mm', 8, 80, 0.5), fld('rodDia', 'Adjusting screw diameter', 'mm', 6, 40, 0.5), fld('pos', 'Block position along the travel', '%', 0, 100, 1), ...MATERIAL_FIELDS];
const tuDefaults: Params = { bore: 25, travel: 80, plateLen: 260, plateWid: 80, plateThk: 8, blockSize: 60, blockThk: 25, rodDia: 12, pos: 50, material: 'S235 Steel', density: 7.85 };
function buildTakeup(p: Params, mi: { density: number; color: string; id: string }): Built {
  const bore = num0(p, 'bore'), tr = num0(p, 'travel'), L = num0(p, 'plateLen'), W = num0(p, 'plateWid'), t = num0(p, 'plateThk'), bs = num0(p, 'blockSize'), bt = num0(p, 'blockThk'), rd = num0(p, 'rodDia'), pos = num0(p, 'pos');
  const inputs = [R('Bore', bore, 'mm'), R('Travel', tr, 'mm'), R('Plate', `${fmt(L, 1)} x ${fmt(W, 1)} x ${fmt(t, 1)}`, 'mm'), R('Block', `${fmt(bs, 1)} x ${fmt(bt, 1)}`, 'mm'), R('Material', String(p.material))];
  const errors = check([['bore', bore, { min: 8, max: 100 }], ['travel', tr, { min: 5, max: 500 }], ['plate length', L, { min: 60, max: 900 }], ['plate width', W, { min: 30, max: 300 }], ['plate thickness', t, { min: 3, max: 30 }], ['block size', bs, { min: 25, max: 200 }], ['block thickness', bt, { min: 8, max: 80 }], ['screw diameter', rd, { min: 6, max: 40 }], ['position', pos, { min: 0, max: 100 }]]);
  const slotW = bore + 4, slotL = tr + slotW, edge = 15, lugW = 12;
  if (!errors.length) {
    if (bs < bore + 8) errors.push('The sliding block must be at least 8 mm larger than the bore.');
    if (bs > W) errors.push('The sliding block is wider than the plate.');
    if (slotW + 6 > W) errors.push('The slot would leave less than 3 mm either side. Make the plate wider or the bore smaller.');
    if (slotL + 2 * edge + lugW > L) errors.push(`The plate is too short: it needs at least ${fmt(slotL + 2 * edge + lugW, 0)} mm for this travel and bore.`);
    if (rd > bs * 0.6) errors.push('The adjusting screw is too thick for the block.');
  }
  if (errors.length) return { inputs, errors };
  const cy = W / 2, sx0 = edge + slotL / 2, cx = sx0 - (slotL - slotW) / 2 + (tr * pos) / 100;
  const plate = prism(rectPoly(0, 0, L, W), 0, t, [{ poly: stadium(sx0, cy, slotL, slotW) }]);
  const lug = prism(rectPoly(L - lugW, cy - bs / 2 + 2, L - 0.01, cy + bs / 2 - 2), t, t + bt * 0.8);
  const block = prism(rectPoly(cx - bs / 2, cy - bs / 2, cx + bs / 2, cy + bs / 2), t, t + bt, [circ([cx, cy], bore / 2)]);
  const rod = prism(rectPoly(cx + bs / 2, cy - rd / 2, L - lugW + 4, cy + rd / 2), t + bt / 2 - rd / 2, t + bt / 2 + rd / 2);
  return { inputs, errors, geo: [part('plate', 'Base plate', mi.color, [plate, lug]), part('block', 'Sliding block', '#b9c2cc', [block]), part('screw', 'Adjusting screw', STEEL, [rod])], rows: [R('Slot length', slotL, 'mm', 1), R('Slot width', slotW, 'mm', 1)],
    dims: { top: [D([0, -2], [L, -2], -10, fmt(L, 1)), D([0, 0], [0, W], 10, fmt(W, 1)), D([sx0 - slotL / 2, W], [sx0 + slotL / 2, W], -10, `${fmt(slotL, 1)} slot`)], front: [D([L, 0], [L, t + bt], -10, fmt(t + bt, 1))] },
    assumptions: ['The adjusting screw is drawn as a square bar of the same diameter. Threads, lock nuts and mounting bolt holes are not modelled. Allowed load is not calculated.'], warnings: [],
    key: [kd('Travel', tr), kd('Bore', bore), kd('Plate length', L)], notes: [`SCREW TAKE-UP UNIT, BORE Ø${f2(bore)}, TRAVEL ${f2(tr)}`], asm: { role: 'other' } };
}

/* ======================= 8. Bent bracket / stop / guard / clamp / mount ======================= */
const LB_FIELDS: ParamField[] = [fld('leg1', 'Base leg length', 'mm', 10, 800, 0.5), fld('leg2', 'Upright leg height (from the underside of the base)', 'mm', 10, 800, 0.5), fld('width', 'Width', 'mm', 5, 2000, 0.5), fld('thk', 'Material thickness', 'mm', 1, 40, 0.1),
  fld('holes', 'Holes in the base leg (0 to 4, in a row)', '', 0, 4, 1), fld('holeDia', 'Hole diameter', 'mm', 2, 40, 0.1, { showIf: (p) => num(p, 'holes') > 0 }), fld('edge', 'Hole edge distance', 'mm', 3, 200, 0.5, { showIf: (p) => num(p, 'holes') > 0 }), ...MATERIAL_FIELDS];
const lbDefaults: Params = { leg1: 60, leg2: 60, width: 40, thk: 4, holes: 2, holeDia: 9, edge: 15, material: 'S235 Steel', density: 7.85 };
function buildLBracket(p: Params, mi: { density: number; color: string; id: string }): Built {
  const l1 = num0(p, 'leg1'), l2 = num0(p, 'leg2'), W = num0(p, 'width'), t = num0(p, 'thk'), nh = num0(p, 'holes'), dh = nh > 0 ? num0(p, 'holeDia') : 0, ed = nh > 0 ? num0(p, 'edge') : 0;
  const inputs = [R('Base leg', l1, 'mm'), R('Upright', l2, 'mm'), R('Width', W, 'mm'), R('Thickness', t, 'mm'), R('Holes', nh), R('Material', String(p.material))];
  const errors = check([['base leg', l1, { min: 10, max: 800 }], ['upright height', l2, { min: 10, max: 800 }], ['width', W, { min: 5, max: 2000 }], ['thickness', t, { min: 1, max: 40 }], ['holes', nh, { min: 0, max: 4, int: true }]]);
  if (!errors.length && t * 2 >= Math.min(l1, l2)) errors.push('The thickness is too large for the leg lengths.');
  if (!errors.length && nh > 0) {
    errors.push(...check([['hole diameter', dh, { min: 2, max: 40 }], ['edge distance', ed, { min: 3, max: 200 }]]));
    if (!errors.length) {
      const room = l1 - t - 2 * ed;
      if (dh > W - 2) errors.push('The hole is wider than the bracket.');
      if (room < 0 || (nh > 1 && room / (nh - 1) < dh + 2)) errors.push('The holes do not fit in the base leg: reduce the number or size, or lengthen the leg.');
      if (!errors.length && ed < dh / 2 + 1) errors.push('The edge distance is too small for the hole.');
    }
  }
  if (errors.length) return { inputs, errors };
  const holes: Hole[] = [];
  for (let i = 0; i < nh; i++) holes.push(circ([t + ed + (nh > 1 ? ((l1 - t - 2 * ed) * i) / (nh - 1) : (l1 - t) / 2 - ed), W / 2], dh / 2));
  return { inputs, errors, geo: [part('bracket', 'Bracket', mi.color, [prism(rectPoly(0, 0, l1, W), 0, t, holes), prism(rectPoly(0, 0, t, W), t - 0.01, l2)])], rows: [R('Holes', nh)], dims: { front: [D([0, 0], [l1, 0], -8, fmt(l1, 1)), D([l1, 0], [l1, l2], -10, fmt(l2, 1))], top: [D([0, W], [l1, W], 8, fmt(l1, 1)), D([l1, 0], [l1, W], -8, fmt(W, 1))] },
    assumptions: ['Sharp bend (no bend radius). Holes are drawn in the base leg only: holes in the upright leg are not modelled.'], warnings: l2 / t > 40 ? ['A very tall, thin upright may flex: consider a gusset or a thicker plate.'] : [],
    key: [kd('Base leg', l1), kd('Upright', l2), kd('Width', W), kd('Thickness', t)], notes: [`BENT BRACKET ${f2(l1)} x ${f2(l2)} x ${f2(W)}, ${f2(t)} THICK`], asm: { role: 'other' } };
}
const lbV = (id: string, name: string, o: Params): Variant => V(id, name, { ...lbDefaults, ...o });

/* ======================= 9. Motor / gearbox envelope ======================= */
const MO_FIELDS: ParamField[] = [sel('type', 'Type', [['motor', 'Electric motor (round frame)'], ['gearbox', 'Gearbox (square housing)']]), fld('bodyD', 'Body diameter or housing width', 'mm', 40, 600, 1), fld('bodyLen', 'Body length', 'mm', 40, 900, 1),
  fld('flangeA', 'Flange size (square side)', 'mm', 40, 700, 1), fld('flangeThk', 'Flange thickness', 'mm', 4, 40, 0.5), fld('pcd', 'Flange bolt circle diameter', 'mm', 20, 600, 1), fld('boltDia', 'Flange bolt hole diameter', 'mm', 4, 30, 0.1),
  fld('shaftD', 'Output shaft diameter', 'mm', 6, 120, 0.1), fld('shaftLen', 'Output shaft length', 'mm', 10, 300, 1), fld('fan', 'Fan cover length at the back (motor)', 'mm', 0, 200, 1, { showIf: (p) => p.type === 'motor' }), sel('foot', 'Foot mounting', [['no', 'No feet'], ['yes', 'Feet under the body']])];
const moDefaults: Params = { type: 'motor', bodyD: 140, bodyLen: 190, flangeA: 160, flangeThk: 12, pcd: 130, boltDia: 9, shaftD: 24, shaftLen: 50, fan: 40, foot: 'no', material: 'Al 6061-T6', density: 2.7 };
function buildMotor(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ty = String(p.type), bd = num0(p, 'bodyD'), bl = num0(p, 'bodyLen'), A = num0(p, 'flangeA'), ft = num0(p, 'flangeThk'), pcd = num0(p, 'pcd'), hd = num0(p, 'boltDia'), sd = num0(p, 'shaftD'), sl = num0(p, 'shaftLen'), fan = ty === 'motor' ? num0(p, 'fan') : 0, foot = p.foot === 'yes';
  const inputs = [R('Type', ty), R('Body', `${fmt(bd, 1)} x ${fmt(bl, 1)}`, 'mm'), R('Flange', fmt(A, 1), 'mm'), R('Shaft', `Ø${fmt(sd, 1)} x ${fmt(sl, 1)}`, 'mm')];
  const errors = check([['body diameter', bd, { min: 40, max: 600 }], ['body length', bl, { min: 40, max: 900 }], ['flange size', A, { min: 40, max: 700 }], ['flange thickness', ft, { min: 4, max: 40 }], ['bolt circle', pcd, { min: 20, max: 600 }], ['bolt hole', hd, { min: 4, max: 30 }], ['shaft diameter', sd, { min: 6, max: 120 }], ['shaft length', sl, { min: 10, max: 300 }], ['fan cover', fan, { min: 0, max: 200 }]]);
  if (!errors.length) {
    if (sd >= bd * 0.6) errors.push('The output shaft is too thick for the body.');
    if (A < bd * 0.9) errors.push('The flange should be at least 90% of the body diameter.');
    if (pcd / 2 + hd / 2 + 1 > A / 2 * Math.SQRT2) errors.push('The bolt holes fall outside the flange. Reduce the bolt circle or enlarge the flange.');
    if (pcd / 2 - hd / 2 < sd / 2 + 4) errors.push('The bolt holes overlap the shaft area. Increase the bolt circle.');
  }
  if (errors.length) return { inputs, errors };
  const z0 = -fan, zf = bl, body = ty === 'motor' ? [tube(0, bd / 2, 0, bl), ...(fan > 0 ? [tube(0, bd * 0.46, z0, 0)] : [])] : [prism(rectPoly(-bd / 2, -bd / 2, bd / 2, bd / 2), 0, bl)];
  if (foot) body.push(prism(rectPoly(-bd * 0.42, -bd / 2 - bd * 0.14, bd * 0.42, -bd / 2 + 3), bl * 0.2, bl * 0.8));
  const holes: Hole[] = [];
  for (let i = 0; i < 4; i++) { const a = (Math.PI * i) / 2 + Math.PI / 4; holes.push(circ([(pcd / 2) * Math.cos(a), (pcd / 2) * Math.sin(a)], hd / 2)); }
  const geo = [part('body', ty === 'motor' ? 'Motor body' : 'Gearbox housing', mi.color, body), part('flange', 'Flange', '#8f98a3', [prism(rectPoly(-A / 2, -A / 2, A / 2, A / 2), zf, zf + ft, holes)]), part('shaft', 'Output shaft', STEEL, [tube(0, sd / 2, zf + ft, zf + ft + sl)])];
  return { inputs, errors, geo, noMass: true, rows: [R('Overall length', bl + ft + sl + fan, 'mm', 1)], dims: { front: [D([A / 2, -fan], [A / 2, zf + ft + sl], -12, fmt(bl + ft + sl + fan, 1))], top: [D([-A / 2, -A / 2], [A / 2, -A / 2], -8, fmt(A, 1))] },
    assumptions: ['Outline (envelope) model for layout and clash checks only. No terminal box, cooling fins, nameplate or internal detail. Mass, power, speed and ratio are NOT calculated: take them from the maker\'s catalogue.'], warnings: [],
    key: [kd('Body', bd), kd('Body length', bl), kd('Shaft dia', sd), kd('Flange', A)], notes: [`${ty === 'motor' ? 'MOTOR' : 'GEARBOX'} ENVELOPE, SHAFT Ø${f2(sd)} x ${f2(sl)}`, 'OUTLINE ONLY - SEE MAKER DATA'], asm: { role: 'other' } };
}

/* ======================= 10. Socket set (grub) screw ======================= */
const SS_SIZES: Record<string, [d: number, s: number]> = { M3: [3, 1.5], M4: [4, 2], M5: [5, 2.5], M6: [6, 3], M8: [8, 4], M10: [10, 5], M12: [12, 6], M16: [16, 8] };
const SS_FIELDS: ParamField[] = [sel('size', 'Thread size', Object.keys(SS_SIZES).map((k) => [k, k] as [string, string])), fld('length', 'Length', 'mm', 3, 60, 1), sel('material', 'Material', [['C45 Steel', 'C45 Steel'], ['SS 304', 'SS 304'], ['Brass CuZn39Pb3', 'Brass']])];
const ssDefaults: Params = { size: 'M6', length: 12, material: 'C45 Steel' };
function buildSetScrew(p: Params, mi: { density: number; color: string; id: string }): Built {
  const sz = SS_SIZES[String(p.size)], L = num0(p, 'length');
  const inputs = [R('Size', String(p.size)), R('Length', L, 'mm'), R('Material', String(p.material))];
  const errors = check([['length', L, { min: 3, max: 60 }]]);
  if (!sz) errors.push('Choose a thread size from the list.');
  if (!errors.length && sz && L < sz[0] * 0.8) errors.push(`A ${p.size} set screw cannot be shorter than ${fmt(sz[0] * 0.8, 1)} mm.`);
  if (errors.length || !sz) return { inputs, errors };
  const [d, s] = sz, depth = Math.min(L * 0.6, Math.max(s * 0.9, d * 0.5));
  return { inputs, errors, geo: [part('screw', 'Set screw', mi.color, [prism(circlePts(d / 2), 0, L - depth), prism(circlePts(d / 2), L - depth, L, [{ poly: hexPoly(s) }])])], rows: [R('Hex key size', s, 'mm', 1), R('Socket depth', depth, 'mm', 2)], dims: { front: [D([d / 2, 0], [d / 2, L], -8, fmt(L, 1))], top: [D([-d / 2, -d / 2 - 1], [d / 2, -d / 2 - 1], -6, `Ø${fmt(d, 1)}`)] },
    assumptions: ['Hexagon socket set screw (flat point). The thread is not modelled: the screw is a plain cylinder of the nominal diameter.'], warnings: [], key: [kd('Size', d), kd('Length', L)], notes: [`${p.size} x ${f2(L)} HEX SOCKET SET SCREW - THREAD NOT MODELLED`], asm: { role: 'other' } };
}

/* ======================= 11. Grease nipple ======================= */
const GN_FIELDS: ParamField[] = [fld('d', 'Thread diameter', 'mm', 4, 20, 0.1), fld('tl', 'Thread length', 'mm', 4, 30, 0.5), fld('s', 'Hexagon across flats', 'mm', 6, 30, 0.5), fld('hh', 'Hexagon height', 'mm', 2, 12, 0.5), fld('head', 'Head ball diameter', 'mm', 4, 16, 0.1), fld('neck', 'Neck length above the hexagon', 'mm', 2, 20, 0.5), sel('material', 'Material', [['C45 Steel', 'C45 Steel'], ['SS 304', 'SS 304'], ['Brass CuZn39Pb3', 'Brass']])];
const gnDefaults: Params = { d: 6, tl: 8, s: 11, hh: 4, head: 8, neck: 6, material: 'C45 Steel' };
function buildGrease(p: Params, mi: { density: number; color: string; id: string }): Built {
  const d = num0(p, 'd'), tl = num0(p, 'tl'), s = num0(p, 's'), hh = num0(p, 'hh'), hd = num0(p, 'head'), nk = num0(p, 'neck');
  const inputs = [R('Thread', d, 'mm'), R('Thread length', tl, 'mm'), R('Hexagon', s, 'mm'), R('Head', hd, 'mm'), R('Material', String(p.material))];
  const errors = check([['thread diameter', d, { min: 4, max: 20 }], ['thread length', tl, { min: 4, max: 30 }], ['hexagon size', s, { min: 6, max: 30 }], ['hexagon height', hh, { min: 2, max: 12 }], ['head diameter', hd, { min: 4, max: 16 }], ['neck length', nk, { min: 2, max: 20 }]]);
  if (!errors.length && s < d + 1) errors.push('The hexagon must be at least 1 mm larger than the thread.');
  if (!errors.length && hd > s) errors.push('The head ball cannot be larger than the hexagon.');
  if (errors.length) return { inputs, errors };
  const neckD = Math.max(3, d * 0.5), z1 = tl, z2 = tl + hh, z3 = z2 + nk;
  return { inputs, errors, geo: [part('nipple', 'Grease nipple', mi.color, [prism(circlePts(d / 2), 0, tl), prism(hexPoly(s), z1, z2), prism(circlePts(neckD / 2), z2, z3), { kind: 'sphere', c: [0, 0, z3 + hd * 0.25], r: hd / 2 }])], rows: [R('Overall length', z3 + hd * 0.75, 'mm', 1)], dims: { front: [D([s / 2, 0], [s / 2, z3 + hd * 0.75], -8, fmt(z3 + hd * 0.75, 1))], top: [D([-s / 2, -s / 2], [s / 2, -s / 2], -6, `${fmt(s, 1)} across flats`), D([-d / 2, d / 2 + 2], [d / 2, d / 2 + 2], 4, `Ø${fmt(d, 1)} thread`)] },
    assumptions: ['Simple outline: thread not modelled, internal ball and spring not modelled. Typical values are given as defaults: check them against the data sheet of the fitting you use.'], warnings: [], key: [kd('Thread', d), kd('Hexagon', s)], notes: [`GREASE NIPPLE, THREAD Ø${f2(d)}`, 'THREAD NOT MODELLED'], asm: { role: 'other' } };
}


/* ======================= 12. Tapered roller (stepped approximation) ======================= */
const TR_FIELDS: ParamField[] = [fld('d1', 'Diameter at the small end', 'mm', 10, 500, 0.1), fld('d2', 'Diameter at the large end', 'mm', 10, 500, 0.1), fld('length', 'Length of the tapered body', 'mm', 20, 2000, 1), fld('stub', 'Stub shaft diameter at each end (0 = none)', 'mm', 0, 100, 0.1), fld('stubLen', 'Stub shaft length', 'mm', 0, 100, 1, { showIf: (p) => num(p, 'stub') > 0 }),
  fld('steps', 'Number of steps used to draw the taper (more = smoother)', '', 6, 40, 1), fld('bore', 'Through bore (0 = solid)', 'mm', 0, 400, 0.1), ...MATERIAL_FIELDS];
const trDefaults: Params = { d1: 60, d2: 90, length: 500, stub: 20, stubLen: 25, steps: 24, bore: 0, material: 'S235 Steel', density: 7.85 };
function buildTaper(p: Params, mi: { density: number; color: string; id: string }): Built {
  const d1 = num0(p, 'd1'), d2 = num0(p, 'd2'), L = num0(p, 'length'), stub = num0(p, 'stub'), sl = stub > 0 ? num0(p, 'stubLen') : 0, n = num0(p, 'steps'), bore = num0(p, 'bore');
  const inputs = [R('Small end', d1, 'mm'), R('Large end', d2, 'mm'), R('Length', L, 'mm'), R('Steps', n), R('Material', String(p.material))];
  const errors = check([['small end diameter', d1, { min: 10, max: 500 }], ['large end diameter', d2, { min: 10, max: 500 }], ['length', L, { min: 20, max: 2000 }], ['stub diameter', stub, { min: 0, max: 100 }], ['steps', n, { min: 6, max: 40, int: true }], ['bore', bore, { min: 0, max: 400 }]]);
  if (!errors.length) {
    if (stub > 0) { errors.push(...check([['stub length', sl, { min: 1, max: 100 }]])); if (!errors.length && stub >= Math.min(d1, d2) - 2) errors.push('The stub shaft must be at least 2 mm smaller than the small end of the roller.'); }
    if (!errors.length && bore > 0 && bore > Math.min(d1, d2) - 4) errors.push('The bore must leave at least 2 mm of wall at the small end.');
    if (!errors.length && bore > 0 && stub > 0) errors.push('Use either a bore or stub shafts, not both.');
  }
  if (errors.length) return { inputs, errors };
  const prims: Prim[] = [], dz = L / n;
  for (let i = 0; i < n; i++) { const dm = d1 + ((d2 - d1) * (i + 0.5)) / n; prims.push(tube(bore / 2, dm / 2, sl + i * dz, sl + (i + 1) * dz)); }
  if (stub > 0) { prims.push(tube(0, stub / 2, 0, sl + 0.01), tube(0, stub / 2, sl + L - 0.01, 2 * sl + L)); }
  const total = L + 2 * sl, half = Math.atan((Math.abs(d2 - d1) / 2) / L) * 180 / Math.PI, mx = Math.max(d1, d2);
  return { inputs, errors, geo: [part('roller', 'Tapered roller', mi.color, prims)], rows: [R('Half taper angle', half, 'deg', 2), R('Taper per metre of length', (Math.abs(d2 - d1) / L) * 1000, 'mm/m', 1)],
    dims: { front: [D([mx / 2, sl], [mx / 2, sl + L], -12, `${fmt(L, 1)} body`), D([-mx / 2, 0], [-mx / 2, total], 14, `${fmt(total, 1)} overall`)], top: [D([-d1 / 2, 0], [d1 / 2, 0], -6, `Ø${fmt(d1, 1)} small`), D([-d2 / 2, 0], [d2 / 2, 0], -16, `Ø${fmt(d2, 1)} large`)] },
    assumptions: ['The taper is drawn and modelled as a stack of short cylinders (a stepped approximation: the 3D model and STEP file have visible steps). Use more steps for a smoother look. Mass uses the stepped volume.'], warnings: Math.abs(d2 - d1) / L > 0.5 ? ['Very steep taper.'] : [],
    key: [kd('Small dia', d1), kd('Large dia', d2), kd('Body length', L)], notes: [`TAPERED ROLLER Ø${f2(d1)} TO Ø${f2(d2)} x ${f2(L)}`, 'TAPER APPROXIMATED BY STEPS'], asm: { role: 'other' } };
}

/* ======================= 13. Curved conveyor section (bed and side guards) ======================= */
const CV_FIELDS: ParamField[] = [fld('innerR', 'Inside radius of the curve', 'mm', 100, 5000, 1), fld('width', 'Width of the track', 'mm', 40, 2000, 1), fld('angle', 'Angle of the curve', 'deg', 5, 180, 1), fld('bedThk', 'Bed plate thickness', 'mm', 2, 40, 0.5), fld('guardH', 'Side guard height above the bed', 'mm', 0, 300, 1), fld('guardThk', 'Side guard thickness', 'mm', 2, 40, 0.5, { showIf: (p) => num(p, 'guardH') > 0 }), ...MATERIAL_FIELDS];
const cvDefaults: Params = { innerR: 600, width: 300, angle: 90, bedThk: 4, guardH: 50, guardThk: 4, material: 'SS 304', density: 8 };
const sector = (r0: number, r1: number, a: number): Pt[] => {
  const n = Math.max(8, Math.ceil(a / 3)), pts: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = (a * i) / n * Math.PI / 180; pts.push([r1 * Math.cos(t), r1 * Math.sin(t)]); }
  for (let i = n; i >= 0; i--) { const t = (a * i) / n * Math.PI / 180; pts.push([r0 * Math.cos(t), r0 * Math.sin(t)]); }
  return pts;
};
function buildCurved(p: Params, mi: { density: number; color: string; id: string }): Built {
  const ri = num0(p, 'innerR'), W = num0(p, 'width'), a = num0(p, 'angle'), bt = num0(p, 'bedThk'), gh = num0(p, 'guardH'), gt = gh > 0 ? num0(p, 'guardThk') : 0;
  const inputs = [R('Inside radius', ri, 'mm'), R('Width', W, 'mm'), R('Angle', a, 'deg'), R('Bed thickness', bt, 'mm'), R('Guard height', gh, 'mm'), R('Material', String(p.material))];
  const errors = check([['inside radius', ri, { min: 100, max: 5000 }], ['width', W, { min: 40, max: 2000 }], ['angle', a, { min: 5, max: 180 }], ['bed thickness', bt, { min: 2, max: 40 }], ['guard height', gh, { min: 0, max: 300 }]]);
  if (!errors.length && gh > 0) { errors.push(...check([['guard thickness', gt, { min: 2, max: 40 }]])); if (!errors.length && 2 * gt >= W) errors.push('The two side guards leave no room between them.'); }
  if (!errors.length && W > ri * 4) errors.push('The track is very wide for this radius. Increase the radius or reduce the width.');
  if (errors.length) return { inputs, errors };
  const ro = ri + W, prims: GeoPart[] = [part('bed', 'Bed plate', mi.color, [prism(sector(ri, ro, a), 0, bt)])];
  if (gh > 0) prims.push(part('guards', 'Side guards', '#c4ccd4', [prism(sector(ri, ri + gt, a), bt - 0.01, bt + gh), prism(sector(ro - gt, ro, a), bt - 0.01, bt + gh)]));
  const rm = ri + W / 2, arc = (rm * a * Math.PI) / 180;
  return { inputs, errors, geo: prims, rows: [R('Centre-line radius', rm, 'mm', 1), R('Centre-line arc length', arc, 'mm', 1), R('Outside radius', ro, 'mm', 1)],
    dims: { top: [D([ri, 0], [ro, 0], -10, `${fmt(W, 1)} width`), D([0, 0], [ro, 0], -50, `R${fmt(ro, 1)} outside`), D([0, 0], [ri, 0], -30, `R${fmt(ri, 1)} inside`)] },
    assumptions: ['Bed plate and side guards only, drawn as arc segments (the arc is approximated by short straight edges, about one per 3 degrees). Rollers, chain track, slats, supports and the straight tangent sections are not modelled.'], warnings: a > 90 && W > ri ? ['Wide track on a tight curve: check the belt or chain can follow this radius.'] : [],
    key: [kd('Inside radius', ri), kd('Width', W), kd('Angle', a, 'deg'), kd('Arc length', arc)], notes: [`CURVED SECTION ${f2(a)} DEG, INSIDE R${f2(ri)}, WIDTH ${f2(W)}`, 'BED AND SIDE GUARDS ONLY'], asm: { role: 'other' } };
}

/* ---------- families ---------- */
const mk = (s: Omit<Spec, 'category'> & { category?: string }): Omit<Family, 'basic' | 'autofill'> => family({ category: 'J', ...s } as Spec);
export const CONVEYOR_FAMILIES: Omit<Family, 'basic' | 'autofill'>[] = [
  mk({ id: 'modbelt', name: 'Modular chain / belt (plastic or steel modules)', category: 'C', subcategory: 'Modular belts and chains', description: 'A section of modular chain or belt: choose the surface style (flat, grid, perforated, friction top, ball top, cleated, ribbed), then type pitch, width, number of modules, thickness and hinge rod size.',
    keywords: ['modular', 'belt', 'chain', 'plastic chain', 'flat top', 'flush grid', 'open grid', 'perforated', 'friction top', 'roller top', 'cleated', 'ribbed', 'tabletop', 'mat top', 'side flexing', 'radius', 'accumulation', 'multiflex'], applications: ['plastic and steel modular belts and chains'], standards: ['User-specified dimensions'],
    fields: MB_FIELDS, defaults: mbDefaults, build: buildModBelt, partNo: (p) => `MB-${String(p.style).toUpperCase().slice(0, 4)}-${p.width}x${p.modules}`,
    variants: [mbV('MB-FLAT25', 'Flat-top module belt, 25.4 pitch, 300 wide', {}), mbV('MB-FLAT38', 'Flat-top chain, 38.1 pitch, 82.5 wide', { pitch: 38.1, width: 82.5, thickness: 9, pinDia: 6, modules: 10 }), mbV('MB-GRID', 'Open-grid belt, 25.4 pitch', { style: 'grid', openW: 8, openPitch: 14, thickness: 10 }), mbV('MB-PERF', 'Perforated belt', { style: 'perforated', openW: 6, openPitch: 12 }),
      mbV('MB-FRIC', 'Friction-top belt', { style: 'friction', topH: 3, material: 'Nylon PA6' }), mbV('MB-CLEAT', 'Cleated belt', { style: 'cleated', topH: 25, every: 4 }), mbV('MB-RIB', 'Ribbed belt', { style: 'ribbed', topH: 6, openW: 4, openPitch: 25 }), mbV('MB-BALL', 'Ball-top belt', { style: 'rollertop', openW: 12, openPitch: 25, thickness: 10 }), mbV('MB-REF-A82', 'Table-top chain 38.1 pitch, 82.6 wide, rod 6.4 (public size class A)', { pitch: 38.1, width: 82.6, thickness: 10.4, pinDia: 6.4, modules: 10 }), mbV('MB-REF-A114', 'Table-top chain 38.1 pitch, 114.3 wide, rod 6.4 (class A)', { pitch: 38.1, width: 114.3, thickness: 10.4, pinDia: 6.4, modules: 10 }), mbV('MB-REF-A152', 'Table-top chain 38.1 pitch, 152.4 wide, rod 6.4 (class A)', { pitch: 38.1, width: 152.4, thickness: 10.4, pinDia: 6.4, modules: 10 }),
      mbV('MB-REF-B82', 'Table-top chain 38.1 pitch, 82.6 wide, rod 7.1 (public size class B)', { pitch: 38.1, width: 82.6, thickness: 11.2, pinDia: 7.1, modules: 10 }), mbV('MB-REF-B114', 'Table-top chain 38.1 pitch, 114.3 wide, rod 7.1 (class B)', { pitch: 38.1, width: 114.3, thickness: 11.2, pinDia: 7.1, modules: 10 }),
      mbV('MB-REF-C114', 'Table-top chain 38.1 pitch, 114.3 wide, rod 8.6 (public size class C)', { pitch: 38.1, width: 114.3, thickness: 13.8, pinDia: 8.6, modules: 10 }), mbV('MB-REF-C190', 'Table-top chain 38.1 pitch, 190.5 wide, rod 8.6 (class C)', { pitch: 38.1, width: 190.5, thickness: 13.8, pinDia: 8.6, modules: 10 }),
      mbV('MB-SS', 'Stainless steel flat-top chain', { pitch: 38.1, width: 100, material: 'SS 304', thickness: 6, pinDia: 5, modules: 8 })] }),
  mk({ id: 'chainlink', name: 'Roller chain (plain, attachment or hollow pin)', category: 'A', subcategory: 'Roller chains', description: 'A length of roller chain from the standard sizes (ISO 606 and ASME B29.1): choose the size, the number of links, optional attachment lugs and a solid or hollow pin.',
    keywords: ['roller chain', 'chain', 'attachment chain', 'hollow pin', 'hollow-pin', 'K1', 'links', 'pins', 'rollers', 'double hinge', 'straight running', 'specialty'], applications: ['roller chain lengths for drives and conveying'], standards: ['ISO 606', 'ASME B29.1'], related: ['sprocket'],
    fields: CH_FIELDS, defaults: chDefaults, build: buildChain, partNo: (p) => `CH-${String(p.chain).replace(/[^A-Za-z0-9]/g, '')}-${p.links}L`,
    variants: [V('CH-08B', '08B-1 roller chain, 12 links', chDefaults), V('CH-10B', '10B-1 roller chain, 20 links', { ...chDefaults, chain: '10B-1', links: 20 }), V('CH-12B-K1', '12B-1 with K1 lugs, 16 links', { ...chDefaults, chain: '12B-1', links: 16, attach: 'k1' }), V('CH-16B-H', '16B-1 hollow-pin chain, 10 links', { ...chDefaults, chain: '16B-1', links: 10, hollow: 'hollow' }), V('CH-ANSI40', 'ANSI 40 chain, 24 links', { ...chDefaults, chain: 'ANSI 40', links: 24 }), V('CH-SS', '08B-1 stainless chain, 12 links', { ...chDefaults, material: 'SS 304', density: 8 })] }),
  mk({ id: 'brghousing', name: 'Bearing housing (flange / pillow block)', category: 'E', subcategory: 'Pillow block and flange bearing housings', description: 'Square or round flange housing with bolt holes, or a foot-mounted pillow block, with a boss and bore. Type the bore, boss, flange and bolt sizes.',
    keywords: ['pillow block', 'flange bearing', 'flange housing', 'bearing housing', 'plummer', 'UCP', 'UCF', 'UCFL', 'plastic bearing housing', 'stainless bearing housing'], applications: ['shaft support on conveyor frames'], standards: ['User-specified dimensions'], related: ['bearing', 'bushing'],
    fields: BH_FIELDS, defaults: bhDefaults, build: buildBearingHousing, partNo: (p) => `BH-${String(p.type).toUpperCase().slice(0, 3)}-${p.bore}`,
    variants: [bhV('BH-F25', 'Square flange housing, bore 25', {}), bhV('BH-F20', 'Square flange housing, bore 20', { bore: 20, hubDia: 38, size: 86, boltSpacing: 63.5, boltDia: 10, flangeThk: 11 }), bhV('BH-F30', 'Square flange housing, bore 30', { bore: 30, hubDia: 50, size: 108, boltSpacing: 80, boltDia: 12, flangeThk: 13 }), bhV('BH-R25', 'Round flange housing, 4 bolts', { type: 'flange_round', size: 100, boltSpacing: 76 }),
      bhV('BH-P25', 'Pillow block, bore 25', { type: 'pillow', size: 127, flangeThk: 12, height: 36, hubDia: 46, length: 38 }), bhV('BH-P40', 'Pillow block, bore 40', { type: 'pillow', bore: 40, hubDia: 66, size: 175, flangeThk: 16, height: 49.2, length: 50 }), bhV('BH-SS25', 'Stainless flange housing, bore 25', { material: 'SS 304', density: 8 }), bhV('BH-PL25', 'Plastic flange housing, bore 25', { material: 'Nylon PA6', density: 1.14 })] }),
  mk({ id: 'coupling', name: 'Shaft coupling (sleeve / jaw / flange)', category: 'I', subcategory: 'Couplings', description: 'Rigid sleeve, jaw coupling with spider, or bolted flange coupling, with two bores, outer diameter and length.',
    keywords: ['coupling', 'shaft coupling', 'jaw coupling', 'flange coupling', 'sleeve coupling', 'rigid coupling', 'spider', 'transmission', 'drive coupling'], applications: ['joining drive and driven shafts'], standards: ['User-specified dimensions'], related: ['shaft'],
    fields: CP_FIELDS, defaults: cpDefaults, build: buildCoupling, partNo: (p) => `CPL-${String(p.type).toUpperCase().slice(0, 3)}-${p.bore1}-${p.bore2}`,
    variants: [V('CP-SLEEVE', 'Rigid sleeve coupling bore 20', cpDefaults), V('CP-JAW', 'Jaw coupling, bores 20/25', { ...cpDefaults, type: 'jaw', bore2: 25, od: 55, hubOd: 50, length: 70 }), V('CP-JAW30', 'Jaw coupling, bores 30/30', { ...cpDefaults, type: 'jaw', bore1: 30, bore2: 30, od: 68, hubOd: 60, length: 78 }), V('CP-SLEEVE30', 'Rigid sleeve coupling bore 30', { ...cpDefaults, bore1: 30, bore2: 30, od: 55, length: 80 }), V('CP-SLEEVE25-20', 'Rigid sleeve, bores 25/20', { ...cpDefaults, bore1: 25, bore2: 20, od: 48 }), V('CP-FLANGE', 'Flange coupling, bores 25', { ...cpDefaults, type: 'flange', bore1: 25, bore2: 25, od: 100, hubOd: 55, length: 80, boltDia: 9 })] }),
  mk({ id: 'collar', name: 'Shaft collar (set screw / clamp / split)', category: 'J', subcategory: 'Shaft collars and lock collars', description: 'Shaft collar with bore, outer diameter and width, in set screw, clamp or split style.',
    keywords: ['collar', 'shaft collar', 'lock collar', 'locking collar', 'clamp collar', 'split collar', 'set screw collar', 'stop collar'], applications: ['positioning parts on shafts'], standards: ['User-specified dimensions'], related: ['bushing'],
    fields: CO_FIELDS, defaults: coDefaults, build: buildCollar, partNo: (p) => `SC-${String(p.type).toUpperCase().slice(0, 3)}-${p.bore}`,
    variants: [V('CO-25', 'Set screw collar bore 25', coDefaults), V('CO-20', 'Set screw collar bore 20', { ...coDefaults, bore: 20, od: 36, width: 14 }), V('CO-CL25', 'Clamp collar bore 25', { ...coDefaults, type: 'clamp' }), V('CO-30', 'Set screw collar bore 30', { ...coDefaults, bore: 30, od: 54, width: 18 }), V('CO-CL40', 'Clamp collar bore 40', { ...coDefaults, type: 'clamp', bore: 40, od: 70, width: 20 }), V('CO-SP40', 'Split collar bore 40', { ...coDefaults, type: 'split', bore: 40, od: 70, width: 20 })] }),
  mk({ id: 'circlip', name: 'Retaining ring / circlip (external or internal)', category: 'E', subcategory: 'Retaining rings', description: 'C-shaped retaining ring for a shaft groove or a bore groove: type the diameter, thickness, ring width, groove depth and opening angle.',
    keywords: ['retaining ring', 'circlip', 'snap ring', 'DIN 471', 'DIN 472', 'external circlip', 'internal circlip', 'seeger'], applications: ['axial location of bearings and sprockets'], standards: ['User-specified dimensions (compare with DIN 471 / DIN 472)'], related: ['bearing'],
    fields: CL_FIELDS, defaults: clDefaults, build: buildCirclip, partNo: (p) => `RR-${String(p.type).toUpperCase().slice(0, 3)}-${p.d}`,
    variants: [V('RR-E20', 'External ring for shaft 20', clDefaults), V('RR-E25', 'External ring for shaft 25', { ...clDefaults, d: 25, s: 1.2, b: 2.5, gd: 1 }), V('RR-E30', 'External ring for shaft 30', { ...clDefaults, d: 30, s: 1.5, b: 3, gd: 1.2 }), V('RR-E40', 'External ring for shaft 40', { ...clDefaults, d: 40, s: 1.75, b: 3.9, gd: 1.5 }), V('RR-I47', 'Internal ring for bore 47', { ...clDefaults, type: 'internal', d: 47, s: 1.75, b: 3.7, gd: 1.5 }), V('RR-I52', 'Internal ring for bore 52', { ...clDefaults, type: 'internal', d: 52, s: 2, b: 4, gd: 1.5 })] }),
  mk({ id: 'takeup', name: 'Take-up / tensioning unit (screw type)', category: 'G', subcategory: 'Take-up and tensioning units', description: 'Slotted base plate with a sliding bearing block and an adjusting screw for chain or belt tensioning. Type bore, travel and plate sizes.',
    keywords: ['take-up', 'takeup', 'tensioner', 'tensioning unit', 'tension', 'screw take-up', 'adjusting', 'slide', 'belt tension', 'chain tension'], applications: ['tensioning chains and belts'], standards: ['User-specified dimensions'], related: ['brghousing', 'plate'],
    fields: TU_FIELDS, defaults: tuDefaults, build: buildTakeup, partNo: (p) => `TU-${p.bore}-${p.travel}`,
    variants: [V('TU-25', 'Take-up unit bore 25, travel 80', tuDefaults), V('TU-20', 'Take-up unit bore 20, travel 60', { ...tuDefaults, bore: 20, travel: 60, plateLen: 220, plateWid: 70, blockSize: 50, rodDia: 10 }), V('TU-30', 'Take-up unit bore 30, travel 100', { ...tuDefaults, bore: 30, travel: 100, plateLen: 300, plateWid: 90, blockSize: 70, blockThk: 30, rodDia: 14 }), V('TU-35', 'Take-up unit bore 35, travel 100', { ...tuDefaults, bore: 35, travel: 100, plateLen: 320, plateWid: 100, plateThk: 10, blockSize: 75, blockThk: 30, rodDia: 14 }), V('TU-50', 'Take-up unit bore 50, travel 150', { ...tuDefaults, bore: 50, travel: 150, plateLen: 420, plateWid: 130, plateThk: 12, blockSize: 100, blockThk: 40, rodDia: 20 }), V('TU-40', 'Take-up unit bore 40, travel 120', { ...tuDefaults, bore: 40, travel: 120, plateLen: 360, plateWid: 110, plateThk: 10, blockSize: 85, blockThk: 35, rodDia: 16 })] }),
  mk({ id: 'lbracket', name: 'Bent bracket / stop / side guard / clamp / mount', category: 'G', subcategory: 'Brackets, guards, stops and mounts', description: 'An L-shaped bent part: type the two leg lengths, width, thickness and holes. Starting values are given for brackets, end stops, side guards, belt guides, clamps and sensor mounts.',
    keywords: ['bracket', 'end stop', 'side guard', 'belt guide', 'clamp', 'connector', 'hinge', 'sensor mount', 'proximity switch mount', 'guard', 'angle bracket', 'L bracket', 'support bracket'], applications: ['brackets, stops, guides and mounts'], standards: ['User-specified dimensions'], related: ['angle', 'plate'],
    fields: LB_FIELDS, defaults: lbDefaults, build: buildLBracket, partNo: (p) => `LB-${p.leg1}x${p.leg2}x${p.width}`,
    variants: [lbV('LB-BRACKET', 'Mounting bracket 60 x 60 x 40', {}), lbV('LB-ENDSTOP', 'End stop', { leg1: 80, leg2: 70, width: 100, thk: 8, holes: 2, holeDia: 11, edge: 20 }), lbV('LB-SIDEGUARD', 'Side guard', { leg1: 40, leg2: 120, width: 500, thk: 3, holes: 2, holeDia: 8, edge: 12, material: 'SS 304', density: 8 }), lbV('LB-BELTGUIDE', 'Belt guide angle', { leg1: 30, leg2: 40, width: 1000, thk: 4, holes: 0, material: 'UHMW-PE', density: 0.93 }),
      lbV('LB-CLAMP', 'Clamp bracket', { leg1: 50, leg2: 40, width: 30, thk: 5, holes: 1, holeDia: 9, edge: 18 }), lbV('LB-SENSOR', 'Sensor mount', { leg1: 40, leg2: 50, width: 25, thk: 3, holes: 2, holeDia: 6.5, edge: 8 }), lbV('LB-CONNECT', 'Connecting angle', { leg1: 45, leg2: 45, width: 40, thk: 4, holes: 2, holeDia: 9, edge: 12 }), lbV('LB-HINGE', 'Hinge leaf', { leg1: 50, leg2: 50, width: 60, thk: 3, holes: 2, holeDia: 6.5, edge: 10 })] }),
  mk({ id: 'motor', name: 'Motor / gearbox (outline model)', category: 'I', subcategory: 'Motors and gearboxes', description: 'Outline model of a flange-mounted electric motor or gearbox, for layout and clash checking. Type body, flange and shaft sizes. Mass and ratings are not calculated.',
    keywords: ['motor', 'electric motor', 'gearbox', 'gear motor', 'geared motor', 'reducer', 'drive unit', 'B14', 'B5', 'flange mounted', 'drive'], applications: ['conveyor drives (layout only)'], standards: ['User-specified dimensions'], related: ['coupling', 'shaft'],
    fields: MO_FIELDS, defaults: moDefaults, build: buildMotor, partNo: (p) => `${String(p.type).toUpperCase().slice(0, 3)}-${p.bodyD}x${p.bodyLen}`,
    variants: [V('MO-90', 'Motor frame 90 (flange 160)', moDefaults), V('MO-71', 'Motor frame 71 (flange 105)', { ...moDefaults, bodyD: 110, bodyLen: 160, flangeA: 105, flangeThk: 8, pcd: 85, boltDia: 7, shaftD: 14, shaftLen: 30, fan: 35 }), V('MO-FOOT', 'Foot-mounted motor', { ...moDefaults, foot: 'yes' }), V('MO-80', 'Motor frame 80 (flange 120)', { ...moDefaults, bodyD: 125, bodyLen: 175, flangeA: 120, flangeThk: 10, pcd: 100, boltDia: 7, shaftD: 19, shaftLen: 40, fan: 38 }), V('MO-100', 'Motor frame 100 (flange 200)', { ...moDefaults, bodyD: 170, bodyLen: 230, flangeA: 200, flangeThk: 14, pcd: 165, boltDia: 11, shaftD: 28, shaftLen: 60, fan: 45 }), V('GB-100', 'Gearbox 100 mm housing', { ...moDefaults, type: 'gearbox', bodyD: 100, bodyLen: 120, flangeA: 120, pcd: 100, shaftD: 25, shaftLen: 55 })] }),
  mk({ id: 'setscrew', name: 'Set screw / grub screw (hex socket)', category: 'J', subcategory: 'Set screws and grub screws', description: 'Hexagon socket set (grub) screw M3 to M16 with the standard key size, in any length.',
    keywords: ['set screw', 'grub screw', 'hex socket', 'allen', 'ISO 4026', 'ISO 4029', 'locking screw'], applications: ['locking collars, sprockets and hubs on shafts'], standards: ['ISO 4026 (hexagon socket set screws, flat point)'], related: ['capscrew', 'hexbolt'],
    fields: SS_FIELDS, defaults: ssDefaults, build: buildSetScrew, partNo: (p) => `SS-${p.size}x${p.length}`,
    variants: Object.keys(SS_SIZES).map((k) => V(`SS-${k}`, `${k} set screw x ${k === 'M3' ? 6 : k === 'M4' ? 8 : k === 'M5' ? 10 : k === 'M6' ? 12 : k === 'M8' ? 16 : k === 'M10' ? 20 : k === 'M12' ? 25 : 30}`, { ...ssDefaults, size: k, length: k === 'M3' ? 6 : k === 'M4' ? 8 : k === 'M5' ? 10 : k === 'M6' ? 12 : k === 'M8' ? 16 : k === 'M10' ? 20 : k === 'M12' ? 25 : 30 })) }),
  mk({ id: 'greasenipple', name: 'Lubrication fitting (grease nipple)', category: 'J', subcategory: 'Lubrication fittings', description: 'Grease nipple with thread, hexagon, neck and ball head: type the sizes from the data sheet of the fitting you use.',
    keywords: ['grease nipple', 'lubrication fitting', 'zerk', 'grease fitting', 'DIN 71412', 'lubricator', 'oiler'], applications: ['greasing bearings and chains'], standards: ['User-specified dimensions (compare with DIN 71412)'], related: ['hexbolt'],
    fields: GN_FIELDS, defaults: gnDefaults, build: buildGrease, partNo: (p) => `GN-M${p.d}`,
    variants: [V('GN-M6', 'Grease nipple M6', gnDefaults), V('GN-M8', 'Grease nipple M8', { ...gnDefaults, d: 8, s: 11, tl: 8, head: 8 }), V('GN-M5', 'Grease nipple M5', { ...gnDefaults, d: 5, s: 8, tl: 6, hh: 3, head: 6, neck: 5 }), V('GN-M6S', 'Grease nipple M6 stainless', { ...gnDefaults, material: 'SS 304' }), V('GN-M12', 'Grease nipple M12', { ...gnDefaults, d: 12, s: 14, tl: 12, hh: 5, head: 10, neck: 7 }), V('GN-M10', 'Grease nipple M10', { ...gnDefaults, d: 10, s: 13, tl: 10, hh: 5, head: 9 })] }),
  mk({ id: 'taperroll', name: 'Tapered roller (for curves)', category: 'D', subcategory: 'Tapered rollers', description: 'A roller that is larger at one end than the other, used in curved roller conveyors. Type both end diameters, length and optional stub shafts. The taper is built as a stack of short steps.',
    keywords: ['tapered roller', 'taper roller', 'conical roller', 'curve roller', 'curved conveyor roller', 'cone roller'], applications: ['curved roller conveyors'], standards: ['User-specified dimensions'], related: ['roller'],
    fields: TR_FIELDS, defaults: trDefaults, build: buildTaper, partNo: (p) => `TR-${p.d1}-${p.d2}x${p.length}`,
    variants: [V('TR-60-90', 'Tapered roller 60 to 90 x 500', trDefaults), V('TR-50-80', 'Tapered roller 50 to 80 x 400', { ...trDefaults, d1: 50, d2: 80, length: 400 }), V('TR-60-100', 'Tapered roller 60 to 100 x 600', { ...trDefaults, d1: 60, d2: 100, length: 600, stub: 25 }), V('TR-50-75-PL', 'Plastic tapered roller 50 to 75', { ...trDefaults, d1: 50, d2: 75, length: 300, material: 'Nylon PA6', density: 1.14 }), V('TR-40-60', 'Tapered roller 40 to 60 x 300', { ...trDefaults, d1: 40, d2: 60, length: 300, stub: 15, stubLen: 20 }), V('TR-76-114', 'Tapered roller 76 to 114 x 700', { ...trDefaults, d1: 76, d2: 114, length: 700, stub: 30, stubLen: 30 })] }),
  mk({ id: 'curved', name: 'Curved conveyor section (bed and side guards)', category: 'H', subcategory: 'Curved sections', description: 'A curved section of conveyor bed with side guards: type inside radius, track width, curve angle, plate thickness and guard height.',
    keywords: ['curved conveyor', 'curve', 'bend', 'radius', 'turn', '90 degree', '45 degree', '180 degree', 'curved section'], applications: ['curved chain, belt and roller conveyors'], standards: ['User-specified dimensions'], related: ['plate'],
    fields: CV_FIELDS, defaults: cvDefaults, build: buildCurved, partNo: (p) => `CV-${p.angle}D-R${p.innerR}`,
    variants: [V('CV-90', '90 degree curve, inside radius 600', cvDefaults), V('CV-45', '45 degree curve, inside radius 800', { ...cvDefaults, angle: 45, innerR: 800 }), V('CV-180', '180 degree curve, inside radius 500', { ...cvDefaults, angle: 180, innerR: 500, width: 200 }), V('CV-30', '30 degree curve, inside radius 1000', { ...cvDefaults, angle: 30, innerR: 1000 }), V('CV-90W', '90 degree curve, 500 wide', { ...cvDefaults, width: 500, innerR: 900 }), V('CV-90S', '90 degree curve, mild steel, no guards', { ...cvDefaults, guardH: 0, material: 'S235 Steel', density: 7.85 })] }),
];
