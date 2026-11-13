import type { Family } from '../core/family.ts';
import type { GeoPart } from '../core/prims.ts';
import type { CalcResult, Params } from '../core/types.ts';
import { today } from '../core/util.ts';
import { composeSheet } from '../cad2d/sheet.ts';
import type { Sheet, SheetMeta } from '../cad2d/sheet.ts';

export const COMPANY = 'Ultraplast Chainbelts Private Limited';
export interface Design { family: Family; params: Params; calc: CalcResult; partNo: string; meta: SheetMeta; sheet: Sheet | null; geo: GeoPart[] | null }

/** Checks every number against the limits its field declares (the same limits the form shows) and gives readable errors.
 *  This is the first line of defence: values far outside the limits (for example 1 000 000 mm) are refused before any geometry is built. */
export function rangeErrors(family: Family, params: Params): string[] {
  const errs: string[] = [];
  for (const f of family.fields) {
    if (f.kind !== 'number') continue;
    const v = params[f.key];
    const name = f.label.replace(/\s*\(.*$/, '').trim(), unit = f.unit ? ` ${f.unit}` : '';
    if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${name}: enter a number.`); continue; }
    if (f.min !== undefined && v < f.min - 1e-9) errs.push(`${name}: ${v}${unit} is below the minimum of ${f.min}${unit}.`);
    if (f.max !== undefined && v > f.max + 1e-9) errs.push(`${name}: ${v}${unit} is above the maximum of ${f.max}${unit}.`);
  }
  return errs;
}
/** family.calculate, but values outside the declared limits are refused first and any unexpected exception becomes a readable error. */
export function safeCalculate(family: Family, params: Params): CalcResult {
  const errs = rangeErrors(family, params);
  const refuse = (errors: string[]): CalcResult => ({ ok: false, inputs: [], calculated: [], assumptions: [], warnings: [], errors, standards: [], derived: null });
  if (errs.length) return refuse(errs);
  try { return family.calculate(params); } catch (e) { return refuse([`The values could not be calculated (${e instanceof Error ? e.message : 'unknown error'}). Check the sizes.`]); }
}

/** Builds everything derived from one parameter set. The 2D sheet and the 3D parts come from the same `calc.derived`. */
export function buildDesign(family: Family, params: Params, revision: string): Design {
  const calc = safeCalculate(family, params);
  const partNo = family.partNo(params);
  const meta: SheetMeta = {
    company: COMPANY, title: family.name, partId: partNo, drawingNo: `UP-${partNo}`, revision, date: today(), material: family.materialOf(params), units: 'mm',
    notes: calc.ok ? [...family.notes(calc.derived), 'PRELIMINARY DESIGN - NOT VALIDATED FOR MANUFACTURE'] : [],
  };
  if (!calc.ok) return { family, params, calc, partNo, meta, sheet: null, geo: null };
  try { return { family, params, calc, partNo, meta, sheet: composeSheet(family.views(calc.derived), meta), geo: family.geo(calc.derived) }; }
  catch (e) { return { family, params, calc: { ...calc, ok: false, errors: [`The drawing or model could not be built (${e instanceof Error ? e.message : 'unknown error'}). Change the sizes.`] }, partNo, meta, sheet: null, geo: null }; }
}
