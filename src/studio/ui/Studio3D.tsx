import { useMemo, useState } from 'react';
import type { Part3D } from '../../core/family.ts';
import type { StudioDoc } from '../model.ts';
import type { Built } from '../solid.ts';
import { Viewer3D } from '../../ui/Viewer3D.tsx';
import { builtToParts, meshToPart } from '../export.ts';
import { loadKernel } from '../../exporters/kernel.ts';
import { meshOf, studioExact } from '../occ.ts';
import { material } from '../../data/materials.ts';

/** 3D tab: quick preview from the exact primitives, or the exact OpenCascade model (fillets, shells, lofts, intersections, crossing cuts). */
export function Studio3D({ doc, built, onExact }: { doc: StudioDoc; built: Built; onExact: (parts: Part3D[] | null) => void }) {
  const quick = useMemo(() => { try { return builtToParts(built); } catch { return []; } }, [built]);
  const [exact, setExact] = useState<{ parts: Part3D[]; volume: number; sig: string } | null>(null);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const sig = JSON.stringify([doc.ents, doc.bodies]);
  const stale = exact && exact.sig !== sig;
  const needExact = built.reports.some((r) => r.exactOnly.length);
  const build = async () => {
    setErr(''); setBusy('Loading the exact 3D kernel (first time only, a few seconds)...');
    try {
      const R = await loadKernel();
      setBusy('Building the exact model...');
      await new Promise((r) => setTimeout(r, 30)); // let the message show
      const ex = studioExact(R, doc);
      const parts: Part3D[] = []; let vol = 0;
      ex.solids.forEach((s: unknown, i: number) => { const m = meshOf(s); vol += m.volume; parts.push(meshToPart(`x${i}`, `Solid ${i + 1}`, doc.bodies.find((b) => b.mode === "new" || b === doc.bodies[0])?.color ?? "#8d96a0", m)); });
      setExact({ parts, volume: vol, sig }); onExact(parts);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setExact(null); onExact(null); }
    setBusy('');
  };
  const show = exact && !stale ? exact.parts : quick;
  const dens = material(doc.material)?.density ?? 7.85e-6;
  return (
    <div className="st-3d">
      <div className="st-row">
        <span><b>{exact && !stale ? 'Exact model (OpenCascade)' : 'Quick preview'}</b> · {doc.bodies.length} body/bodies</span>
        <button onClick={() => void build()} disabled={!!busy || !doc.bodies.length}>{exact && !stale ? 'Rebuild exact model' : 'Build exact model'}</button>
        {exact && <button onClick={() => { setExact(null); onExact(null); }}>Back to quick preview</button>}
        <span className="muted small">{exact && !stale ? `Exact volume ${(exact.volume / 1000).toFixed(3)} cm³ ≈ ${(exact.volume * dens).toFixed(4)} kg (${doc.material})` : `Mass ${built.mass.toFixed(4)} kg from the model volume${needExact ? ' (without fillets/shells/crossing cuts: build the exact model)' : ''}`}</span>
      </div>
      {stale && <p className="warn small">The design changed since the exact model was built. Rebuild it to see the changes.</p>}
      {busy && <p className="st-busy">{busy}</p>}
      {err && <p className="err small">{err}</p>}
      {show.length ? <Viewer3D parts={show} /> : <div className="st-empty">No 3D bodies yet. In the drawing, select a closed outline, open the 3D tab on the right and press Extrude (or Revolve around a centre line).</div>}
    </div>
  );
}
