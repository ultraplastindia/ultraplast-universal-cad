import type { BufferGeometry } from 'three';
import type { CalcResult, ParamField, Params, Row } from './types.ts';
import type { DrawView } from '../cad2d/sheet.ts';
import type { GeoPart } from './prims.ts';
import type { AsmInfo } from './asminfo.ts';

export interface Variant { id: string; name: string; params: Params }
export interface Part3D { id: string; name: string; geometry: BufferGeometry; color: string; explode: [number, number, number] }

/** A component family: its own parameters, calculation, 2D views, 3D parts and B-rep solid. */
export interface Family {
  id: string; name: string; category: string; subcategory: string; description: string;
  keywords: string[]; materials: string[]; applications: string[]; standards: string[]; related: string[];
  fields: ParamField[]; defaults: Params; variants: Variant[];
  /** parameters the user must give in Quick mode (everything else is derived by `autofill`) */
  basic: string[];
  /** derives the non-basic parameters from the basic ones; `changed` is the key the user just edited */
  autofill?: (p: Params, changed: string) => Params;
  calculate(p: Params): CalcResult;
  views(derived: any): DrawView[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  geo(derived: any): GeoPart[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  asm(derived: any): AsmInfo; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Build a replicad (OpenCascade) solid; R is the lazily loaded replicad module. */
  solid(R: any, derived: any): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  partNo(p: Params): string;
  materialOf(p: Params): string;
  keyDims(derived: any): Row[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  notes(derived: any): string[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}
