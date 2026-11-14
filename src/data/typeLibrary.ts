import type { Params } from '../core/types.ts';
import { CATEGORIES, IMPLEMENTED, PARTIAL, PRESETS } from './catalogue.ts';
import { FAMILIES, getFamily } from '../families/index.ts';
import { MULTI_VARIANTS } from '../families/sprocket/multi.ts';
import { blockDefaults, roundDefaults } from '../families/custom/custom.ts';

/** The component type library: one entry per kind of conveyor component. Each type names a base family and the starting values.
 *  Choosing a type opens the designer with those values; the person then types their own sizes. The built-in list below can be
 *  stored in the database, where the administrator can add or change types (a database entry with the same id wins). */
export interface ComponentType {
  id: string; name: string; category: string; base: string; params: Params; note: string;
  /** 'dedicated' = has its own engineering model, 'value' = generic value-based shape, 'assembly' = built in the Assembly designer */
  kind: 'dedicated' | 'value' | 'assembly';
  builtin: boolean;
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const variant = (id: string): Params => ({ ...(MULTI_VARIANTS.find((v) => v.id === id)?.params ?? {}) });

/** The sprocket styles from the reference picture. Names and meanings are the usual ones; change them in the library if yours differ. */
const SPROCKET_STYLES: { name: string; v: string; over?: Params; note: string }[] = [
  { name: 'Single Stand sprocket (simplex)', v: 'SPM-SIMPLEX', note: 'One row of teeth with a hub on one side.' },
  { name: 'Duplex sprocket', v: 'SPM-DUPLEX', note: 'Two rows of teeth for duplex chain. Strand distance defaults to the standard transverse pitch.' },
  { name: 'Triplex sprocket', v: 'SPM-TRIPLEX', note: 'Three rows of teeth for triplex chain.' },
  { name: 'Multi Stand sprocket', v: 'SPM-MULTI4', note: 'Four rows of teeth. Set 4 to 6 strands.' },
  { name: 'Double Single sprocket', v: 'SPM-DOUBLE-SINGLE', note: 'Two single tooth rows on one hub, with a free gap between them (set the distance between strands).' },
  { name: 'Bush sprocket (taper bush)', v: 'SPM-BUSH', note: 'Single row with a long hub for a taper bush. The bush taper itself is not modelled.' },
  { name: 'QD sprocket (quick detachable)', v: 'SPM-QD', note: 'Flanged hub with bolt holes. The tapered QD bush is not modelled.' },
  { name: 'Steel Split sprocket', v: 'SPM-SPLIT', note: 'Two halves bolted together. Shown with a split line; the 3D model is one piece.' },
  { name: 'Drive sprocket (flanged)', v: 'SPM-DRIVE', note: 'Flanged hub with bolt holes for direct drive mounting.' },
  { name: 'Drum sprocket', v: 'SPM-DRUM', note: 'Wide drum-type hub on both sides of the tooth row.' },
  { name: 'Industrial sprocket (heavy)', v: 'SPM-INDUSTRIAL', note: 'Heavy plate with a large long hub.' },
  { name: 'Shaft sprocket (keyed hub)', v: 'SPM-BUSH', over: { hubLength: 35, hubDia: 55, bore: 30, keyway: true }, note: 'Long keyed hub for direct mounting on a shaft. Splined bores are not modelled (keyway only).' },
];

const MAT = (l: string): string => (/stainless/.test(l) ? 'SS 304' : /plastic|uhmw|wear|nylon/.test(l) ? 'UHMW-PE' : /alumin/.test(l) ? 'Al 6061-T6' : 'S235 Steel');

interface Generic { base: 'custom_block' | 'custom_round' | 'sprocket_types' | 'assembly'; params: Params; note: string }
const block = (l: string, L: number, W: number, H: number): Generic => ({ base: 'custom_block', params: { ...blockDefaults, length: L, width: W, height: H, cols: 0, rows: 0, material: MAT(l) }, note: 'Generic rectangular shape. Replace the starting sizes with the real length, width and thickness.' });
const round = (l: string, o: Params): Generic => ({ base: 'custom_round', params: { ...roundDefaults, bore: 0, od2: 0, len2: 0, od3: 0, len3: 0, material: MAT(l), ...o }, note: 'Generic turned shape (up to three diameters, optional bore). Replace the starting sizes with the real values.' });

/** Starting shape for a catalogue item that has no dedicated model. */
export function genericFor(cat: string, name: string): Generic {
  const l = name.toLowerCase();
  if (cat === 'H') return { base: 'assembly', params: {}, note: 'Built from components in the Assembly designer.' };
  if (/split sprocket/.test(l)) return { base: 'sprocket_types', params: variant('SPM-SPLIT'), note: 'Steel split sprocket preset.' };
  if (/sprocket/.test(l)) return { base: 'sprocket_types', params: { ...variant('SPM-SIMPLEX'), material: /stainless/.test(l) ? 'SS 304' : /plastic/.test(l) ? 'Nylon PA6' : 'C45 Steel' }, note: 'Single-strand sprocket preset. Change the chain, teeth and bore.' };
  if (/timing pulley/.test(l)) return { ...round(l, { od1: 80, len1: 30, bore: 20, material: 'Al 6061-T6' }), note: 'Plain round body: the toothed profile is not modelled.' };
  if (/motor/.test(l)) return round(l, { od1: 120, len1: 220, material: 'Al 6061-T6' });
  if (/gearbox/.test(l)) return round(l, { od1: 150, len1: 200, material: 'Al 6061-T6' });
  if (/coupling/.test(l)) return round(l, { bore: 20, od1: 50, len1: 60, material: 'C45 Steel' });
  if (/collar/.test(l)) return round(l, { bore: 25, od1: 50, len1: 20 });
  if (/(screw|pin|fitting|link)/.test(l)) return round(l, { od1: 10, len1: 30 });
  if (/retaining ring/.test(l)) return round(l, { bore: 20, od1: 24, len1: 1.5, material: 'C45 Steel' });
  if (/bearing/.test(l)) return round(l, { bore: 25, od1: 52, len1: 15, material: 'C45 Steel' });
  if (/roller/.test(l)) return round(l, { od1: 60, len1: 500 });
  if (/pulley|drum/.test(l)) return round(l, { od1: 160, len1: 300 });
  if (/wheel/.test(l)) return round(l, { bore: 12, od1: 100, len1: 25, material: 'UHMW-PE' });
  if (/shaft/.test(l)) return round(l, { od1: 40, len1: 600, material: 'C45 Steel' });
  if (cat === 'A') return block(l, 300, 80, 8);
  if (cat === 'C') return block(l, 500, 300, 6);
  if (/(plate|strip)/.test(l)) return block(l, 300, 100, 8);
  if (/(guide|rail)/.test(l)) return block(l, 1000, 30, 10);
  if (/(frame|stand|profile|structure|cross member|leg)/.test(l)) return block(l, 1000, 60, 40);
  if (/(drive|tensioner|take-up|tensioning)/.test(l)) return block(l, 300, 150, 100);
  return block(l, 150, 60, 10);
}

export function builtinTypes(): ComponentType[] {
  const out: ComponentType[] = SPROCKET_STYLES.map((s) => ({ id: `B-style-${slug(s.name)}`, name: s.name, category: 'B', base: 'sprocket_types', params: { ...variant(s.v), ...(s.over ?? {}) }, note: s.note, kind: 'dedicated' as const, builtin: true }));
  for (const c of CATEGORIES) for (const item of c.items) {
    const key = `${c.id}:${item}`, fam = IMPLEMENTED[key], id = `${c.id}-${slug(item)}`;
    if (fam && getFamily(fam)) out.push({ id, name: item, category: c.id, base: fam, params: fam === 'sprocket_types' ? genericFor(c.id, item).params : { ...getFamily(fam)!.defaults, ...(PRESETS[key] ?? {}) }, note: PARTIAL[key] ? `Partly covered: ${PARTIAL[key]}.` : 'Has its own engineering model.', kind: 'dedicated', builtin: true });
    else if (fam === 'assembly') out.push({ id, name: item, category: c.id, base: 'assembly', params: {}, note: PARTIAL[key] ? `Partly covered: ${PARTIAL[key]}.` : 'Built from components in the Assembly designer.', kind: 'assembly', builtin: true });
    else { const g = genericFor(c.id, item); out.push({ id, name: item, category: c.id, base: g.base, params: g.params, note: g.note, kind: g.base === 'assembly' ? 'assembly' : g.base === 'sprocket_types' ? 'dedicated' : 'value', builtin: true }); }
  }
  return out;
}

/** Built-in types with the database types laid over them (same id = the database version is used). */
export function mergeTypes(builtin: ComponentType[], db: ComponentType[]): ComponentType[] {
  const map = new Map(builtin.map((t) => [t.id, t]));
  for (const t of db) map.set(t.id, t);
  return [...map.values()];
}
export const baseLabel = (base: string): string => (base === 'assembly' ? 'Assembly designer' : FAMILIES.find((f) => f.id === base)?.name ?? base);
