import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Part3D } from '../core/family.ts';

type ViewName = 'iso' | 'face' | 'side' | 'top';
const COLORS: Record<string, string | null> = { 'Part colour': null, Steel: '#9aa3ad', Brass: '#c9a23c', 'White plastic': '#f2f2ee', Blue: '#2f6fb5', Dark: '#3a3f45' };

function Rig({ cmd, size }: { cmd: { name: ViewName; n: number }; size: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    const d = size * 2.3;
    const pos: Record<ViewName, [number, number, number]> = { face: [0, 0, d], side: [d, 0, 0], top: [0, d, 0], iso: [d * 0.7, d * 0.55, d * 0.85] };
    camera.position.set(...pos[cmd.name]);
    camera.up.set(0, cmd.name === 'top' ? 0 : 1, cmd.name === 'top' ? -1 : 0);
    camera.lookAt(0, 0, 0);
    camera.far = size * 60; camera.updateProjectionMatrix();
    if (controls) { controls.target.set(0, 0, 0); controls.update(); }
  }, [cmd, size, camera, controls]);
  return null;
}

export interface ViewerProps {
  parts: Part3D[];
  /** assemblies: maps a part id to the item it belongs to, so a click selects the whole item */
  groupOf?: (partId: string) => string;
  selectedGroup?: string | null;
  onSelectGroup?: (g: string | null) => void;
  flaggedGroups?: Set<string>;
  showExplode?: boolean;
}

export function Viewer3D({ parts, groupOf, selectedGroup, onSelectGroup, flaggedGroups, showExplode = true }: ViewerProps) {
  const [cmd, setCmd] = useState<{ name: ViewName; n: number }>({ name: 'iso', n: 0 });
  const [wire, setWire] = useState(false);
  const [section, setSection] = useState(false);
  const [explode, setExplode] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [localSel, setLocalSel] = useState<string | null>(null);
  const [colour, setColour] = useState('Part colour');
  const [metal, setMetal] = useState(0.4);
  const [rough, setRough] = useState(0.5);
  const key = (id: string) => (groupOf ? groupOf(id) : id);
  const sel = onSelectGroup ? selectedGroup ?? null : localSel;
  const select = (g: string | null) => (onSelectGroup ? onSelectGroup(g) : setLocalSel(g));

  const { size, center } = useMemo(() => {
    const box = new THREE.Box3();
    parts.forEach((p) => { p.geometry.computeBoundingBox(); if (p.geometry.boundingBox) box.union(p.geometry.boundingBox); });
    const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    return { size: Math.max(s.x, s.y, s.z, 1), center: c };
  }, [parts]);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const selPart = parts.find((p) => key(p.id) === sel);
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shown = parts.filter((p) => !hidden.has(p.id));

  return (
    <div className="viewer">
      <div className="toolbar">
        <div className="seg">{(['iso', 'face', 'side', 'top'] as ViewName[]).map((v) => <button key={v} onClick={() => setCmd({ name: v, n: Date.now() })}>{v === 'iso' ? 'Isometric' : v === 'face' ? 'Front' : v === 'side' ? 'Side' : 'Top'}</button>)}</div>
        <label className="chk"><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> Wireframe</label>
        <label className="chk"><input type="checkbox" checked={section} onChange={(e) => setSection(e.target.checked)} /> Section</label>
        {showExplode && <label className="chk">Explode <input type="range" min={0} max={1} step={0.02} value={explode} onChange={(e) => setExplode(parseFloat(e.target.value))} /></label>}
        <label className="chk">Finish <select value={colour} onChange={(e) => setColour(e.target.value)}>{Object.keys(COLORS).map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="chk">Metal <input type="range" min={0} max={1} step={0.05} value={metal} onChange={(e) => setMetal(parseFloat(e.target.value))} /></label>
        <label className="chk">Rough <input type="range" min={0.1} max={1} step={0.05} value={rough} onChange={(e) => setRough(parseFloat(e.target.value))} /></label>
      </div>
      <div className="parts">
        {parts.map((p) => <label key={p.id} className="chk"><input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>)}
      </div>
      <div className="canvas-wrap">
        <Canvas gl={{ alpha: true }} camera={{ fov: 40, near: 0.1 }} onCreated={({ gl }) => { gl.localClippingEnabled = true; }} onPointerMissed={() => select(null)}>
          <hemisphereLight args={['#ffffff', '#8892a0', 1.1]} />
          <directionalLight position={[size, size * 2, size * 3]} intensity={2.2} />
          <directionalLight position={[-size * 2, -size, size]} intensity={0.8} />
          <Rig cmd={cmd} size={size} />
          <group position={[-center.x, -center.y, -center.z]}>
            {shown.map((p) => {
              const g = key(p.id), flagged = flaggedGroups?.has(g), selected = sel === g;
              return (
                <mesh key={p.id} geometry={p.geometry} position={p.explode.map((v) => v * explode * size * 0.35) as [number, number, number]} onClick={(e) => { e.stopPropagation(); select(g); }}>
                  <meshStandardMaterial color={flagged ? '#e5484d' : COLORS[colour] ?? p.color} metalness={metal} roughness={rough} wireframe={wire} side={THREE.DoubleSide} clippingPlanes={section ? [plane] : []} emissive={selected ? '#ff8a00' : '#000000'} emissiveIntensity={selected ? 0.4 : 0} />
                </mesh>
              );
            })}
          </group>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
        <div className="hint">{selPart ? <b>Selected: {groupOf ? sel : selPart.name}</b> : 'Click a part to select it'} · drag = rotate · right-drag = pan · wheel = zoom · part axis is Z</div>
      </div>
    </div>
  );
}
