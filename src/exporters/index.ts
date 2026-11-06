import JSZip from 'jszip';
import type { Part3D } from '../core/family.ts';
import type { Sheet } from '../cad2d/sheet.ts';
import type { Design } from '../lib/design.ts';
import { toDxf } from './dxf.ts';
import { sheetToSvg } from './svg.ts';
import { toPng } from './png.ts';
import { buildPdf, loadLogo } from './pdf.ts';
import type { Logo, PdfData } from './pdf.ts';
import { toGltf, toObj, toStl } from './export3d.ts';
import { loadKernel, makeStep } from './kernel.ts';
import { bomCsv, dimensionsCsv } from './csv.ts';
import { geoToParts } from '../core/prims3d.ts';
import { newId, serializeProject } from '../storage/project.ts';
import { today } from '../core/util.ts';

export type Kind = 'dxf' | 'svg' | 'png' | 'pdf-drawing' | 'pdf-spec' | 'stl' | 'obj' | 'glb' | 'gltf' | 'step' | 'bom' | 'dims' | 'project';
export interface Artifact { name: string; blob: Blob }

/** Everything an export needs, independent of whether it is one component or an assembly. */
export interface ExportSource {
  baseName: string; partNo: string; revision: string; sheet: Sheet; parts: Part3D[]; pdf: PdfData;
  /** replicad solid for STEP (assemblies: one compound) */
  step: (R: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** optional per-part STEP files, added to the package so that assemblies still deliver geometry if compounds are unavailable */
  stepParts?: (R: any) => { name: string; shape: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  bom: string; dims: string; project: string; dimsLabel: string;
}

export const KINDS: { kind: Kind; label: string; group: '2D' | '3D' | 'Documents' }[] = [
  { kind: 'dxf', label: 'DXF (2D drawing)', group: '2D' }, { kind: 'svg', label: 'SVG (2D drawing)', group: '2D' }, { kind: 'png', label: 'PNG (2D drawing)', group: '2D' }, { kind: 'pdf-drawing', label: 'PDF (drawing)', group: '2D' },
  { kind: 'step', label: 'STEP (B-rep solid)', group: '3D' }, { kind: 'stl', label: 'STL', group: '3D' }, { kind: 'obj', label: 'OBJ', group: '3D' }, { kind: 'glb', label: 'GLB', group: '3D' }, { kind: 'gltf', label: 'GLTF', group: '3D' },
  { kind: 'pdf-spec', label: 'Technical specification PDF', group: 'Documents' }, { kind: 'dims', label: 'Dimension sheet (CSV)', group: 'Documents' }, { kind: 'bom', label: 'Bill of materials (CSV)', group: 'Documents' }, { kind: 'project', label: 'Project file (JSON)', group: 'Documents' },
];

let logoCache: Promise<Logo | null> | null = null;
const logo = () => (logoCache ??= loadLogo());

export function sourceFromDesign(d: Design, familyId: string, name = d.partNo): ExportSource {
  if (!d.calc.ok || !d.sheet || !d.geo) throw new Error('Fix the design errors before exporting.');
  const rows = (r: { label: string; value: string; unit?: string }[]) => r.map((x) => `${x.label}: ${x.value}${x.unit ? ' ' + x.unit : ''}`);
  const now = new Date().toISOString();
  return {
    baseName: `${d.partNo}_rev${d.meta.revision}`, partNo: d.partNo, revision: d.meta.revision, sheet: d.sheet, parts: geoToParts(d.geo), dimsLabel: 'dimensions',
    step: (R) => d.family.solid(R, d.calc.derived), bom: bomCsv(d), dims: dimensionsCsv(d),
    project: serializeProject({ id: newId(), name, familyId, params: d.params, revision: d.meta.revision, createdAt: now, updatedAt: now }),
    pdf: { title: d.family.name, partNo: d.partNo, drawingNo: d.meta.drawingNo, revision: d.meta.revision, date: d.meta.date, sheet: d.sheet, sections: [
      { title: 'Inputs', rows: rows(d.calc.inputs) }, { title: 'Calculated values', rows: rows(d.calc.calculated) }, { title: 'Assumptions', rows: d.calc.assumptions.map((a) => `- ${a}`) },
      { title: 'Engineering warnings', rows: d.calc.warnings.map((a) => `- ${a}`) }, { title: 'Applicable standards', rows: d.calc.standards.map((a) => `- ${a}`) }] },
  };
}

export async function makeArtifact(kind: Kind, s: ExportSource): Promise<Artifact> {
  const L = await logo(), base = s.baseName;
  switch (kind) {
    case 'dxf': return { name: `${base}.dxf`, blob: new Blob([toDxf(s.sheet.ents)], { type: 'application/dxf' }) };
    case 'svg': return { name: `${base}.svg`, blob: new Blob([sheetToSvg(s.sheet, { logoHref: L?.dataUrl ?? null })], { type: 'image/svg+xml' }) };
    case 'png': return { name: `${base}.png`, blob: await toPng(s.sheet, L?.dataUrl ?? null) };
    case 'pdf-drawing': return { name: `${base}_drawing.pdf`, blob: buildPdf(s.pdf, L, 'drawing') };
    case 'pdf-spec': return { name: `${base}_specification.pdf`, blob: buildPdf(s.pdf, L, 'spec') };
    case 'stl': return { name: `${base}.stl`, blob: toStl(s.parts) };
    case 'obj': return { name: `${base}.obj`, blob: toObj(s.parts) };
    case 'glb': return { name: `${base}.glb`, blob: await toGltf(s.parts, true) };
    case 'gltf': return { name: `${base}.gltf`, blob: await toGltf(s.parts, false) };
    case 'step': return { name: `${base}.step`, blob: await makeStep(s.step) };
    case 'bom': return { name: `${base}_BOM.csv`, blob: new Blob([s.bom], { type: 'text/csv' }) };
    case 'dims': return { name: `${base}_${s.dimsLabel}.csv`, blob: new Blob([s.dims], { type: 'text/csv' }) };
    case 'project': return { name: `${base}.ultraplast.json`, blob: new Blob([s.project], { type: 'application/json' }) };
  }
}

export function download(a: Artifact): void {
  const url = URL.createObjectURL(a.blob), el = document.createElement('a');
  el.href = url; el.download = a.name; document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Complete package. Every file is generated for real; anything that fails is listed in README.txt instead of being faked. */
export async function buildPackage(s: ExportSource, onStatus: (m: string) => void): Promise<Artifact> {
  const zip = new JSZip(), notes: string[] = [];
  for (const k of KINDS.map((x) => x.kind)) {
    onStatus(`Generating ${k}...`);
    try { const a = await makeArtifact(k, s); zip.file(a.name, a.blob); } catch (e) { notes.push(`${k}: NOT GENERATED - ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (s.stepParts) {
    onStatus('Generating per-part STEP files...');
    try { const R = await loadKernel(); for (const p of s.stepParts(R)) zip.file(`parts/${p.name}.step`, (p.shape.blobSTEP() as Blob)); } catch (e) { notes.push(`per-part STEP: NOT GENERATED - ${e instanceof Error ? e.message : String(e)}`); }
  }
  zip.file('README.txt', [`Ultraplast Chainbelts Private Limited - design package`, `Part: ${s.partNo}`, `Generated: ${today()}`, '', 'STATUS: PRELIMINARY. Not validated for manufacture.', '', ...(notes.length ? ['Items that could not be generated:', ...notes] : ['All files generated.'])].join('\r\n'));
  onStatus('Compressing...');
  return { name: `${s.baseName}_package.zip`, blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }) };
}
