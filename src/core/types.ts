export type Pt = [number, number];
export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamField {
  key: string;
  label: string;
  unit?: string;
  kind: 'number' | 'select' | 'boolean' | 'text';
  /** text fields only: number of visible rows */
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
  showIf?: (p: Params) => boolean;
}

export interface Row { label: string; value: string; unit?: string }

/** Result of a family's calculation module. Inputs, calculated values,
 *  assumptions and warnings are kept strictly separate. */
export interface CalcResult {
  ok: boolean;
  inputs: Row[];
  calculated: Row[];
  assumptions: string[];
  warnings: string[];
  errors: string[];
  standards: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  derived: any;
}
