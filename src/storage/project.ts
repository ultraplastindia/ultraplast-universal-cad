import type { ParamField, Params } from '../core/types.ts';

export const PROJECT_FORMAT = 'ultraplast-project';
export interface Project { id: string; name: string; familyId: string; params: Params; revision: string; createdAt: string; updatedAt: string }
export interface FamilyLike { id: string; fields: ParamField[]; defaults: Params }

export const newId = (): string => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: 1, project: { ...p, params: p.params } }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2);
}

/** Keeps only known parameters, coerces types and falls back to the family defaults for anything invalid. */
export function repairParams(fam: FamilyLike, raw: Record<string, unknown>): Params {
  const params: Params = { ...fam.defaults };
  for (const fld of fam.fields) {
    const v = raw[fld.key];
    if (fld.kind === 'number') params[fld.key] = typeof v === 'number' ? v : v === null ? NaN : (fam.defaults[fld.key] as number);
    else if (fld.kind === 'boolean') params[fld.key] = typeof v === 'boolean' ? v : (fam.defaults[fld.key] as boolean);
    else params[fld.key] = typeof v === 'string' && (fld.options?.some((o) => o.value === v) ?? true) ? v : fam.defaults[fld.key];
  }
  return params;
}

/** Validates an imported project file against the component library. Throws Error with a readable message. */
export function parseProject(text: string, families: FamilyLike[]): Project {
  let raw: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { raw = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
  if (!raw || raw.format !== PROJECT_FORMAT) throw new Error('Not an Ultraplast project file.');
  if (raw.version !== 1) throw new Error(`Unsupported project version: ${String(raw.version)}.`);
  const pr = raw.project;
  if (!pr || typeof pr !== 'object' || typeof pr.params !== 'object' || pr.params === null) throw new Error('Project data is missing or damaged.');
  const fam = families.find((f) => f.id === pr.familyId);
  if (!fam) throw new Error(`Unknown component family: ${String(pr.familyId)}.`);
  const params = repairParams(fam, pr.params);
  const now = new Date().toISOString();
  return { id: newId(), name: typeof pr.name === 'string' && pr.name.trim() ? pr.name.trim().slice(0, 120) : 'Imported design', familyId: fam.id, params, revision: typeof pr.revision === 'string' ? pr.revision.slice(0, 4) : 'A', createdAt: now, updatedAt: now };
}

/* ---------------- assemblies ---------------- */
export const ASSEMBLY_FORMAT = 'ultraplast-assembly';
export interface AsmItemLike { id: string; familyId: string; name: string; params: Params; pos: [number, number, number]; rot: [number, number, number] }
export interface AssemblyLike { id: string; name: string; items: AsmItemLike[]; createdAt: string; updatedAt: string }

export function serializeAssembly(a: AssemblyLike): string {
  return JSON.stringify({ format: ASSEMBLY_FORMAT, version: 1, assembly: a }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2);
}
export function parseAssembly(text: string, families: FamilyLike[]): AssemblyLike {
  let raw: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { raw = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
  if (!raw || raw.format !== ASSEMBLY_FORMAT) throw new Error('Not an Ultraplast assembly file.');
  if (raw.version !== 1) throw new Error(`Unsupported assembly version: ${String(raw.version)}.`);
  const a = raw.assembly;
  if (!a || !Array.isArray(a.items)) throw new Error('Assembly data is missing or damaged.');
  if (a.items.length > 200) throw new Error('Assembly has too many items (limit 200).');
  const vec = (v: unknown): [number, number, number] => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : [0, 0, 0]);
  const items: AsmItemLike[] = a.items.map((it: any, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const fam = families.find((f) => f.id === it?.familyId);
    if (!fam) throw new Error(`Item ${i + 1}: unknown component family ${String(it?.familyId)}.`);
    return { id: `i_${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`, familyId: fam.id, name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 80) : `Item ${i + 1}`, params: repairParams(fam, it.params && typeof it.params === 'object' ? it.params : {}), pos: vec(it.pos), rot: vec(it.rot) };
  });
  const now = new Date().toISOString();
  return { id: newId(), name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : 'Imported assembly', items, createdAt: now, updatedAt: now };
}
