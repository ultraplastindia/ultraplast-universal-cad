import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part3D } from './family.ts';
import type { GeoPart, Prim } from './prims.ts';
import { circleSegments } from './geom.ts';

const circlePtsAt = (c: [number, number], r: number): [number, number][] => { const n = circleSegments(r, 0.003, 48); return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as [number, number]); };

function primGeometry(p: Prim): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.kind === 'tube') {
    const pts = [[p.rIn, p.z0], [p.rOut, p.z0], [p.rOut, p.z1], [p.rIn, p.z1], [p.rIn, p.z0]].map((q) => new THREE.Vector2(q[0], q[1]));
    g = new THREE.LatheGeometry(pts, circleSegments(p.rOut, 0.003, 64));
    g.rotateX(Math.PI / 2); // lathe axis Y -> part axis Z (y range maps onto z)
  } else if (p.kind === 'sphere') {
    const seg = circleSegments(p.r, 0.003, 32);
    g = new THREE.SphereGeometry(p.r, seg, Math.ceil(seg / 2));
    g.translate(p.c[0], p.c[1], p.c[2]);
  } else {
    const shape = new THREE.Shape(p.outer.map((q) => new THREE.Vector2(q[0], q[1])));
    for (const h of p.holes) {
      const pts: [number, number][] = 'poly' in h ? h.poly : circlePtsAt(h.c, h.r);
      shape.holes.push(new THREE.Path(pts.map((q) => new THREE.Vector2(q[0], q[1]))));
    }
    g = new THREE.ExtrudeGeometry(shape, { depth: p.z1 - p.z0, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, p.z0);
  }
  return g.index ? g.toNonIndexed() : g;
}

export function geoToParts(geo: GeoPart[]): Part3D[] {
  return geo.map((g) => {
    const gs = g.prims.map(primGeometry);
    return { id: g.id, name: g.name, geometry: gs.length === 1 ? gs[0] : mergeGeometries(gs)!, color: g.color, explode: g.explode };
  });
}
