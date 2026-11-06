import { useEffect, useMemo, useState } from 'react';
import { FAMILIES, getFamily } from '../families/index.ts';
import { ParamForm } from '../ui/ParamForm.tsx';
import { Viewer3D } from '../ui/Viewer3D.tsx';
import { DrawingWorkspace } from '../ui/DrawingWorkspace.tsx';
import { alignCoaxial, buildBom, checkCompatibility, checkInterference, exampleAssembly, explodeOffsets, newItemId, placeAll } from '../assembly/model.ts';
import type { AsmItem, Assembly } from '../assembly/model.ts';
import { assemblySheet } from '../assembly/drawing.ts';
import { assemblyParts, assemblySource } from '../assembly/export.ts';
import { KINDS, buildPackage, download, makeArtifact } from '../exporters/index.ts';
import type { Kind } from '../exporters/index.ts';
import { deleteAssembly, listAssemblies, saveAssembly } from '../storage/db.ts';
import { newId, parseAssembly } from '../storage/project.ts';
import type { AssemblyLike } from '../storage/project.ts';
import type { V3 } from '../core/xform.ts';
import { VariantPicker } from '../ui/VariantPicker.tsx';
import { toast } from '../ui/Toast.tsx';
import { rollerConveyor, rollerConveyorDefaults } from '../assembly/presets.ts';
import type { RollerConveyorOpts } from '../assembly/presets.ts';

type Tab = '3d' | '2d' | 'checks' | 'bom' | 'export';
const AXES = ['X', 'Y', 'Z'] as const;

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <label className="mini"><span>{label}</span><input type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))} /></label>;
}

