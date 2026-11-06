import type { DrawView } from '../cad2d/sheet.ts';
import { composeSheet } from '../cad2d/sheet.ts';
import type { Sheet, SheetMeta } from '../cad2d/sheet.ts';
import { VIEW_NAMES, projectGeo } from '../core/project.ts';
import type { ViewId } from '../core/project.ts';
import { today } from '../core/util.ts';
import type { V3 } from '../core/xform.ts';
import { COMPANY } from '../lib/design.ts';
import { buildBom } from './model.ts';
import type { Placed } from './model.ts';

export function assemblyViews(placed: Placed[], offsets: V3[] = []): DrawView[] {
  const ids: ViewId[] = ['front', 'top', 'right', 'iso'];
  return ids.map((id) => ({ name: `${VIEW_NAMES[id]}`, ents: placed.flatMap((p, i) => projectGeo(p.geo, id, p.M, p.pos, p.geo.map(() => offsets[i] ?? [0, 0, 0]))) })).filter((v) => v.ents.length);
}

export function assemblyNumber(name: string): string { return `ASM-${name.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 14) || 'UNNAMED'}`; }

export function assemblySheet(name: string, placed: Placed[], revision: string, offsets: V3[] = []): { sheet: Sheet; meta: SheetMeta } {
  const bom = buildBom(placed), no = assemblyNumber(name);
  const meta: SheetMeta = {
    company: COMPANY, title: `Assembly: ${name}`, partId: no, drawingNo: `UP-${no}`, revision, date: today(), material: 'SEE BOM', units: 'mm',
    notes: [...bom.slice(0, 7).map((r) => `${r.qty}x ${r.partNo} (${r.material})`), bom.length > 7 ? `... +${bom.length - 7} more lines, see BOM export` : '', 'EDGE PROJECTION, HIDDEN LINES NOT REMOVED', 'PRELIMINARY - NOT VALIDATED FOR MANUFACTURE'].filter(Boolean),
  };
  return { sheet: composeSheet(assemblyViews(placed, offsets), meta), meta };
}
