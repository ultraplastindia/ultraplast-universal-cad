import type { CalcResult, Row } from '../../core/types.ts';
import type { ModelEnt } from '../../cad2d/sheet.ts';
import { fmt } from '../../core/util.ts';

export const R = (label: string, v: number | string, unit?: string, dp = 3): Row => ({ label, value: typeof v === 'number' ? fmt(v, dp) : v, unit });
export type Check = [label: string, v: number, opt?: { min?: number; max?: number; int?: boolean }];
/** Validates numeric inputs; returns error messages. */
export function validate(checks: Check[]): string[] {
  const e: string[] = [];
  for (const [label, v, o] of checks) {
    if (!Number.isFinite(v)) e.push(`Missing or invalid value: ${label}.`);
    else if (o?.int && !Number.isInteger(v)) e.push(`${label} must be a whole number.`);
    else if (o?.min !== undefined && v < o.min) e.push(`${label} must be at least ${o.min}.`);
    else if (o?.max !== undefined && v > o.max) e.push(`${label} must not exceed ${o.max}.`);
  }
  return e;
}
export const failed = (inputs: Row[], errors: string[], standards: string[], warnings: string[] = [], assumptions: string[] = []): CalcResult => ({ ok: false, inputs, calculated: [], assumptions, warnings, errors, standards, derived: null });
export const done = (inputs: Row[], calculated: Row[], assumptions: string[], warnings: string[], standards: string[], derived: unknown): CalcResult => ({ ok: true, inputs, calculated, assumptions, warnings: [...warnings, 'PRELIMINARY: not validated for manufacture.'], errors: [], standards, derived });

type Edit = { key: string; value: number } | undefined;
export const ed = (key: string, value: number): Edit => ({ key, value });
export const dim = (a: [number, number], b: [number, number], off: number, text: string, edit?: Edit): ModelEnt => ({ t: 'dim', a, b, off, text, edit });
export const rect = (x0: number, y0: number, x1: number, y1: number): ModelEnt => ({ t: 'poly', closed: true, layer: 'outline', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
export const line = (a: [number, number], b: [number, number], layer: 'outline' | 'centre' | 'hidden' = 'outline'): ModelEnt => ({ t: 'line', a, b, layer });
export const circ = (c: [number, number], r: number, layer: 'outline' | 'centre' | 'hidden' = 'outline'): ModelEnt => ({ t: 'circle', c, r, layer });
export const cross = (c: [number, number], r: number): ModelEnt[] => [line([c[0] - r, c[1]], [c[0] + r, c[1]], 'centre'), line([c[0], c[1] - r], [c[0], c[1] + r], 'centre')];