export function AssemblyPage() {
  const [items, setItems] = useState<AsmItem[]>([]);
  const [name, setName] = useState('My assembly');
  const [rev, setRev] = useState('A');
  const [asmId, setAsmId] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('3d');
  const [explode, setExplode] = useState(0);
  const [famId, setFamId] = useState('shaft');
  const [varId, setVarId] = useState('');
  const [alignTo, setAlignTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<AssemblyLike[]>([]);
  const [famQ, setFamQ] = useState('');
  const [pre, setPre] = useState<RollerConveyorOpts>(rollerConveyorDefaults);

  const refreshSaved = () => { listAssemblies().then(setSaved).catch(() => setMsg('Local storage is not available in this browser.')); };
  useEffect(() => {
    refreshSaved();
    const raw = sessionStorage.getItem('ultraplast.asm.add');
    if (raw) {
      sessionStorage.removeItem('ultraplast.asm.add');
      try { const { familyId, params } = JSON.parse(raw), f = getFamily(familyId); if (f) { const it: AsmItem = { id: newItemId(), familyId: f.id, name: f.name, params, pos: [0, 0, 0], rot: [0, 0, 0] }; setItems([it]); setSel(it.id); } } catch { /* ignore */ }
    }
  }, []);

  const { placed, invalid } = useMemo(() => placeAll(items), [items]);
  const issues = useMemo(() => [...checkCompatibility(placed), ...checkInterference(placed)], [placed]);
  const bom = useMemo(() => buildBom(placed), [placed]);
  const size = useMemo(() => Math.max(50, ...placed.map((p) => Math.max(...p.pos.map(Math.abs)) + 60)), [placed]);
  const offsets = useMemo<V3[]>(() => explodeOffsets(placed, explode, size * 0.5), [placed, explode, size]);
  const parts = useMemo(() => assemblyParts(placed, offsets), [placed, offsets]);
  useEffect(() => () => { parts.forEach((p) => p.geometry.dispose()); }, [parts]);
  const sheet = useMemo(() => (placed.length ? assemblySheet(name, placed, rev).sheet : null), [placed, name, rev]);
  const flagged = useMemo(() => new Set(placed.filter((p) => issues.some((i) => i.level === 'error' && i.items.includes(p.item.name))).map((p) => p.item.id)), [placed, issues]);
  const item = items.find((i) => i.id === sel);
  const fam = item ? getFamily(item.familyId) : undefined;
  const mass = bom.reduce((a, r) => a + r.massTotal, 0);

  const patch = (id: string, p: Partial<AsmItem>) => setItems((a) => a.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const nudge = (axis: number, d: number) => item && patch(item.id, { pos: item.pos.map((v, k) => (k === axis ? +(v + d).toFixed(4) : v)) as V3 });
  const add = () => {
    const f = getFamily(famId); if (!f) return;
    const v = f.variants.find((x) => x.id === varId), n = items.filter((i) => i.familyId === f.id).length + 1;
    const it: AsmItem = { id: newItemId(), familyId: f.id, name: `${f.name} ${n}`, params: { ...(v ? v.params : f.defaults) }, pos: [0, 0, 0], rot: [0, 0, 0] };
    setItems((a) => [...a, it]); setSel(it.id);
  };
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(true); setMsg(`${label}...`); try { await fn(); setMsg(`${label}: done.`); toast(`${label}: done.`, 'ok'); } catch (e) { const m = `${label} failed: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); toast(m, 'err'); } finally { setBusy(false); } };
  const asm = (): Assembly => ({ id: asmId ?? newId(), name, items, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const exportOne = (k: Kind) => run(`Export ${k}`, async () => { download(await makeArtifact(k, assemblySource(asm(), placed, issues, rev))); });
  const ready = placed.length > 0 && invalid.length === 0;

  return (
    <div className="designer">
      <aside className="panel">
        <h2>Assembly designer <span className="badge">PRELIMINARY</span></h2>
        <label className="field"><span>Assembly name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="actions wrap">
          <button onClick={() => { const ex = exampleAssembly(); setItems(ex); setSel(ex[0].id); setName('Drive shaft with sprocket and bearings'); setAsmId(null); }}>Load example</button>
          <button className="primary" disabled={busy || !items.length} onClick={() => run('Save', async () => { const a = asm(); await saveAssembly(a); setAsmId(a.id); refreshSaved(); })}>Save</button>
          <button disabled={!items.length} onClick={() => { setItems([]); setSel(null); setAsmId(null); }}>Clear</button>
        </div>
        {saved.length > 0 && (
          <label className="field"><span>Open saved assembly</span>
            <select value="" onChange={(e) => { const a = saved.find((x) => x.id === e.target.value); if (a) { setItems(a.items as AsmItem[]); setName(a.name); setAsmId(a.id); setSel(a.items[0]?.id ?? null); } }}>
              <option value="">Choose...</option>{saved.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {asmId && <button onClick={() => run('Delete', async () => { await deleteAssembly(asmId); setAsmId(null); refreshSaved(); })}>Delete this saved assembly</button>}
          </label>
        )}
        <h3>Add a component</h3>
        <div className="form">
          <input placeholder="Search component type, e.g. bearing, roller, plate" value={famQ} onChange={(e) => setFamQ(e.target.value)} aria-label="Search component types" />
          <select value={famId} onChange={(e) => { setFamId(e.target.value); setVarId(''); }}>{FAMILIES.filter((f) => !famQ || `${f.name} ${f.keywords.join(' ')}`.toLowerCase().includes(famQ.toLowerCase()) || f.id === famId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <VariantPicker label="Size (optional)" variants={getFamily(famId)?.variants ?? []} onPick={(id) => setVarId(id)} />
          <p className="muted">{varId ? `Selected size: ${varId}` : 'Default size will be used.'}</p>
          <button className="primary" onClick={add}>Add to assembly</button>
        </div>
        <details className="presets"><summary>Preset: straight roller conveyor section</summary>
          <p className="muted">Generates two U-channel side frames and rollers at your pitch. Rollers end exactly on the frames' inner faces.</p>
          <div className="grid2">
            <Num label="Length (mm)" value={pre.length} onChange={(v) => setPre({ ...pre, length: v })} />
            <Num label="Width between frames (mm)" value={pre.width} onChange={(v) => setPre({ ...pre, width: v })} />
            <Num label="Roller diameter (mm)" value={pre.rollerOD} onChange={(v) => setPre({ ...pre, rollerOD: v })} />
            <Num label="Roller pitch (mm)" value={pre.pitch} onChange={(v) => setPre({ ...pre, pitch: v })} />
            <Num label="Frame height (mm)" value={pre.frameH} onChange={(v) => setPre({ ...pre, frameH: v })} />
            <Num label="Frame flange (mm)" value={pre.frameB} onChange={(v) => setPre({ ...pre, frameB: v })} />
          </div>
          <button className="primary" onClick={() => { try { const it = rollerConveyor(pre); setItems(it); setSel(it[0].id); setName('Roller conveyor section'); setAsmId(null); toast(`Created ${it.length} components.`, 'ok'); } catch (e) { toast(e instanceof Error ? e.message : 'Invalid preset values.', 'err'); } }}>Generate section</button>
        </details>
        <h3>Components ({items.length})</h3>
        <ul className="itemlist">
          {items.map((i) => (
            <li key={i.id} className={`${sel === i.id ? 'on' : ''} ${flagged.has(i.id) ? 'bad' : ''}`} onClick={() => setSel(i.id)}>
              <span>{i.name}{invalid.some((x) => x.id === i.id) && <em className="tag err"> invalid</em>}</span>
              <span className="row-actions">
                <button title="Duplicate" onClick={(e) => { e.stopPropagation(); setItems((a) => [...a, { ...i, id: newItemId(), name: `${i.name} copy`, pos: [i.pos[0], i.pos[1], i.pos[2] + 10] }]); }}>⧉</button>
                <button title="Remove" onClick={(e) => { e.stopPropagation(); setItems((a) => a.filter((x) => x.id !== i.id)); if (sel === i.id) setSel(null); }}>✕</button>
              </span>
            </li>
          ))}
          {!items.length && <li className="muted">No components yet. Add one above or load the example.</li>}
        </ul>
        {item && fam && (
          <div className="editor">
            <h3>Selected: {item.name}</h3>
            <label className="field"><span>Name</span><input value={item.name} onChange={(e) => patch(item.id, { name: e.target.value })} /></label>
            <div className="grid3">{AXES.map((a, k) => <Num key={a} label={`${a} (mm)`} value={item.pos[k]} onChange={(v) => patch(item.id, { pos: item.pos.map((x, j) => (j === k ? v : x)) as V3 })} />)}</div>
            <div className="grid3">{AXES.map((a, k) => <Num key={a} label={`Rot ${a} (°)`} value={item.rot[k]} onChange={(v) => patch(item.id, { rot: item.rot.map((x, j) => (j === k ? v : x)) as V3 })} />)}</div>
            <div className="nudge">{AXES.map((a, k) => <span key={a}>{a}: <button onClick={() => nudge(k, -10)}>-10</button><button onClick={() => nudge(k, -1)}>-1</button><button onClick={() => nudge(k, 1)}>+1</button><button onClick={() => nudge(k, 10)}>+10</button></span>)}</div>
            <div className="align">
              <b>Align on another component's axis</b>
              <select value={alignTo} onChange={(e) => setAlignTo(e.target.value)}><option value="">Choose target...</option>{items.filter((x) => x.id !== item.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <Num label="Axial position from target origin (mm)" value={offset} onChange={setOffset} />
              <button disabled={!alignTo} onClick={() => setItems((a) => alignCoaxial(a, item.id, alignTo, offset))}>Align</button>
            </div>
            <h4>Parameters</h4>
            <ParamForm fields={fam.fields} params={item.params} onChange={(p) => patch(item.id, { params: p })} />
            {invalid.some((x) => x.id === item.id) && <div className="box err">These parameters are invalid: {fam.calculate(item.params).errors.join(' ')}</div>}
          </div>
        )}
        {msg && <p className="muted">{msg}</p>}
      </aside>
      <section className="work">
        <nav className="tabs">{([['3d', '3D assembly'], ['2d', '2D drawing'], ['checks', `Checks (${issues.filter((i) => i.level !== 'info').length})`], ['bom', 'Bill of materials'], ['export', 'Downloads']] as [Tab, string][]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        {!placed.length && <div className="empty"><h3>Build an assembly</h3><p>Add components from the left or load the example (shaft, two bearings and a sprocket). Position and rotate them, align them on a shaft axis, and the tool checks bore fits and interference.</p></div>}
        {placed.length > 0 && tab === '3d' && (
          <div>
            <div className="toolbar"><label className="chk">Exploded view <input type="range" min={0} max={1} step={0.02} value={explode} onChange={(e) => setExplode(parseFloat(e.target.value))} /></label><span className="muted">{placed.length} components · approx. mass {mass.toFixed(3)} kg · {issues.filter((i) => i.level === 'error').length} errors, {issues.filter((i) => i.level === 'warning').length} warnings</span></div>
            <Viewer3D key={items.length} parts={parts} groupOf={(id) => id.split(':')[0]} selectedGroup={sel} onSelectGroup={setSel} flaggedGroups={flagged} showExplode={false} />
          </div>
        )}
        {placed.length > 0 && tab === '2d' && sheet && <DrawingWorkspace sheet={sheet} />}
        {tab === 'checks' && (
          <div className="calc">
            <p className="muted">Compatibility rules check bore against shaft diameter on shared axes and chain consistency. Interference is exact for coaxial round parts and a bounding-box estimate otherwise. Shaft keyways, tolerances and fits are not modelled.</p>
            {invalid.length > 0 && <div className="box err"><b>Components with invalid parameters (not included in checks):</b> {invalid.map((i) => i.name).join(', ')}</div>}
            {issues.length === 0 && placed.length > 0 && <div className="box ok">No issues found by the implemented checks.</div>}
            <ul className="issues">{issues.map((i, k) => <li key={k} className={i.level}><span className={`tag ${i.level === 'error' ? 'err' : i.level === 'warning' ? 'warn' : 'info'}`}>{i.level}</span> {i.message}</li>)}</ul>
          </div>
        )}
        {tab === 'bom' && (
          <div className="calc">
            <table className="tbl wide"><thead><tr><th>#</th><th>Part no.</th><th>Description</th><th>Material</th><th>Qty</th><th>Mass each (kg)</th><th>Total (kg)</th></tr></thead>
              <tbody>{bom.map((r) => <tr key={r.partNo + r.no}><td>{r.no}</td><td>{r.partNo}</td><td>{r.name}</td><td>{r.material}</td><td>{r.qty}</td><td className="num">{r.massEach.toFixed(4)}</td><td className="num">{r.massTotal.toFixed(4)}</td></tr>)}
                {!bom.length && <tr><td colSpan={7} className="muted">Nothing to list yet.</td></tr>}</tbody></table>
            {bom.length > 0 && <p><b>Total approximate mass: {mass.toFixed(3)} kg</b></p>}
          </div>
        )}
        {tab === 'export' && (
          <div className="calc">
            <p className="muted">Assembly files are generated from the placed components. The assembly STEP is one compound of the placed solids; if the CAD kernel version cannot build a compound, individual part STEP files are included in the ZIP package instead.</p>
            {(['2D', '3D', 'Documents'] as const).map((g) => (
              <div key={g}><h3>{g === 'Documents' ? 'Reports and data' : `${g} files`}</h3><div className="actions wrap">{KINDS.filter((k) => k.group === g).map((k) => <button key={k.kind} disabled={busy || !ready} onClick={() => exportOne(k.kind)}>{k.kind === 'project' ? 'Assembly file (JSON)' : k.kind === 'dims' ? 'Placement sheet (CSV)' : k.label}</button>)}</div></div>
            ))}
            <h3>Complete assembly package</h3>
            <button className="primary" disabled={busy || !ready} onClick={() => run('Package', async () => { download(await buildPackage(assemblySource(asm(), placed, issues, rev), setMsg)); })}>Download ZIP package</button>
            <label className="field narrow"><span>Drawing revision</span><input value={rev} maxLength={3} onChange={(e) => setRev(e.target.value.toUpperCase())} /></label>
            <label className="field narrow"><span>Import an assembly file</span><input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const a = parseAssembly(await f.text(), FAMILIES); setItems(a.items as AsmItem[]); setName(a.name); setAsmId(null); setSel(a.items[0]?.id ?? null); setMsg('Assembly imported.'); } catch (err) { setMsg(err instanceof Error ? err.message : 'Import failed.'); } e.target.value = ''; }} /></label>
          </div>
        )}
      </section>
    </div>
  );
}
