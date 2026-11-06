import type { Family, Variant } from '../core/family.ts';
import type { Params } from '../core/types.ts';
import { slug } from '../core/util.ts';
import { primsSolid } from '../core/primsSolid.ts';
import { ROLLER_CHAINS } from '../data/chains.ts';
import { BEARINGS } from '../data/bearings.ts';
import { KEYS } from '../data/keys.ts';
import { calcSprocket, SPROCKET_FIELDS, SPROCKET_MATERIALS, sprocketDefaults } from './sprocket/calc.ts';
import { sprocketGeo, sprocketViews } from './sprocket/drawing.ts';
import { sprocketSolid } from './sprocket/three.ts';
import { calcShaft, SHAFT_FIELDS, SHAFT_MATERIALS } from './shaft/calc.ts';
import { shaftGeo, shaftViews } from './shaft/drawing.ts';
import { shaftSolid } from './shaft/three.ts';
import { BEARING_FIELDS, BEARING_MATERIALS, calcBearing } from './bearing/calc.ts';
import { bearingGeo, bearingViews } from './bearing/drawing.ts';
import { bearingSolid } from './bearing/three.ts';
import * as F from './extra/fasteners.ts';
import * as M from './extra/mechanical.ts';
import * as P from './extra/profiles.ts';
import * as N from './extra/more.ts';
import { AUTOFILL, BASIC } from './autofill.ts';
import { CUSTOM_FAMILIES } from './custom/custom.ts';

const f2 = (n: unknown) => String(+Number(n).toFixed(2));
const kd = (label: string, v: number, unit = 'mm') => ({ label, value: f2(v), unit });
const V = (id: string, name: string, params: Params): Variant => ({ id, name, params });

/* ---------- variants ---------- */
const sprocketVariants: Variant[] = [];
for (const c of ROLLER_CHAINS) for (const z of [9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 30, 38, 45]) { const p = sprocketDefaults(c.id, z); sprocketVariants.push(V(`SP-${slug(c.id)}-Z${z}`, `${c.id} chain sprocket, ${z} teeth, bore ${p.bore} mm`, p)); }
const shaftDefaults: Params = { d1: 25, l1: 200, d2: 0, l2: 0, d3: 0, l3: 0, torque: 0, sf: 3, material: 'C45 Steel' };
const shaftVariants: Variant[] = [];
for (const d of [12, 15, 20, 25, 30, 35, 40, 50]) for (const l of [100, 200, 400, 800]) shaftVariants.push(V(`SH-D${d}-L${l}`, `Round shaft Ø${d} x ${l} mm`, { ...shaftDefaults, d1: d, l1: l }));
const bearingDefaults: Params = { designation: '6205', d: 25, D: 52, B: 15, material: 'Chrome Steel 100Cr6' };
const bearingVariants = BEARINGS.map((b) => V(`BB-${b.id}`, `Deep groove ball bearing ${b.id} (${b.d} x ${b.D} x ${b.B})`, { ...bearingDefaults, designation: b.id, d: b.d, D: b.D, B: b.B }));
const keyVariants: Variant[] = [];
for (const k of KEYS) { const d = k.upTo; for (const L of [16, 20, 25, 32, 40, 50, 63, 80, 100]) if (L >= 0.8 * d && L <= 2.2 * d) keyVariants.push(V(`KY-D${d}-L${L}`, `Parallel key ${k.b}x${k.h}x${L} for shaft Ø${d}`, { ...F.keyDefaults, shaftDia: d, length: L })); }
const washerVariants = Object.keys(F.WASHERS).map((s) => V(`WS-${s}`, `Plain washer ${s} (ISO 7089)`, { ...F.washerDefaults, size: s }));
const nutVariants = Object.keys(F.NUTS).map((s) => V(`NT-${s}`, `Hexagon nut ${s} (ISO 4032)`, { ...F.nutDefaults, size: s }));
const bushVariants: Variant[] = [];
for (const [b, o] of [[10, 16], [12, 18], [15, 21], [20, 28], [25, 32], [30, 38], [40, 48]]) for (const L of [10, 20, 30, 40]) bushVariants.push(V(`BU-B${b}-O${o}-L${L}`, `Sleeve / spacer bore ${b}, OD ${o}, length ${L}`, { ...M.bushDefaults, boreDia: b, outerDia: o, length: L }));
const rollerVariants: Variant[] = [];
for (const od of [30, 40, 50, 60, 76]) for (const L of [200, 400, 600, 800]) rollerVariants.push(V(`RL-D${od}-L${L}`, `Conveyor roller Ø${od} x ${L} mm`, { ...M.rollerDefaults, tubeOD: od, tubeLength: L, wall: od <= 40 ? 2 : 2.5, stubDia: od <= 40 ? 12 : 15 }));
const hexVariants: Variant[] = [];
for (const s of [10, 13, 17, 19, 22, 24, 30]) for (const L of [200, 500, 1000]) hexVariants.push(V(`HX-S${s}-L${L}`, `Hexagonal shaft ${s} AF x ${L} mm`, { ...M.hexShaftDefaults, af: s, length: L }));
const stripVariants: Variant[] = [];
for (const w of [15, 20, 25, 30, 40]) for (const t of [5, 8, 10]) stripVariants.push(V(`WR-${w}x${t}x1000`, `UHMW wear strip ${w} x ${t} x 1000 mm`, { ...P.stripDefaults, width: w, thickness: t }));
const angleVariants: Variant[] = [];
for (const [a, b, t] of [[20, 20, 3], [25, 25, 3], [30, 30, 3], [40, 40, 4], [50, 50, 5], [40, 20, 3], [60, 40, 5]]) for (const L of [1000, 2000]) angleVariants.push(V(`AN-${a}x${b}x${t}-L${L}`, `Angle guide ${a}x${b}x${t}, ${L} mm`, { ...P.angleDefaults, a, b, t, length: L }));
const rhsVariants: Variant[] = [];
for (const [w, h, t] of [[20, 20, 2], [30, 30, 2], [40, 40, 3], [50, 50, 3], [60, 40, 3], [60, 60, 4], [80, 40, 4], [80, 80, 4]]) for (const L of [1000, 2000]) rhsVariants.push(V(`RH-${w}x${h}x${t}-L${L}`, `Hollow section ${w}x${h}x${t}, ${L} mm`, { ...P.rhsDefaults, w, h, t, length: L, span: L }));


