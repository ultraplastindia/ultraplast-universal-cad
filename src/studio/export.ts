import * as THREE from 'three';
import type { Part3D } from '../core/family.ts';
import type { Sheet } from '../cad2d/sheet.ts';
import type { ExportSource } from '../exporters/index.ts';
import { geoToParts } from '../core/prims3d.ts';
import type { StudioDoc } from './model.ts';
import { serializeDoc } from './model.ts';
import type { Built } from './solid.ts';
import { detectParams } from './params.ts';
import { studioExact } from './occ.ts';
import { today } from '../core/util.ts';

/* Browser-only glue: 3D meshes for the viewer and the STL/OBJ/GLB/GLTF exporters, and one ExportSource so the studio uses the
 * same file writers as the rest of the application (DXF/SVG/PNG/PDF from the sheet, STEP from the exact kernel). */

/** Preview meshes with every body placed where it belongs in the sketch. */
export function builtToParts(built: Built): Part3D[] {
  return built.parts.map((m) => {
    const [p] = geoToParts([m.geo]);
    const g = p.geometry.clone();
    if (m.place.rot[0]) g.rotateX((m.place.rot[0] * Math.PI) / 180);
    if (m.place.rot[1]) g.rotateY((m.place.rot[1] * Math.PI) / 180);
    if (m.place.rot[2]) g.rotateZ((m.place.rot[2] * Math.PI) / 180);
    g.translate(m.place.pos[0], m.place.pos[1], m.place.pos[2]);
    return { ...p, geometry: g };
  });
}
/** One mesh from the exact kernel (vertices/triangles from replicad's mesh()). */
export function meshToPart(id: string, name: string, color: string, m: { vertices: number[]; triangles: number[] }): Part3D {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
  g.setIndex(m.triangles);
  g.computeVertexNormals();
  return { id, name, geometry: g.toNonIndexed(), color, explode: [0, 0, 0] };
}

const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
export function studioSource(doc: StudioDoc, built: Built, sheet: Sheet, parts: Part3D[]): ExportSource {
  const base = `${doc.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'design'}_v${doc.version}_rev${doc.revision}`;
  const ps = detectParams(doc);
  const dims = ['Group,Parameter,Value,Unit,From', ...ps.map((p) => [p.group, p.label, p.value, p.unit, p.origin].map(q).join(','))].join('\r\n') + '\r\n';
  const bom = [['Item', 'Body', 'Operation', 'Material', 'Volume (cm3)', 'Mass (kg)', 'Notes'].map(q).join(','),
    ...built.reports.map((r, i) => { const b = doc.bodies.find((x) => x.id === r.id); return [i + 1, r.name, b ? `${b.op} / ${b.mode}` : '', b?.material ?? '', (r.volume / 1000).toFixed(3), r.mass.toFixed(4), [r.error, ...r.approx, ...r.exactOnly.map((x) => `${x}: exact in STEP only`)].filter(Boolean).join('; ')].map(q).join(','); })].join('\r\n') + '\r\n';
  const rows = (xs: string[]) => xs.map((x) => `- ${x}`);
  return {
    baseName: base, partNo: doc.id.slice(0, 18).toUpperCase(), revision: doc.revision, sheet, parts, dimsLabel: 'parameters',
    step: (R) => studioExact(R, doc).shape,
    bom, dims, project: serializeDoc(doc),
    pdf: { title: doc.name, partNo: doc.id.slice(0, 18).toUpperCase(), drawingNo: `UP-ST-${doc.id.slice(2, 10).toUpperCase()}`, revision: doc.revision, date: today(), sheet, sections: [
      { title: 'Design', rows: [`Component type: ${doc.componentType}`, `Material: ${doc.material}`, `Version ${doc.version}, revision ${doc.revision}`, `Created ${doc.createdAt.slice(0, 10)} by ${doc.createdBy || 'unknown'}`, `Mass from the model: ${built.mass.toFixed(4)} kg (volume ${(built.volume / 1000).toFixed(3)} cm³)`] },
      { title: 'Parameters', rows: ps.slice(0, 80).map((p) => `${p.group} - ${p.label}: ${p.value} ${p.unit === 'count' ? '' : p.unit}`) },
      { title: '3D bodies', rows: built.reports.map((r) => `${r.name}: ${r.ok ? `${(r.volume / 1000).toFixed(3)} cm³` : r.error ?? ''}${r.approx.length ? ` (${r.approx.join('; ')})` : ''}`) },
      { title: 'Notes and limits', rows: rows([...doc.notes, 'Geometry and data checks only. This is NOT an engineering, strength or manufacturing approval.', 'Values read from pictures, PDFs or AI must be confirmed against the real part or the original drawing.']) },
    ] },
  };
}
