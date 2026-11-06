import type { Family } from '../core/family.ts';
import type { GeoPart } from '../core/prims.ts';
import type { CalcResult, Params } from '../core/types.ts';
import { today } from '../core/util.ts';
import { composeSheet } from '../cad2d/sheet.ts';
import type { Sheet, SheetMeta } from '../cad2d/sheet.ts';

export const COMPANY = 'Ultraplast Chainbelts Private Limited';
export interface Design { family: Family; params: Params; calc: CalcResult; partNo: string; meta: SheetMeta; sheet: Sheet | null; geo: GeoPart[] | null }

/** Builds everything derived from one parameter set. The 2D sheet and the 3D parts come from the same `calc.derived`. */
export function buildDesign(family: Family, params: Params, revision: string): Design {
  const calc = family.calculate(params);
  const partNo = family.partNo(params);
  const meta: SheetMeta = {
    company: COMPANY, title: family.name, partId: partNo, drawingNo: `UP-${partNo}`, revision, date: today(), material: family.materialOf(params), units: 'mm',
    notes: calc.ok ? [...family.notes(calc.derived), 'PRELIMINARY DESIGN - NOT VALIDATED FOR MANUFACTURE'] : [],
  };
  if (!calc.ok) return { family, params, calc, partNo, meta, sheet: null, geo: null };
  return { family, params, calc, partNo, meta, sheet: composeSheet(family.views(calc.derived), meta), geo: family.geo(calc.derived) };
}