const boltVariants: Variant[] = [];
for (const s of Object.keys(N.BOLTS)) { const d = Number(s.slice(1)); for (const L of [16, 20, 25, 30, 40, 50, 60, 80, 100]) if (L >= 2 * d && L <= 12 * d) boltVariants.push(V(`HB-${s}x${L}`, `Hex bolt ${s} x ${L} (ISO 4017)`, { ...N.boltDefaults, size: s, length: L })); }
const capVariants: Variant[] = [];
for (const s of Object.keys(N.CAPS)) { const d = Number(s.slice(1)); for (const L of [8, 10, 12, 16, 20, 25, 30, 40, 50, 60]) if (L >= 1.5 * d && L <= 10 * d) capVariants.push(V(`CS-${s}x${L}`, `Socket cap screw ${s} x ${L} (ISO 4762)`, { ...N.capDefaults, size: s, length: L })); }
const dowelVariants: Variant[] = [];
for (const d of [3, 4, 5, 6, 8, 10, 12, 16]) for (const L of [10, 16, 20, 24, 30, 40, 50, 60]) if (L >= 2 * d && L <= 8 * d) dowelVariants.push(V(`DP-${d}x${L}`, `Dowel pin Ø${d} x ${L}`, { ...N.dowelDefaults, dia: d, length: L }));
const pulleyVariants: Variant[] = [];
for (const [D, W, b] of [[80, 50, 20], [100, 60, 25], [120, 60, 25], [150, 80, 30], [200, 100, 35], [250, 120, 40]]) { const p = AUTOFILL.pulley({ ...N.pulleyDefaults, outerDia: D, faceWidth: W, bore: b }, 'bore'); pulleyVariants.push(V(`PU-D${D}-W${W}-B${b}`, `Belt pulley Ø${D} x ${W}, bore ${b}`, p)); }
const wheelVariants: Variant[] = [];
for (const [D, W, b] of [[40, 15, 8], [50, 18, 10], [60, 20, 12], [80, 25, 15], [100, 30, 20], [120, 35, 25]]) wheelVariants.push(V(`GW-D${D}-W${W}`, `Guide wheel Ø${D} x ${W}, bore ${b}`, { ...N.wheelDefaults, ...AUTOFILL.guidewheel({ ...N.wheelDefaults, trackDia: D }, 'trackDia'), trackDia: D, trackWidth: W, bore: b }));
const channelVariants: Variant[] = [];
for (const [H, B] of [[40, 25], [60, 30], [80, 40], [100, 50], [120, 55], [160, 65]]) for (const L of [1000, 2000]) channelVariants.push(V(`CH-${H}x${B}-L${L}`, `U-channel ${H}x${B}, ${L} mm`, { ...N.channelDefaults, ...AUTOFILL.channel({ ...N.channelDefaults, height: H }, 'height'), height: H, flange: B, length: L, span: L }));
const tubeVariants: Variant[] = [];
for (const od of [21.3, 26.9, 33.7, 42.4, 48.3, 60.3, 76.1]) for (const L of [1000, 2000]) tubeVariants.push(V(`RT-${od}-L${L}`, `Round tube Ø${od}, ${L} mm`, { ...N.tubeDefaults, od, wall: od <= 30 ? 2 : od <= 60 ? 3 : 4, length: L, span: L }));
const legVariants: Variant[] = [];
for (const od of [30, 40, 50, 60]) for (const H of [400, 600, 800, 1000]) legVariants.push(V(`LG-D${od}-H${H}`, `Adjustable leg Ø${od} x ${H}`, { ...N.legDefaults, ...AUTOFILL.leg({ ...N.legDefaults, tubeOD: od }, 'tubeOD'), tubeOD: od, height: H }));
const plateVariants: Variant[] = [];
for (const [L, W, t] of [[100, 60, 5], [120, 80, 5], [150, 80, 6], [200, 100, 6], [250, 120, 8], [300, 150, 8], [400, 200, 10], [500, 250, 12]]) plateVariants.push(V(`PL-${L}x${W}x${t}`, `Mounting plate ${L} x ${W} x ${t}`, { ...N.plateDefaults, ...AUTOFILL.plate({ ...N.plateDefaults, length: L, width: W }, 'length'), length: L, width: W, thickness: t }));

