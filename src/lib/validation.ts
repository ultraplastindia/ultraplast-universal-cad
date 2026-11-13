import type { Design } from './design.ts';
import { rangeErrors } from './design.ts';
import type { GeoPart } from '../core/prims.ts';

/** Automatic checks shown before any file is exported.
 *  These are GEOMETRIC and DATA checks only. They do not replace engineering review, strength or fit calculations,
 *  tolerance analysis or manufacturing approval. */
export type Level = 'error' | 'warn' | 'ok' | 'info';
export interface Check { level: Level; text: string }
export interface Validation { status: 'pass' | 'warn' | 'fail'; checks: Check[]; summary: string }

const finiteDeep = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finiteDeep) : v && typeof v === 'object' ? Object.values(v as object).every(finiteDeep) : true);

/** Overall size of the 3D parts (mm) and the thinnest solid feature found. */
export function geoStats(geo: GeoPart[]): { size: [number, number, number]; thinnest: number } {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], thin = Infinity;
  const grow = (x: number, y: number, z: number) => { lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)]; };
  for (const g of geo) for (const p of g.prims) {
    if (p.kind === 'tube') { grow(-p.rOut, -p.rOut, p.z0); grow(p.rOut, p.rOut, p.z1); if (p.rIn > 0) thin = Math.min(thin, p.rOut - p.rIn); thin = Math.min(thin, p.z1 - p.z0); }
    else if (p.kind === 'prism') { for (const [x, y] of p.outer) { grow(x, y, p.z0); grow(x, y, p.z1); } thin = Math.min(thin, p.z1 - p.z0); }
    else { grow(p.c[0] - p.r, p.c[1] - p.r, p.c[2] - p.r); grow(p.c[0] + p.r, p.c[1] + p.r, p.c[2] + p.r); thin = Math.min(thin, 2 * p.r); }
  }
  return { size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], thinnest: thin };
}

export function validateDesign(d: Design): Validation {
  const checks: Check[] = [];
  const add = (level: Level, text: string) => checks.push({ level, text });
  const re = rangeErrors(d.family, d.params);
  if (re.length) re.forEach((e) => add('error', e)); else add('ok', 'Every value is inside the limits of its field.');
  if (!d.calc.ok) {
    d.calc.errors.filter((e) => !re.includes(e)).forEach((e) => add('error', e));
    return { status: 'fail', checks: [...checks, { level: 'info', text: 'Fix the errors above. Files cannot be exported until they are solved.' }], summary: `${checks.filter((c) => c.level === 'error').length} error(s): cannot export` };
  }
  add('ok', 'The calculation succeeded with no conflicting dimensions.');
  d.calc.warnings.filter((w) => !/^PRELIMINARY/.test(w)).forEach((w) => add('warn', w));
  // drawing
  if (!d.sheet || !d.sheet.ents.length) add('error', 'The drawing is empty.');
  else if (!finiteDeep(d.sheet.ents)) add('error', 'The drawing contains an invalid coordinate.');
  else add('ok', `The 2D drawing has ${d.sheet.ents.length} elements, all valid, at scale ${d.sheet.scaleLabel}.`);
  // 3D
  if (!d.geo || !d.geo.length) add('error', 'The 3D model has no parts.');
  else if (!finiteDeep(d.geo)) add('error', 'The 3D model contains an invalid coordinate.');
  else {
    const s = geoStats(d.geo), big = Math.max(...s.size);
    add('ok', `The 3D model has ${d.geo.length} part(s), overall ${s.size.map((v) => +v.toFixed(2)).join(' x ')} mm.`);
    if (big > 20000) add('warn', 'The model is larger than 20 m. Check that the sizes are in millimetres.');
    if (big < 1) add('warn', 'The model is smaller than 1 mm. Check that the sizes are in millimetres.');
    if (Number.isFinite(s.thinnest) && s.thinnest < 0.5) add('warn', `Thinnest feature is ${s.thinnest.toFixed(2)} mm: below 0.5 mm it is unlikely to be manufacturable.`);
  }
  if (!d.meta.material || /^\s*$/.test(d.meta.material)) add('warn', 'No material is specified.'); else add('ok', `Material: ${d.meta.material}.`);
  if (!d.calc.standards.length) add('warn', 'No standard is listed for this component.');
  add('warn', 'Tolerances are not specified: the drawing shows nominal dimensions only. Add tolerances before ordering parts.');
  add('info', 'This is a geometry and data check only. It is NOT an engineering, strength or manufacturing approval.');
  const errors = checks.filter((c) => c.level === 'error').length, warns = checks.filter((c) => c.level === 'warn').length;
  return errors ? { status: 'fail', checks, summary: `${errors} error(s): cannot export` } : warns ? { status: 'warn', checks, summary: `Geometry checks passed with ${warns} warning(s)` } : { status: 'pass', checks, summary: 'Geometry checks passed' };
}
