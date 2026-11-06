import type { ExportSource } from '../exporters/index.ts';
import { geoToParts } from '../core/prims3d.ts';
import type { Part3D } from '../core/family.ts';
import { Matrix4 } from 'three';
import type { V3 } from '../core/xform.ts';
import { today } from '../core/util.ts';
import { serializeAssembly } from '../storage/project.ts';
import { assemblyNumber, assemblySheet } from './drawing.ts';
import { buildBom } from './model.ts';
import type { Assembly, Issue, Placed } from './model.ts';

export function matrixOf(p: Placed, off: V3 = [0, 0, 0]): Matrix4 {
  const m = p.M;
  return new Matrix4().set(m[0], m[1], m[2], p.pos[0] + off[0], m[3], m[4], m[5], p.pos[1] + off[1], m[6], m[7], m[8], p.pos[2] + off[2], 0, 0, 0, 1);
}
/** All parts of all items with their world transform baked into the geometry. */
export function assemblyParts(placed: Placed[], offsets: V3[] = []): Part3D[] {
  return placed.flatMap((p, i) => geoToParts(p.geo).map((pt) => ({ ...pt, id: `${p.item.id}:${pt.id}`, name: `${p.item.name} - ${pt.name}`, explode: [0, 0, 0] as V3, geometry: pt.geometry.clone().applyMatrix4(matrixOf(p, offsets[i])) })));
}

const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
export function assemblySource(asm: Assembly, placed: Placed[], issues: Issue[], revision: string): ExportSource {
  const { sheet, meta } = assemblySheet(asm.name, placed, revision), bom = buildBom(placed), no = assemblyNumber(asm.name);
  const mass = bom.reduce((a, r) => a + r.massTotal, 0);
  const bomCsv = [['Item', 'Part No', 'Description', 'Material', 'Qty', 'Mass each (kg)', 'Mass total (kg)', 'Status'], ...bom.map((r) => [r.no, r.partNo, r.name, r.material, r.qty, r.massEach.toFixed(4), r.massTotal.toFixed(4), 'PRELIMINARY'])].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  const dims = [['Item', 'Component', 'Part No', 'X (mm)', 'Y (mm)', 'Z (mm)', 'Rot X (deg)', 'Rot Y (deg)', 'Rot Z (deg)'], ...placed.map((p) => [p.item.name, p.family.name, p.family.partNo(p.item.params), ...p.item.pos, ...p.item.rot])].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  return {
    baseName: `${no}_rev${revision}`, partNo: no, revision, sheet, parts: assemblyParts(placed), bom: bomCsv, dims, dimsLabel: 'placement',
    project: serializeAssembly({ ...asm, items: asm.items }),
    step: (R) => {
      const mk = R.compoundShapes ?? R.makeCompound;
      if (!mk) throw new Error('This replicad version has no compound builder, so a single assembly STEP cannot be written. Per-part STEP files are in the package ZIP.');
      return mk(placed.map((p) => transformShape(R, p)));
    },
    stepParts: (R) => placed.map((p, i) => ({ name: `${String(i + 1).padStart(2, '0')}_${p.family.partNo(p.item.params)}`, shape: transformShape(R, p) })),
    pdf: { title: `Assembly: ${asm.name}`, partNo: no, drawingNo: meta.drawingNo, revision, date: today(), sheet, sections: [
      { title: 'Bill of materials', rows: bom.map((r) => `${r.no}. ${r.qty} x ${r.partNo} - ${r.name} (${r.material}), ${r.massEach.toFixed(3)} kg each`) },
      { title: 'Total mass (approx.)', rows: [`${mass.toFixed(3)} kg`] },
      { title: 'Placement', rows: placed.map((p) => `${p.item.name}: position ${p.item.pos.join(', ')} mm, rotation ${p.item.rot.join(', ')} deg`) },
      { title: 'Compatibility and interference checks', rows: issues.length ? issues.map((i) => `[${i.level.toUpperCase()}] ${i.message}`) : ['No issues found by the implemented checks.'] },
      { title: 'Limits', rows: ['Interference is exact only for coaxial round parts; other pairs use bounding boxes.', 'Shaft keyways, fits and tolerances are not modelled.'] }] },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformShape(R: any, p: Placed): any {
  let s = p.family.solid(R, p.calc.derived);
  const [rx, ry, rz] = p.item.rot;
  if (rx) s = s.rotate(rx, [0, 0, 0], [1, 0, 0]);
  if (ry) s = s.rotate(ry, [0, 0, 0], [0, 1, 0]);
  if (rz) s = s.rotate(rz, [0, 0, 0], [0, 0, 1]);
  return s.translate(p.item.pos[0], p.item.pos[1], p.item.pos[2]);
}