const base = { related: [] as string[] };
const RAW: Omit<Family, 'basic' | 'autofill'>[] = [
  { ...base, id: 'sprocket', name: 'Roller chain sprocket', category: 'B', subcategory: 'Drive / driven / idler sprockets',
    description: 'Single-strand sprocket for ISO 606 / ASME B29.1 roller chain with the ISO 606 tooth profile (seat arc, flank arc, tip arc), optional hub and keyway.',
    keywords: ['sprocket', 'tooth', 'teeth', 'chain wheel', 'drive sprocket', 'driven sprocket', 'idler sprocket', 'roller chain', 'pitch', 'bore', 'keyway', 'hub'],
    materials: SPROCKET_MATERIALS, applications: ['chain drive', 'conveyor drive', 'conveyor idler', 'power transmission'], standards: ['ISO 606', 'ASME B29.1', 'DIN 6885-1 / ISO 773'], related: ['shaft', 'bearing', 'key'],
    fields: SPROCKET_FIELDS, defaults: sprocketDefaults('08B-1', 17), variants: sprocketVariants,
    calculate: calcSprocket, views: sprocketViews, geo: sprocketGeo, solid: sprocketSolid,
    asm: (c) => ({ role: 'bore', bore: c.bore, chainPitch: c.p, chain: `p${f2(c.p)}-d${f2(c.d1)}` }),
    partNo: (p) => `SP-${slug(String(p.chain))}-Z${p.teeth}-B${p.bore}`, materialOf: (p) => String(p.material),
    keyDims: (c) => [kd('Pitch dia', c.d), kd('Tip dia', c.da), kd('Bore', c.bore), kd('Width', c.width)],
    notes: (c) => [`ROLLER CHAIN PITCH ${f2(c.p)} MM, ${c.z} TEETH, TOOTH FORM PER ISO 606`, c.key ? `KEYWAY ${c.key.b} x ${c.key.h} PER ISO 773 (HUB DEPTH t2 = ${c.key.t2})` : 'NO KEYWAY', 'ALL DIMENSIONS IN MM UNLESS STATED', 'GENERAL TOLERANCES NOT SPECIFIED'] },
  { ...base, id: 'shaft', name: 'Stepped round shaft', category: 'D', subcategory: 'Drive / idler / stepped shafts',
    description: 'Plain round shaft with up to three diameter steps and an optional preliminary torsion check. Keyways, grooves and threads are not yet modelled.',
    keywords: ['shaft', 'drive shaft', 'idler shaft', 'round shaft', 'stepped shaft', 'machined shaft', 'axle', 'torque'],
    materials: SHAFT_MATERIALS, applications: ['conveyor drive shaft', 'idler shaft', 'roller axle'], standards: ['ISO 286 (user tolerances only)'], related: ['sprocket', 'bearing', 'bushing'],
    fields: SHAFT_FIELDS, defaults: shaftDefaults, variants: shaftVariants, calculate: calcShaft, views: shaftViews, geo: shaftGeo, solid: shaftSolid,
    asm: (c) => ({ role: 'shaft', sections: c.sections.map((s: { d: number; x0: number; l: number }) => ({ d: s.d, z0: s.x0, z1: s.x0 + s.l })) }),
    partNo: (p) => `SH-D${p.d1}-L${Number(p.l1) + Number(p.l2 || 0) + Number(p.l3 || 0)}`, materialOf: (p) => String(p.material),
    keyDims: (c) => [kd('Length', c.total), kd('Largest dia', Math.max(...c.sections.map((s: { d: number }) => s.d))), { label: 'Sections', value: String(c.sections.length) }],
    notes: () => ['PLAIN STEPPED SHAFT - NO KEYWAYS, CHAMFERS OR THREADS', 'ALL DIMENSIONS IN MM UNLESS STATED', 'GENERAL TOLERANCES NOT SPECIFIED'] },
  { ...base, id: 'bearing', name: 'Deep groove ball bearing', category: 'E', subcategory: 'Ball bearings',
    description: 'Radial deep groove ball bearing with ISO 15 boundary dimensions. Internal geometry is illustrative; use for layout and assembly envelopes, not for load or life selection.',
    keywords: ['bearing', 'ball bearing', 'deep groove', '6205', '6204', '6206', 'radial bearing'], materials: BEARING_MATERIALS, applications: ['shaft support', 'roller support', 'idler support'], standards: ['ISO 15'], related: ['shaft', 'sprocket', 'bushing'],
    fields: BEARING_FIELDS, defaults: bearingDefaults, variants: bearingVariants, calculate: calcBearing, views: bearingViews, geo: bearingGeo, solid: bearingSolid,
    asm: (c) => ({ role: 'bore', bore: c.d }),
    partNo: (p) => (p.designation === 'CUSTOM' ? `BB-${p.d}x${p.D}x${p.B}` : `BB-${p.designation}`), materialOf: (p) => String(p.material),
    keyDims: (c) => [kd('Bore d', c.d), kd('Outside D', c.D), kd('Width B', c.B)], notes: () => ['BOUNDARY DIMENSIONS PER ISO 15', 'INTERNAL GEOMETRY ILLUSTRATIVE ONLY', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'key', name: 'Parallel key (DIN 6885)', category: 'E', subcategory: 'Keys',
    description: 'Parallel key form B with cross-section from DIN 6885-1 for the shaft diameter, plus optional shear and contact-pressure check.', keywords: ['key', 'parallel key', 'feather key', 'keyway', 'DIN 6885'],
    materials: F.KEY_MATERIALS, applications: ['shaft-hub connection', 'sprocket drive'], standards: ['DIN 6885-1', 'ISO 773'], related: ['shaft', 'sprocket'],
    fields: F.KEY_FIELDS, defaults: F.keyDefaults, variants: keyVariants, calculate: F.calcKey, views: F.keyViews, geo: F.keyGeo, solid: (R, c) => primsSolid(R, F.keyGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `KY-D${p.shaftDia}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Length', c.L), kd('b', c.b), kd('h', c.h)], notes: (c) => [`PARALLEL KEY ${c.b} x ${c.h} x ${f2(c.L)} FORM B, DIN 6885-1`, 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'washer', name: 'Plain washer (ISO 7089)', category: 'E', subcategory: 'Washers', description: 'Plain washer, normal series, with standard dimensions M3 to M24 or custom size.',
    keywords: ['washer', 'flat washer', 'ISO 7089', 'plain washer'], materials: F.WASHER_MATERIALS, applications: ['fastening', 'load spreading'], standards: ['ISO 7089'], related: ['hexnut', 'bushing'],
    fields: F.WASHER_FIELDS, defaults: F.washerDefaults, variants: washerVariants, calculate: F.calcWasher, views: F.washerViews, geo: F.washerGeo, solid: (R, c) => primsSolid(R, F.washerGeo(c)), asm: (c) => ({ role: 'bore', bore: c.d1, thread: true }),
    partNo: (p) => `WS-${p.size === 'CUSTOM' ? `${p.d1}x${p.d2}x${p.h}` : p.size}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Inner dia', c.d1), kd('Outer dia', c.d2), kd('Thickness', c.h)], notes: () => ['PLAIN WASHER TO ISO 7089, NORMAL SERIES', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'hexnut', name: 'Hexagon nut (ISO 4032)', category: 'E', subcategory: 'Fasteners', description: 'Hexagon nut style 1 with standard width across flats and height for M5 to M24. Thread is not modelled.',
    keywords: ['nut', 'hex nut', 'hexagon nut', 'fastener', 'ISO 4032', 'bolt', 'thread'], materials: F.NUT_MATERIALS, applications: ['fastening'], standards: ['ISO 4032', 'ISO 272'], related: ['washer'],
    fields: F.NUT_FIELDS, defaults: F.nutDefaults, variants: nutVariants, calculate: F.calcNut, views: F.nutViews, geo: F.nutGeo, solid: (R, c) => primsSolid(R, F.nutGeo(c)), asm: (c) => ({ role: 'bore', bore: c.d, thread: true }),
    partNo: (p) => `NT-${p.size === 'CUSTOM' ? `D${p.dia}` : p.size}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Across flats', c.s), kd('Height', c.m)], notes: () => ['HEXAGON NUT TO ISO 4032 - THREAD NOT MODELLED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'bushing', name: 'Bushing / sleeve / spacer', category: 'E', subcategory: 'Bushings, sleeves and spacers', description: 'Plain or flanged cylindrical sleeve for bearing seats, spacing and wear protection, with wall-thickness checks and mass.',
    keywords: ['bushing', 'bush', 'sleeve', 'spacer', 'collar', 'flange bushing'], materials: M.BUSH_MATERIALS, applications: ['spacing on shaft', 'wear sleeve', 'plain bearing'], standards: ['User-specified dimensions'], related: ['shaft', 'bearing'],
    fields: M.BUSH_FIELDS, defaults: M.bushDefaults, variants: bushVariants, calculate: M.calcBushing, views: M.bushViews, geo: M.bushGeo, solid: (R, c) => primsSolid(R, M.bushGeo(c)),
    asm: (c) => ({ role: 'bore', bore: c.bore, sections: [{ d: c.od, z0: c.ft, z1: c.L }] }),
    partNo: (p) => `BU-B${p.boreDia}-O${p.outerDia}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Bore', c.bore), kd('OD', c.od), kd('Length', c.L)], notes: () => ['PLAIN SLEEVE - NO CHAMFERS OR TOLERANCES SPECIFIED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'roller', name: 'Conveyor roller', category: 'D', subcategory: 'Idler / return / gravity rollers', description: 'Tube roller with end caps and stub shafts for idler, return, gravity and plastic/stainless variants, with a simple bending and deflection check.',
    keywords: ['roller', 'idler roller', 'return roller', 'gravity roller', 'drive roller', 'plastic roller', 'stainless roller', 'tube', 'stub'], materials: M.ROLLER_MATERIALS, applications: ['belt support', 'return support', 'gravity conveying'], standards: ['Beam theory'], related: ['bearing', 'shaft', 'bushing'],
    fields: M.ROLLER_FIELDS, defaults: M.rollerDefaults, variants: rollerVariants, calculate: M.calcRoller, views: M.rollerViews, geo: M.rollerGeo, solid: (R, c) => primsSolid(R, M.rollerGeo(c)),
    asm: (c) => ({ role: 'shaft', sections: [{ d: c.stub, z0: -c.sl, z1: c.cap }, { d: c.stub, z0: c.L - c.cap, z1: c.L + c.sl }] }),
    partNo: (p) => `RL-D${p.tubeOD}-L${p.tubeLength}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Tube OD', c.od), kd('Tube length', c.L), kd('Stub dia', c.stub)], notes: () => ['END CAPS AND STUB SHAFTS FUSED TO TUBE', 'BEARING SEATS AND TOLERANCES NOT SPECIFIED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'hexshaft', name: 'Hexagonal shaft', category: 'D', subcategory: 'Hexagonal shafts', description: 'Hexagonal bar shaft with across-flats size, length and a conservative preliminary torsion check.',
    keywords: ['hexagonal shaft', 'hex shaft', 'hex bar', 'drive shaft'], materials: ['C45 Steel', 'SS 304', 'Al 6061-T6'], applications: ['drive shaft for hexagonal bores'], standards: ['ISO 272'], related: ['sprocket', 'bearing'],
    fields: M.HEXSHAFT_FIELDS, defaults: M.hexShaftDefaults, variants: hexVariants, calculate: M.calcHexShaft, views: M.hexShaftViews, geo: M.hexShaftGeo, solid: (R, c) => primsSolid(R, M.hexShaftGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `HX-S${p.af}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Across flats', c.s), kd('Length', c.L)], notes: () => ['HEXAGONAL BAR - ENDS SQUARE, NO CHAMFER', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'wearstrip', name: 'Wear strip', category: 'G', subcategory: 'Wear strips and guide profiles', description: 'Flat wear strip with evenly spaced mounting holes, edge and pitch checks and plastic expansion warnings.',
    keywords: ['wear strip', 'guide strip', 'chain guide', 'return guide', 'uhmw', 'wear rail', 'guide profile'], materials: P.STRIP_MATERIALS, applications: ['chain support', 'belt support', 'wear protection'], standards: ['User-specified dimensions'], related: ['angle', 'rhs'],
    fields: P.STRIP_FIELDS, defaults: P.stripDefaults, variants: stripVariants, calculate: P.calcStrip, views: P.stripViews, geo: P.stripGeo, solid: (R, c) => primsSolid(R, P.stripGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `WR-${p.width}x${p.thickness}x${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Length', c.L), kd('Width', c.W), kd('Thickness', c.t)], notes: (c) => [`${c.n} x Ø${f2(c.dh)} THROUGH HOLES, PITCH ${f2(c.pitch)}`, 'PLAIN HOLES, NO COUNTERSINK', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'angle', name: 'Angle guide rail', category: 'F', subcategory: 'Guide rails and side guides', description: 'Equal or unequal angle section for guide rails and side guides with area, centroid and second moments of area.',
    keywords: ['angle', 'guide rail', 'side guide', 'l-profile', 'angle profile', 'rail'], materials: P.ANGLE_MATERIALS, applications: ['guide rail', 'side guide', 'frame member'], standards: ['Section properties by polygon integration'], related: ['rhs', 'wearstrip'],
    fields: P.ANGLE_FIELDS, defaults: P.angleDefaults, variants: angleVariants, calculate: P.calcAngle, views: P.angleViews, geo: P.angleGeo, solid: (R, c) => primsSolid(R, P.angleGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `AN-${p.a}x${p.b}x${p.t}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Leg A', c.a), kd('Leg B', c.b), kd('Thickness', c.t), kd('Length', c.L)], notes: () => ['SHARP CORNERS - NO ROOT/TOE RADII', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'rhs', name: 'Rectangular hollow section', category: 'F', subcategory: 'Structural and aluminium profiles', description: 'Rectangular/square tube for frames, cross members and structures, with section properties and a simply supported beam check.',
    keywords: ['rhs', 'tube', 'square tube', 'rectangular tube', 'structural profile', 'aluminium profile', 'cross member', 'support frame', 'frame'], materials: P.RHS_MATERIALS, applications: ['frame', 'cross member', 'support structure'], standards: ['Euler-Bernoulli beam theory'], related: ['angle', 'wearstrip'],
    fields: P.RHS_FIELDS, defaults: P.rhsDefaults, variants: rhsVariants, calculate: P.calcRhs, views: P.rhsViews, geo: P.rhsGeo, solid: (R, c) => primsSolid(R, P.rhsGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `RH-${p.w}x${p.h}x${p.t}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Width', c.w), kd('Height', c.h), kd('Wall', c.t), kd('Length', c.L)], notes: () => ['SHARP CORNERS - NO CORNER RADII', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'hexbolt', name: 'Hexagon head bolt (ISO 4017)', category: 'E', subcategory: 'Fasteners', description: 'Hexagon head bolt M5 to M24 with standard head dimensions and any length. Thread is not modelled.',
    keywords: ['bolt', 'hex bolt', 'hexagon bolt', 'screw', 'fastener', 'ISO 4017', 'ISO 4014'], materials: N.BOLT_MATERIALS, applications: ['fastening', 'frame assembly'], standards: ['ISO 4017', 'ISO 4014', 'ISO 272'], related: ['hexnut', 'washer'],
    fields: N.BOLT_FIELDS, defaults: N.boltDefaults, variants: boltVariants, calculate: N.calcBolt, views: N.boltViews, geo: N.boltGeo, solid: (R, c) => primsSolid(R, N.boltGeo(c)), asm: (c) => ({ role: 'shaft', sections: [{ d: c.d, z0: c.k, z1: c.k + c.L }] }),
    partNo: (p) => `HB-${p.size}x${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Thread dia', c.d), kd('Length', c.L), kd('Head AF', c.s)], notes: () => ['HEXAGON HEAD BOLT TO ISO 4017 - THREAD NOT MODELLED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'capscrew', name: 'Socket head cap screw (ISO 4762)', category: 'E', subcategory: 'Fasteners', description: 'Hexagon socket head cap screw M3 to M20 with standard head, socket and length. Thread is not modelled.',
    keywords: ['cap screw', 'socket screw', 'allen', 'socket head', 'screw', 'fastener', 'ISO 4762', 'DIN 912'], materials: N.BOLT_MATERIALS, applications: ['fastening', 'guards and brackets'], standards: ['ISO 4762'], related: ['hexnut', 'washer'],
    fields: N.CAP_FIELDS, defaults: N.capDefaults, variants: capVariants, calculate: N.calcCap, views: N.capViews, geo: N.capGeo, solid: (R, c) => primsSolid(R, N.capGeo(c)), asm: (c) => ({ role: 'shaft', sections: [{ d: c.d, z0: c.k, z1: c.k + c.L }] }),
    partNo: (p) => `CS-${p.size}x${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Thread dia', c.d), kd('Length', c.L), kd('Head dia', c.dk)], notes: () => ['SOCKET HEAD CAP SCREW TO ISO 4762 - THREAD NOT MODELLED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'dowel', name: 'Dowel pin (ISO 2338)', category: 'E', subcategory: 'Pins', description: 'Parallel dowel pin of chosen diameter and length for locating and pinning parts.',
    keywords: ['dowel', 'pin', 'parallel pin', 'locating pin', 'ISO 2338'], materials: ['C45 Steel', 'SS 304', 'Brass CuZn39Pb3'], applications: ['locating', 'pinning'], standards: ['ISO 2338'], related: ['bushing', 'shaft'],
    fields: N.DOWEL_FIELDS, defaults: N.dowelDefaults, variants: dowelVariants, calculate: N.calcDowel, views: N.dowelViews, geo: N.dowelGeo, solid: (R, c) => primsSolid(R, N.dowelGeo(c)), asm: (c) => ({ role: 'shaft', sections: [{ d: c.d, z0: 0, z1: c.L }] }),
    partNo: (p) => `DP-${p.dia}x${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Diameter', c.d), kd('Length', c.L)], notes: () => ['PARALLEL PIN, NO END CHAMFERS', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'pulley', name: 'Belt pulley (drive / tail / idler)', category: 'I', subcategory: 'Drive and tail pulleys', description: 'Solid belt pulley with hub and keyway for drive, tail and idler positions, with optional belt-speed calculation.',
    keywords: ['pulley', 'drive pulley', 'tail pulley', 'idler pulley', 'belt drive', 'belt wheel', 'flat belt'], materials: N.PULLEY_MATERIALS, applications: ['belt drive', 'belt conveyor head and tail'], standards: ['DIN 6885-1 / ISO 773'], related: ['shaft', 'bearing', 'key'],
    fields: N.PULLEY_FIELDS, defaults: N.pulleyDefaults, variants: pulleyVariants, calculate: N.calcPulley, views: N.pulleyViews, geo: N.pulleyGeo, solid: (R, c) => primsSolid(R, N.pulleyGeo(c)), asm: (c) => ({ role: 'bore', bore: c.bore }),
    partNo: (p) => `PU-D${p.outerDia}-W${p.faceWidth}-B${p.bore}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Outside dia', c.D), kd('Face width', c.W), kd('Bore', c.bore)], notes: (c) => [c.key ? `KEYWAY ${c.key.b} x ${c.key.h} PER ISO 773` : 'NO KEYWAY', 'SOLID DISC - NO SPOKES, LAGGING OR CROWN', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'guidewheel', name: 'Guide / wear wheel', category: 'B', subcategory: 'Guide wheels and wear wheels', description: 'Cylindrical track wheel with optional flanges on both sides for guiding and wear applications, in plastic or metal.',
    keywords: ['guide wheel', 'wear wheel', 'wheel', 'track wheel', 'flanged wheel', 'roller wheel'], materials: N.WHEEL_MATERIALS, applications: ['guiding', 'wear protection', 'chain support'], standards: ['User-specified dimensions'], related: ['bearing', 'bushing'],
    fields: N.WHEEL_FIELDS, defaults: N.wheelDefaults, variants: wheelVariants, calculate: N.calcWheel, views: N.wheelViews, geo: N.wheelGeo, solid: (R, c) => primsSolid(R, N.wheelGeo(c)), asm: (c) => ({ role: 'bore', bore: c.bore }),
    partNo: (p) => `GW-D${p.trackDia}-W${p.trackWidth}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Track dia', c.D), kd('Overall width', c.total), kd('Bore', c.bore)], notes: () => ['PLAIN BORE - NO KEYWAY OR BEARING SEAT', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'channel', name: 'U-channel (chain guide / side frame)', category: 'F', subcategory: 'Side frames and chain guides', description: 'Folded or extruded U-channel for side frames, chain guides and covers, with section properties and a beam check.',
    keywords: ['channel', 'u channel', 'u-channel', 'side frame', 'chain guide', 'return guide', 'profile', 'cover'], materials: N.CH_MATERIALS, applications: ['side frame', 'chain guide', 'cover'], standards: ['Euler-Bernoulli beam theory'], related: ['angle', 'rhs', 'wearstrip'],
    fields: N.CHANNEL_FIELDS, defaults: N.channelDefaults, variants: channelVariants, calculate: N.calcChannel, views: N.channelViews, geo: N.channelGeo, solid: (R, c) => primsSolid(R, N.channelGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `CH-${p.height}x${p.flange}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Height', c.H), kd('Flange', c.B), kd('Thickness', c.t), kd('Length', c.L)], notes: () => ['SHARP CORNERS - NO ROOT RADII', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'roundtube', name: 'Round tube', category: 'F', subcategory: 'Structural tubes', description: 'Round steel, stainless or aluminium tube for frames, supports and guards, with section properties and a beam check.',
    keywords: ['tube', 'round tube', 'pipe', 'frame tube', 'structural tube', 'support'], materials: N.CH_MATERIALS, applications: ['frame', 'support', 'guard'], standards: ['Euler-Bernoulli beam theory'], related: ['rhs', 'leg'],
    fields: N.TUBE_FIELDS, defaults: N.tubeDefaults, variants: tubeVariants, calculate: N.calcTube, views: N.tubeViews, geo: N.tubeGeo, solid: (R, c) => primsSolid(R, N.tubeGeo(c)), asm: (c) => ({ role: 'bore', bore: c.id }),
    partNo: (p) => `RT-${p.od}-L${p.length}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Outside dia', c.od), kd('Wall', c.t), kd('Length', c.L)], notes: () => ['SQUARE CUT ENDS, NO WELD SEAM MODELLED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'leg', name: 'Adjustable conveyor leg', category: 'F', subcategory: 'Adjustable legs and stands', description: 'Tube leg with adjusting stud and foot for conveyor stands, with a buckling check for the vertical load.',
    keywords: ['leg', 'adjustable leg', 'conveyor stand', 'stand', 'foot', 'levelling foot', 'support leg'], materials: N.CH_MATERIALS, applications: ['conveyor stand', 'machine support'], standards: ['Euler column buckling'], related: ['roundtube', 'plate', 'rhs'],
    fields: N.LEG_FIELDS, defaults: N.legDefaults, variants: legVariants, calculate: N.calcLeg, views: N.legViews, geo: N.legGeo, solid: (R, c) => primsSolid(R, N.legGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `LG-D${p.tubeOD}-H${p.height}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Tube OD', c.od), kd('Tube height', c.H), kd('Overall height', c.total)], notes: () => ['STUD TREATED AS PLAIN CYLINDER - THREAD NOT MODELLED', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
  { ...base, id: 'plate', name: 'Mounting / transfer / dead plate', category: 'G', subcategory: 'Plates and mounting accessories', description: 'Flat plate with a regular hole pattern for mounting, transfer and dead plates in steel, stainless, aluminium or plastic.',
    keywords: ['plate', 'mounting plate', 'transfer plate', 'dead plate', 'base plate', 'flat plate', 'bracket plate'], materials: N.PLATE_MATERIALS, applications: ['mounting', 'transfer between conveyors', 'cover'], standards: ['User-specified dimensions'], related: ['wearstrip', 'angle'],
    fields: N.PLATE_FIELDS, defaults: N.plateDefaults, variants: plateVariants, calculate: N.calcPlate, views: N.plateViews, geo: N.plateGeo, solid: (R, c) => primsSolid(R, N.plateGeo(c)), asm: () => ({ role: 'other' }),
    partNo: (p) => `PL-${p.length}x${p.width}x${p.thickness}`, materialOf: (p) => String(p.material), keyDims: (c) => [kd('Length', c.L), kd('Width', c.W), kd('Thickness', c.t)], notes: (c) => [`${c.centres.length} x Ø${f2(c.dh)} THROUGH HOLES`, 'SQUARE CORNERS, PLAIN HOLES', 'ALL DIMENSIONS IN MM UNLESS STATED'] },
];
export const FAMILIES: Family[] = [...RAW, ...CUSTOM_FAMILIES].map((f) => ({ ...f, basic: BASIC[f.id] ?? [], autofill: AUTOFILL[f.id] }));
export const getFamily = (id: string): Family | undefined => FAMILIES.find((x) => x.id === id);
