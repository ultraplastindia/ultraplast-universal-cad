import type { Params } from '../core/types.ts';
import { num } from '../core/util.ts';
import { ROLLER_CHAINS } from '../data/chains.ts';
import { keyFor } from '../data/keys.ts';

const STD_LENGTHS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 70, 80, 90, 100, 110, 125, 140, 160, 180, 200, 220, 250];
const near = (x: number) => STD_LENGTHS.find((l) => l >= x) ?? STD_LENGTHS[STD_LENGTHS.length - 1];

/** Quick mode: the user gives only these keys; the rest is derived by the matching AUTOFILL rule. */
export const BASIC: Record<string, string[]> = {
  sprocket: ['chain', 'pitch', 'rollerDia', 'innerWidth', 'teeth', 'bore', 'material'],
  shaft: ['d1', 'l1', 'material'],
  bearing: ['designation', 'd', 'D', 'B', 'material'],
  key: ['shaftDia', 'material'],
  washer: ['size', 'd1', 'd2', 'h', 'material'],
  hexnut: ['size', 'dia', 's', 'm', 'material'],
  bushing: ['boreDia', 'length', 'material'],
  roller: ['tubeOD', 'tubeLength', 'material'],
  hexshaft: ['af', 'length', 'material'],
  wearstrip: ['length', 'width', 'thickness', 'material'],
  angle: ['a', 'b', 'length', 'material'],
  rhs: ['w', 'h', 'length', 'material'],
  hexbolt: ['size', 'length', 'material'],
  capscrew: ['size', 'length', 'material'],
  dowel: ['dia', 'length', 'material'],
  pulley: ['outerDia', 'faceWidth', 'bore', 'material'],
  guidewheel: ['trackDia', 'trackWidth', 'bore', 'material'],
  channel: ['height', 'flange', 'length', 'material'],
  roundtube: ['od', 'length', 'material'],
  leg: ['tubeOD', 'height', 'material'],
  plate: ['length', 'width', 'thickness', 'material'],
};

export const AUTOFILL: Record<string, (p: Params, changed: string) => Params> = {
  sprocket: (p) => {
    const std = ROLLER_CHAINS.find((c) => c.id === p.chain);
    const pitch = std ? std.pitch : num(p, 'pitch'), d1 = std ? std.rollerDia : num(p, 'rollerDia'), z = num(p, 'teeth'), bore = num(p, 'bore');
    if (![pitch, d1, z, bore].every(Number.isFinite) || z < 6) return p;
    const df = pitch / Math.sin(Math.PI / z) - d1;
    const hubDia = Math.max(bore + 6, Math.min(Math.round(bore * 1.6 + 6), Math.floor(df - 3)));
    return { ...p, hubDia, hubLength: Math.round(bore * 0.8), keyway: keyFor(bore) !== null, tipMode: 'mid' };
  },
  key: (p, ch) => (ch === 'shaftDia' || ch === 'material' ? { ...p, length: near(1.25 * num(p, 'shaftDia')) } : p),
  bushing: (p) => { const b = num(p, 'boreDia'); return Number.isFinite(b) ? { ...p, outerDia: Math.round((b + Math.max(4, b * 0.3)) * 2) / 2 } : p; },
  roller: (p) => {
    const od = num(p, 'tubeOD'); if (!Number.isFinite(od)) return p;
    return { ...p, wall: od <= 40 ? 2 : od <= 60 ? 2.5 : 3, stubDia: od <= 40 ? 12 : od <= 60 ? 15 : 20, stubLength: od <= 60 ? 25 : 30, capThk: od > 60 ? 8 : 6 };
  },
  wearstrip: (p) => {
    const L = num(p, 'length'), W = num(p, 'width'); if (!Number.isFinite(L) || !Number.isFinite(W)) return p;
    const n = L >= 200 ? Math.floor((L - 100) / 100) + 1 : 2;
    return { ...p, holes: n, holeDia: W < 20 ? 5.5 : W < 40 ? 6.5 : 8.5, edge: Math.min(50, Math.round(L / 4)) };
  },
  angle: (p) => { const m = Math.min(num(p, 'a'), num(p, 'b')); return Number.isFinite(m) ? { ...p, t: m <= 30 ? 3 : m <= 40 ? 4 : m <= 50 ? 5 : 6 } : p; },
  rhs: (p) => { const m = Math.min(num(p, 'w'), num(p, 'h')); return Number.isFinite(m) ? { ...p, t: m <= 30 ? 2 : m <= 50 ? 3 : m <= 70 ? 4 : 5, span: num(p, 'length') } : p; },
  pulley: (p) => {
    const D = num(p, 'outerDia'), bore = num(p, 'bore'); if (![D, bore].every(Number.isFinite)) return p;
    return { ...p, hubDia: Math.min(Math.round(bore * 1.6 + 6), Math.floor(D * 0.6)), hubLength: Math.round(bore * 0.8), keyway: keyFor(bore) !== null };
  },
  guidewheel: (p) => { const D = num(p, 'trackDia'); return Number.isFinite(D) ? { ...p, flangeDia: Math.round(D * 1.25), flangeThk: Math.max(2, Math.round(D / 12)) } : p; },
  channel: (p) => { const H = num(p, 'height'); return Number.isFinite(H) ? { ...p, thickness: H <= 60 ? 2.5 : H <= 100 ? 3 : 4 } : p; },
  roundtube: (p) => { const od = num(p, 'od'); return Number.isFinite(od) ? { ...p, wall: od <= 30 ? 2 : od <= 60 ? 3 : 4 } : p; },
  leg: (p) => {
    const od = num(p, 'tubeOD'); if (!Number.isFinite(od)) return p;
    return { ...p, wall: od <= 40 ? 2.5 : 3, studDia: od <= 40 ? 10 : od <= 60 ? 12 : 16, exposed: 30, footDia: Math.round(od * 1.6), footThk: 6 };
  },
  plate: (p) => {
    const L = num(p, 'length'), W = num(p, 'width'); if (!Number.isFinite(L) || !Number.isFinite(W)) return p;
    const e = Math.min(20, Math.max(8, Math.round(Math.min(L, W) / 6)));
    return { ...p, cols: L >= 150 ? 3 : 2, rows: W >= 100 ? 2 : 1, edgeX: e, edgeY: e, holeDia: 6.5 };
  },
};
