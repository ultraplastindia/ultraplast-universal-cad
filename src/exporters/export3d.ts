import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Part3D } from '../core/family.ts';

export function groupFromParts(parts: Part3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) { const m = new THREE.Mesh(p.geometry, new THREE.MeshStandardMaterial({ color: p.color, metalness: 0.4, roughness: 0.5 })); m.name = p.name; g.add(m); }
  g.updateMatrixWorld(true);
  return g;
}
export const toStl = (parts: Part3D[]): Blob => new Blob([new STLExporter().parse(groupFromParts(parts), { binary: true }) as unknown as BlobPart], { type: 'model/stl' });
export const toObj = (parts: Part3D[]): Blob => new Blob([new OBJExporter().parse(groupFromParts(parts))], { type: 'text/plain' });
export function toGltf(parts: Part3D[], binary: boolean): Promise<Blob> {
  return new Promise((res, rej) => {
    new GLTFExporter().parse(groupFromParts(parts), (r) => res(binary ? new Blob([r as ArrayBuffer], { type: 'model/gltf-binary' }) : new Blob([JSON.stringify(r)], { type: 'model/gltf+json' })), (e) => rej(e instanceof Error ? e : new Error('glTF export failed')), { binary });
  });
}
