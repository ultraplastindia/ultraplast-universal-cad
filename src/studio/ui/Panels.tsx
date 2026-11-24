import { useMemo, useState } from 'react';
import type { Pt } from '../../core/types.ts';
import type { Body, Constraint, Ent, LRef, StudioDoc, Unit } from '../model.ts';
import { uid } from '../model.ts';
import { angOf, curveLength, dimValue, dist, findEnt, polarPt } from '../geom.ts';
import { explodePoly, joinChain } from '../edit.ts';
import { describeConstraint, solve } from '../solver.ts';
import { applyParam, detectParams, scaleXY } from '../params.ts';
import { featureLabel, insertLibrary } from '../features.ts';
import { findLoops } from '../profiles.ts';
import type { Built } from '../solid.ts';
import type { Check } from '../validate.ts';
import type { History } from '../history.ts';
import { MATERIALS } from '../../data/materials.ts';
import { FAMILIES } from '../../families/index.ts';
import { LenField, Section } from './Fields.tsx';

export interface PanelProps { doc: StudioDoc; sel: string[]; setSel: (s: string[]) => void; commit: (d: StudioDoc, label: string) => void; status: (m: string, k?: 'ok' | 'err' | 'info') => void; unit: Unit; readOnly?: boolean }

const ENT_NAME: Record<Ent['k'], string> = { line: 'Line', poly: 'Polyline', circle: 'Circle', arc: 'Arc', ellipse: 'Ellipse', spline: 'Spline', text: 'Text', dim: 'Dimension' };
const SRC: Record<Ent['source'], string> = { drawn: 'drawn', imported: 'imported from a file', traced: 'traced from a picture', ai: 'read by AI', library: 'from the library', feature: 'made by a feature' };

/* ---------- Properties of the selection ---------- */
export function PropertiesPanel(p: PanelProps) {
  const { doc, sel, unit } = p;
  const items = sel.map((id) => findEnt(doc, id)).filter((e): e is Ent => !!e);
  const set = (e: Ent, next: Ent, label: string) => { const d = { ...doc, ents: doc.ents.map((x) => (x.id === e.id ? next : x)) }; const s = solve(d, { fixed: [e.id] }); p.commit(s.ok ? s.doc : d, label); if (!s.ok) p.status(`Changed. Constraints could not all be kept: ${s.error}`, 'info'); };
  const del = () => {
    const ids = new Set(items.map((e) => e.id));
    const feats = new Set(items.map((e) => e.feature).filter(Boolean) as string[]);
    const gone = new Set([...ids, ...doc.ents.filter((e) => e.feature && feats.has(e.feature)).map((e) => e.id)]);
    p.commit({ ...doc, ents: doc.ents.filter((e) => !gone.has(e.id) && !(e.k === 'dim' && JSON.stringify(e.d).split('"').some((s) => gone.has(s)))), constraints: doc.constraints.filter((c) => !JSON.stringify(c).split('"').some((s) => gone.has(s))), features: doc.features.filter((f) => !feats.has(f.id)), bodies: doc.bodies.filter((b) => !gone.has(b.profile)) }, 'Delete');
    p.setSel([]);
  };
  if (!items.length) return <div className="st-empty">Nothing selected. Use the Select tool (S) and click an item, or drag a box.<br /><br /><b>Keys:</b> Ctrl+Z undo · Ctrl+Y redo · Delete · Ctrl+C / Ctrl+V copy and paste · Ctrl+D duplicate · Esc cancel · F fit view.</div>;
  const lines = items.filter((e) => e.k === 'line'), circles = items.filter((e) => e.k === 'circle' || e.k === 'arc');
  const addC = (c: Constraint) => { const d = { ...doc, constraints: [...doc.constraints, c] }; const s = solve(d); if (!s.ok) { p.status(s.error ?? 'Conflict.', 'err'); return; } p.commit(s.doc, describeConstraint(c)); };
  const L = (e: Ent): LRef => ({ e: e.id });
  const e = items[0];
  return (
    <div className="st-props">
      <p className="muted">{items.length === 1 ? `${ENT_NAME[e.k]} · ${SRC[e.source]}${e.feature ? ' (edit it in Parameters)' : ''}` : `${items.length} items selected`}</p>
      {items.length === 1 && !e.feature && <EntEditor e={e} doc={doc} unit={unit} onSet={(n, l) => set(e, n, l)} />}
      {items.some((x) => (x.source === 'traced' || x.source === 'ai')) && <label className="chk"><input type="checkbox" checked={items.every((x) => x.confirmed !== false)} onChange={(ev: { target: { checked: boolean } }) => p.commit({ ...doc, ents: doc.ents.map((x) => (sel.includes(x.id) ? { ...x, confirmed: ev.target.checked } : x)) }, ev.target.checked ? 'Confirm' : 'Unconfirm')} /> Confirmed: I checked these against the original drawing or part</label>}
      <div className="st-row">
        <label>Layer <select value={items.every((x) => x.layer === e.layer) ? e.layer : ''} onChange={(ev: { target: { value: string } }) => p.commit({ ...doc, ents: doc.ents.map((x) => (sel.includes(x.id) ? { ...x, layer: ev.target.value } : x)) }, 'Change layer')}><option value="" disabled>mixed</option>{doc.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Line type <select value={e.style ?? 'normal'} onChange={(ev: { target: { value: string } }) => p.commit({ ...doc, ents: doc.ents.map((x) => (sel.includes(x.id) ? { ...x, style: ev.target.value === 'normal' ? undefined : (ev.target.value as 'construction') } : x)) }, 'Line type')}><option value="normal">Normal</option><option value="construction">Construction (helper)</option><option value="centre">Centre line</option></select></label>
      </div>
      <div className="st-btns">
        {items.length === 1 && e.k === 'poly' && <button onClick={() => { const r = explodePoly(e); if (r.ok) { p.commit({ ...doc, ents: [...doc.ents.filter((x) => x.id !== e.id), ...r.add] }, 'Explode'); p.setSel(r.add.map((x) => x.id)); } }}>Explode</button>}
        {items.length > 1 && items.every((x) => x.k === 'line' || x.k === 'arc' || (x.k === 'poly' && !x.closed)) && <button onClick={() => { const r = joinChain(items); if (!r.ok) { p.status(r.error, 'err'); return; } p.commit({ ...doc, ents: [...doc.ents.filter((x) => !r.remove.includes(x.id)), ...r.add] }, 'Join'); p.setSel(r.add.map((x) => x.id)); }}>Join into one outline</button>}
        <button className="danger" onClick={del}>Delete</button>
      </div>
      <Section title="Constraints for the selection" open={false}>
        <div className="st-btns">
          {lines.length === 1 && <><button onClick={() => addC({ id: uid('k'), t: 'horizontal', l: L(lines[0]) })}>Horizontal</button><button onClick={() => addC({ id: uid('k'), t: 'vertical', l: L(lines[0]) })}>Vertical</button></>}
          {lines.length === 2 && <><button onClick={() => addC({ id: uid('k'), t: 'parallel', l1: L(lines[0]), l2: L(lines[1]) })}>Parallel</button><button onClick={() => addC({ id: uid('k'), t: 'perpendicular', l1: L(lines[0]), l2: L(lines[1]) })}>Perpendicular</button><button onClick={() => addC({ id: uid('k'), t: 'equal', l1: L(lines[0]), l2: L(lines[1]) })}>Equal length</button></>}
          {circles.length === 2 && <><button onClick={() => addC({ id: uid('k'), t: 'concentric', e1: circles[0].id, e2: circles[1].id })}>Concentric</button><button onClick={() => addC({ id: uid('k'), t: 'equalRadius', e1: circles[0].id, e2: circles[1].id })}>Equal radius</button></>}
          {lines.length === 1 && circles.length === 1 && <button onClick={() => addC({ id: uid('k'), t: 'tangent', l: L(lines[0]), e: circles[0].id })}>Tangent</button>}
          {lines.length === 3 && <button onClick={() => addC({ id: uid('k'), t: 'symmetric', p1: { e: lines[0].id, i: 0 }, p2: { e: lines[1].id, i: 0 }, axis: L(lines[2]) })} title="Start points of the first two lines are mirror images about the third line">Symmetric about the 3rd line</button>}
          {lines.length === 2 && <button onClick={() => { const a = lines[0], b = lines[1]; if (a.k !== 'line' || b.k !== 'line') return; const pairs: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]]; const [i, j] = pairs.reduce((m, q) => (dist(q[0] ? a.b : a.a, q[1] ? b.b : b.a) < dist(m[0] ? a.b : a.a, m[1] ? b.b : b.a) ? q : m)); addC({ id: uid('k'), t: 'coincident', p1: { e: a.id, i }, p2: { e: b.id, i: j } }); }}>Join nearest ends</button>}
          {items.length === 1 && <button onClick={() => addC({ id: uid('k'), t: 'fix', e: e.id })}>Fix in place</button>}
        </div>
        <p className="muted small">Constraints keep their relation when you edit sizes. Dimensions become driving when you type a value for them in Parameters.</p>
      </Section>
    </div>
  );
}
function EntEditor({ e, doc, unit, onSet }: { e: Ent; doc: StudioDoc; unit: Unit; onSet: (n: Ent, label: string) => void }) {
  if (e.k === 'line') {
    const len = dist(e.a, e.b), ang = (angOf(e.a, e.b) * 180) / Math.PI;
    return <div className="st-grid2">
      <LenField label="Start X" mm={e.a[0]} unit={unit} onSet={(v) => onSet({ ...e, a: [v, e.a[1]] }, 'Edit line')} /><LenField label="Start Y" mm={e.a[1]} unit={unit} onSet={(v) => onSet({ ...e, a: [e.a[0], v] }, 'Edit line')} />
      <LenField label="End X" mm={e.b[0]} unit={unit} onSet={(v) => onSet({ ...e, b: [v, e.b[1]] }, 'Edit line')} /><LenField label="End Y" mm={e.b[1]} unit={unit} onSet={(v) => onSet({ ...e, b: [e.b[0], v] }, 'Edit line')} />
      <LenField label="Length" mm={len} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, b: polarPt(e.a, v, (ang * Math.PI) / 180) }, 'Line length')} /><LenField label="Angle" kind="deg" mm={ang} unit={unit} onSet={(v) => onSet({ ...e, b: polarPt(e.a, len, (v * Math.PI) / 180) }, 'Line angle')} />
    </div>;
  }
  if (e.k === 'circle') return <div className="st-grid2"><LenField label="Centre X" mm={e.c[0]} unit={unit} onSet={(v) => onSet({ ...e, c: [v, e.c[1]] }, 'Move circle')} /><LenField label="Centre Y" mm={e.c[1]} unit={unit} onSet={(v) => onSet({ ...e, c: [e.c[0], v] }, 'Move circle')} /><LenField label="Diameter" mm={2 * e.r} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, r: v / 2 }, 'Circle diameter')} /><LenField label="Radius" mm={e.r} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, r: v }, 'Circle radius')} /></div>;
  if (e.k === 'arc') return <div className="st-grid2"><LenField label="Centre X" mm={e.c[0]} unit={unit} onSet={(v) => onSet({ ...e, c: [v, e.c[1]] }, 'Move arc')} /><LenField label="Centre Y" mm={e.c[1]} unit={unit} onSet={(v) => onSet({ ...e, c: [e.c[0], v] }, 'Move arc')} /><LenField label="Radius" mm={e.r} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, r: v }, 'Arc radius')} /><LenField label="Start angle" kind="deg" mm={(e.a0 * 180) / Math.PI} unit={unit} onSet={(v) => onSet({ ...e, a0: (v * Math.PI) / 180 }, 'Arc angle')} /><LenField label="End angle" kind="deg" mm={(e.a1 * 180) / Math.PI} unit={unit} onSet={(v) => onSet({ ...e, a1: (v * Math.PI) / 180 }, 'Arc angle')} /><p className="muted small">Arc length {curveLength(e).toFixed(3)} mm</p></div>;
  if (e.k === 'ellipse') return <div className="st-grid2"><LenField label="Centre X" mm={e.c[0]} unit={unit} onSet={(v) => onSet({ ...e, c: [v, e.c[1]] }, 'Edit ellipse')} /><LenField label="Centre Y" mm={e.c[1]} unit={unit} onSet={(v) => onSet({ ...e, c: [e.c[0], v] }, 'Edit ellipse')} /><LenField label="Long half-axis" mm={e.rx} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, rx: v }, 'Edit ellipse')} /><LenField label="Short half-axis" mm={e.ry} unit={unit} min={1e-6} onSet={(v) => onSet({ ...e, ry: v }, 'Edit ellipse')} /><LenField label="Rotation" kind="deg" mm={(e.rot * 180) / Math.PI} unit={unit} onSet={(v) => onSet({ ...e, rot: (v * Math.PI) / 180 }, 'Edit ellipse')} /></div>;
  if (e.k === 'text') return <div><label className="st-field"><span>Text</span><input value={e.s} onChange={(ev: { target: { value: string } }) => onSet({ ...e, s: ev.target.value.slice(0, 500) }, 'Edit text')} /></label><LenField label="Height" mm={e.h} unit={unit} min={0.1} onSet={(v) => onSet({ ...e, h: v }, 'Text height')} /></div>;
  if (e.k === 'dim') { const v = dimValue(doc, e); return <div><p>{e.drive !== undefined ? 'Driving dimension: the drawing follows this value.' : 'Reference dimension: it shows the measured size.'}</p>{v !== null && <LenField label={e.d.kind === 'angle' ? 'Value' : 'Value'} kind={e.d.kind === 'angle' ? 'deg' : 'len'} mm={v} unit={unit} min={1e-6} onSet={(x) => { const d = { ...doc, ents: doc.ents.map((y) => (y.id === e.id ? { ...e, drive: x } : y)) }; const s = solve(d); if (s.ok) onSet(s.doc.ents.find((y) => y.id === e.id)!, 'Driving dimension'); }} />}{e.drive !== undefined && <button onClick={() => onSet({ ...e, drive: undefined }, 'Reference dimension')}>Make it a reference dimension</button>}{'off' in e.d && <LenField label="Offset of the dimension line" mm={e.d.off} unit={unit} onSet={(x) => onSet({ ...e, d: { ...e.d, off: x } as typeof e.d }, 'Move dimension')} />}</div>; }
  if (e.k === 'poly' || e.k === 'spline') {
    const n = e.pts.length;
    return <div><p className="muted small">{n} points{e.k === 'poly' && e.closed ? ', closed' : ''}. Edit up to 40 points here, or drag the handles.</p>
      <label className="chk"><input type="checkbox" checked={e.closed} onChange={(ev: { target: { checked: boolean } }) => onSet({ ...e, closed: ev.target.checked }, ev.target.checked ? 'Close outline' : 'Open outline')} /> Closed</label>
      <div className="st-pts">{e.pts.slice(0, 40).map((q, i) => <div key={i} className="st-grid2"><LenField label={`P${i + 1} X`} mm={q[0]} unit={unit} onSet={(v) => onSet({ ...e, pts: e.pts.map((x, j) => (j === i ? [v, x[1]] as Pt : x)) }, 'Edit point')} /><LenField label="Y" mm={q[1]} unit={unit} onSet={(v) => onSet({ ...e, pts: e.pts.map((x, j) => (j === i ? [x[0], v] as Pt : x)) }, 'Edit point')} /></div>)}</div></div>;
  }
  return null;
}

/* ---------- automatic parameters ---------- */
export function ParamsPanel(p: PanelProps & { onFocus: (ids: string[]) => void }) {
  const { doc, unit } = p;
  const ps = useMemo(() => detectParams(doc), [doc]);
  const [sx, setSx] = useState(1), [sy, setSy] = useState(1), [sz, setSz] = useState(1), [lock, setLock] = useState(true), [keep, setKeep] = useState(true);
  const groups = [...new Set(ps.map((x) => x.group))];
  const apply = (id: string, v: number) => { const r = applyParam(doc, id, v); if (!r.ok) { p.status(r.error, 'err'); return; } p.commit(r.doc, 'Change value'); if (r.note) p.status(r.note, 'info'); };
  return (
    <div>
      {!ps.length && <p className="st-empty">Draw a closed outline, circles or a library component: the important sizes appear here automatically.</p>}
      {groups.map((g) => (
        <Section key={g} title={g}>
          {ps.filter((x) => x.group === g).map((x) => (
            <div key={x.id} onFocus={() => p.onFocus(x.ents)} onBlur={() => p.onFocus([])}>
              <LenField label={x.label} kind={x.unit === 'mm' ? 'len' : x.unit === 'deg' ? 'deg' : x.unit === 'count' ? 'count' : 'factor'} mm={x.value} unit={unit} min={x.min} max={x.max} title={x.hint ?? `From: ${x.origin}`} disabled={p.readOnly} onSet={(v) => apply(x.id, v)} />
            </div>
          ))}
        </Section>
      ))}
      <Section title="Scale X / Y / Z" open={false}>
        <label className="chk"><input type="checkbox" checked={lock} onChange={(e: { target: { checked: boolean } }) => setLock(e.target.checked)} /> Same factor for X, Y and Z (proportional)</label>
        <div className="st-grid2">
          <LenField label="X factor" kind="factor" mm={sx} unit={unit} min={1e-4} max={1e4} onSet={(v) => { setSx(v); if (lock) { setSy(v); setSz(v); } }} />
          <LenField label="Y factor" kind="factor" mm={sy} unit={unit} min={1e-4} max={1e4} onSet={(v) => { setSy(v); if (lock) { setSx(v); setSz(v); } }} />
          <LenField label="Z factor (3D thickness)" kind="factor" mm={sz} unit={unit} min={1e-4} max={1e4} onSet={(v) => { setSz(v); if (lock) { setSx(v); setSy(v); } }} />
        </div>
        <label className="chk"><input type="checkbox" checked={keep} onChange={(e: { target: { checked: boolean } }) => setKeep(e.target.checked)} /> Keep holes round and the same size (they only move)</label>
        <button disabled={p.readOnly} onClick={() => { const r = scaleXY(doc, p.sel.length ? p.sel : null, sx, sy, keep); if (!r.ok) { p.status(r.error, 'err'); return; } const d = { ...r.doc, bodies: r.doc.bodies.map((b: Body) => (b.op === 'revolve' ? b : { ...b, z0: b.z0 * sz, depth: b.depth * sz })) }; p.commit(d, `Scale ${sx} × ${sy} × ${sz}`); if (r.note) p.status(r.note, 'info'); }}>Scale {p.sel.length ? 'the selection' : 'everything'}</button>
      </Section>
    </div>
  );
}

/* ---------- constraints list ---------- */
export function ConstraintsPanel(p: PanelProps) {
  const { doc } = p;
  const s = useMemo(() => solve(doc), [doc]);
  const dims = doc.ents.filter((e) => e.k === 'dim' && e.drive !== undefined);
  return (
    <div>
      <p className={s.ok ? 'ok' : 'err'}>{!doc.constraints.length && !dims.length ? 'No constraints yet. Select items and use "Constraints for the selection" in Properties, or type values for dimensions in Parameters.' : s.ok ? `All constraints met. ${s.dof ? `${s.dof} degree(s) of freedom still free.` : 'Fully fixed.'}` : s.error}</p>
      <ul className="st-list">
        {doc.constraints.map((c) => <li key={c.id} className={s.conflicts.includes(describeConstraint(c)) ? 'bad' : ''}><span onClick={() => p.setSel(JSON.stringify(c).split('"').filter((x) => doc.ents.some((e) => e.id === x)))}>{describeConstraint(c)}</span><button className="link" onClick={() => p.commit({ ...doc, constraints: doc.constraints.filter((x) => x.id !== c.id) }, 'Remove constraint')}>remove</button></li>)}
        {dims.map((d) => <li key={d.id}><span onClick={() => p.setSel([d.id])}>Driving dimension {d.drive}</span><button className="link" onClick={() => p.commit({ ...doc, ents: doc.ents.map((x) => (x.id === d.id ? { ...x, drive: undefined } : x)) }, 'Reference dimension')}>make reference</button></li>)}
      </ul>
    </div>
  );
}

/* ---------- layers ---------- */
export function LayersPanel(p: PanelProps) {
  const { doc } = p;
  const upd = (id: string, ch: Partial<StudioDoc['layers'][number]>, label: string) => p.commit({ ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...ch } : l)) }, label);
  return (
    <div>
      <ul className="st-list layers">
        {doc.layers.map((l) => (
          <li key={l.id}>
            <input type="color" value={l.color} onChange={(e: { target: { value: string } }) => upd(l.id, { color: e.target.value }, 'Layer colour')} aria-label="Layer colour" />
            <input className="st-name" value={l.name} onChange={(e: { target: { value: string } }) => upd(l.id, { name: e.target.value.slice(0, 60) }, 'Rename layer')} aria-label="Layer name" />
            <label className="chk" title="Visible"><input type="checkbox" checked={l.visible} onChange={(e: { target: { checked: boolean } }) => upd(l.id, { visible: e.target.checked }, 'Layer visibility')} />👁</label>
            <label className="chk" title="Locked (cannot be edited)"><input type="checkbox" checked={l.locked} onChange={(e: { target: { checked: boolean } }) => upd(l.id, { locked: e.target.checked }, 'Layer lock')} />🔒</label>
            <small className="muted">{doc.ents.filter((e) => e.layer === l.id).length}</small>
          </li>
        ))}
      </ul>
      <div className="st-btns">
        <button onClick={() => p.commit({ ...doc, layers: [...doc.layers, { id: uid('L'), name: `Layer ${doc.layers.length + 1}`, visible: true, locked: false, color: '#334155' }] }, 'Add layer')}>Add layer</button>
        <button disabled={doc.layers.length < 2} onClick={() => { const last = doc.layers[doc.layers.length - 1]; if (doc.ents.some((e) => e.layer === last.id)) { p.status(`Layer "${last.name}" is not empty. Move or delete its items first.`, 'err'); return; } p.commit({ ...doc, layers: doc.layers.slice(0, -1) }, 'Remove layer'); }}>Remove last empty layer</button>
      </div>
    </div>
  );
}

/* ---------- component library ---------- */
export function LibraryPanel(p: PanelProps) {
  const [q, setQ] = useState(''), [view, setView] = useState<'top' | 'side'>('top'), [body, setBody] = useState(true);
  const list = FAMILIES.filter((f) => !q || `${f.name} ${f.keywords.join(' ')} ${f.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input className="filterbox" placeholder="Search the library (sprocket, plate, shaft...)" value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} />
      <div className="st-row"><label>View <select value={view} onChange={(e: { target: { value: string } }) => setView(e.target.value as 'top')}><option value="top">Top (outline with holes)</option><option value="side">Side profile (turned parts)</option></select></label><label className="chk"><input type="checkbox" checked={body} onChange={(e: { target: { checked: boolean } }) => setBody(e.target.checked)} /> Add its 3D body</label></div>
      <ul className="st-list lib">{list.map((f) => <li key={f.id}><span title={f.description}>{f.name}</span><button disabled={p.readOnly} onClick={() => { const r = insertLibrary(p.doc, f.id, {}, 'beside', view, body); if (r.error) p.status(r.error, 'err'); else { p.commit(r.doc, `Insert ${f.name}`); p.status(`${f.name} inserted. Its values (teeth, pitch, bore...) are in Parameters.`, 'ok'); } }}>Insert</button></li>)}</ul>
      {!!p.doc.features.length && <Section title="Features in this design"><ul className="st-list">{p.doc.features.map((f) => <li key={f.id}><span onClick={() => p.setSel(p.doc.ents.filter((e) => e.feature === f.id).map((e) => e.id))}>{featureLabel(f)}</span></li>)}</ul></Section>}
    </div>
  );
}

/* ---------- 3D bodies ---------- */
export function BodiesPanel(p: PanelProps & { built: Built }) {
  const { doc, sel, unit, built } = p;
  const loops = useMemo(() => findLoops(doc).loops, [doc]);
  const selLoop = loops.find((l) => l.ids.some((x) => sel.includes(x)));
  const selLoops = loops.filter((l) => l.ids.some((x) => sel.includes(x)));
  const axisLine = doc.ents.find((e) => e.style === 'centre' && e.k === 'line' && (sel.includes(e.id) || true));
  const mk = (op: Body['op']): Body | null => {
    if (!selLoop) { p.status('Select a closed outline first (Select tool).', 'err'); return null; }
    const base: Body = { id: uid('b'), name: `Body ${doc.bodies.length + 1}`, op, profile: selLoop.ids[0], z0: 0, depth: 10, mode: doc.bodies.length ? 'add' : 'new', material: doc.material, color: '#8d96a0', visible: true };
    if (op === 'revolve') { const ax = axisLine && axisLine.k === 'line' ? axisLine : null; const horiz = ax ? Math.abs(ax.a[1] - ax.b[1]) < Math.abs(ax.a[0] - ax.b[0]) : false; return { ...base, axis: ax ? (horiz ? 'x' : 'y') : 'y', axisAt: ax ? (horiz ? ax.a[1] : ax.a[0]) : 0, angle: 360 }; }
    if (op === 'loft') { if (selLoops.length < 2) { p.status('A loft needs two closed outlines: select the bottom one and then the top one (Shift-click).', 'err'); return null; } return { ...base, profile: selLoops[0].ids[0], profile2: selLoops[1].ids[0], depth: 20 }; }
    return base;
  };
  const addB = (op: Body['op']) => { const b = mk(op); if (b) p.commit({ ...doc, bodies: [...doc.bodies, b] }, `${op === 'extrude' ? 'Extrude' : op === 'revolve' ? 'Revolve' : 'Loft'}`); };
  const upd = (id: string, ch: Partial<Body>, label: string) => p.commit({ ...doc, bodies: doc.bodies.map((b) => (b.id === id ? { ...b, ...ch } : b)) }, label);
  return (
    <div>
      <div className="st-btns">
        <button className="primary" disabled={p.readOnly} onClick={() => addB('extrude')} title="Push the selected outline up into a solid; holes inside it go through">Extrude</button>
        <button disabled={p.readOnly} onClick={() => addB('revolve')} title="Turn the selected outline around the centre line (draw one with the Centre-line tool)">Revolve</button>
        <button disabled={p.readOnly} onClick={() => addB('loft')} title="Blend between two outlines (select two)">Loft</button>
      </div>
      <p className="muted small">{selLoop ? 'A closed outline is selected.' : 'Select a closed outline in the drawing, then press Extrude / Revolve.'} Mass from the model: <b>{built.mass.toFixed(4)} kg</b> (volume {(built.volume / 1000).toFixed(3)} cm³).</p>
      {doc.bodies.map((b, i) => {
        const r = built.reports.find((x) => x.id === b.id);
        return (
          <Section key={b.id} title={`${i + 1}. ${b.name} (${b.op}, ${b.mode})`} right={r && !r.ok ? <em className="err"> ⚠</em> : null}>
            {r?.error && r.error !== 'Hidden.' && <p className="err small">{r.error}</p>}
            {r && [...r.approx, ...r.exactOnly.map((x) => `${x}: exact model / STEP only`)].map((x, k) => <p key={k} className="muted small">• {x}</p>)}
            <div className="st-grid2">
              <label className="st-field"><span>Name</span><input value={b.name} onChange={(e: { target: { value: string } }) => upd(b.id, { name: e.target.value.slice(0, 60) }, 'Rename body')} /></label>
              <label className="st-field"><span>Combine</span><select value={b.mode} onChange={(e: { target: { value: string } }) => upd(b.id, { mode: e.target.value as Body['mode'] }, 'Body mode')}><option value="new">New body</option><option value="add">Add (union)</option><option value="cut">Cut (subtract, pocket, hole)</option><option value="intersect">Intersect (exact model)</option></select></label>
              {b.op !== 'revolve' && <><LenField label={b.op === 'loft' ? 'Height' : b.mode === 'cut' ? 'Cut depth' : 'Thickness / depth'} mm={b.depth} unit={unit} min={0.001} onSet={(v) => upd(b.id, { depth: v }, 'Body depth')} /><LenField label="Start height Z" mm={b.z0} unit={unit} onSet={(v) => upd(b.id, { z0: v }, 'Body Z')} /></>}
              {b.op === 'revolve' && <><label className="st-field"><span>Axis</span><select value={b.axis ?? 'y'} onChange={(e: { target: { value: string } }) => upd(b.id, { axis: e.target.value as 'x' | 'y' }, 'Revolve axis')}><option value="y">Vertical line X = …</option><option value="x">Horizontal line Y = …</option></select></label><LenField label="Axis position" mm={b.axisAt ?? 0} unit={unit} onSet={(v) => upd(b.id, { axisAt: v }, 'Revolve axis')} /><LenField label="Angle" kind="deg" mm={b.angle ?? 360} unit={unit} min={1} max={360} onSet={(v) => upd(b.id, { angle: v }, 'Revolve angle')} /></>}
              <LenField label="Edge fillet R (exact)" mm={b.fillet ?? 0} unit={unit} min={0} onSet={(v) => upd(b.id, { fillet: v || undefined }, 'Fillet')} />
              <LenField label="Edge chamfer (exact)" mm={b.chamfer ?? 0} unit={unit} min={0} onSet={(v) => upd(b.id, { chamfer: v || undefined }, 'Chamfer')} />
              {b.op !== 'revolve' && <LenField label="Shell wall (exact, open top)" mm={b.shell ?? 0} unit={unit} min={0} onSet={(v) => upd(b.id, { shell: v || undefined }, 'Shell')} />}
              <label className="st-field"><span>Pattern</span><select value={b.pattern?.kind ?? 'none'} onChange={(e: { target: { value: string } }) => upd(b.id, { pattern: e.target.value === 'none' ? undefined : e.target.value === 'circular' ? { kind: 'circular', n: 4 } : { kind: 'linear', n: 3, dx: 50, dy: 0 } }, 'Pattern')}><option value="none">None</option><option value="circular">Around the Z axis (origin)</option><option value="linear">In a row</option></select></label>
              {b.pattern && <LenField label="Copies" kind="count" mm={b.pattern.n} unit={unit} min={1} max={500} onSet={(v) => upd(b.id, { pattern: { ...b.pattern!, n: v } }, 'Pattern copies')} />}
              {b.pattern?.kind === 'linear' && <><LenField label="Step X" mm={b.pattern.dx} unit={unit} onSet={(v) => upd(b.id, { pattern: { ...(b.pattern as { kind: 'linear'; n: number; dx: number; dy: number }), dx: v } }, 'Pattern step')} /><LenField label="Step Y" mm={b.pattern.dy} unit={unit} onSet={(v) => upd(b.id, { pattern: { ...(b.pattern as { kind: 'linear'; n: number; dx: number; dy: number }), dy: v } }, 'Pattern step')} /></>}
              <label className="st-field"><span>Material</span><select value={b.material} onChange={(e: { target: { value: string } }) => upd(b.id, { material: e.target.value }, 'Material')}>{MATERIALS.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>
              <label className="st-field"><span>Colour</span><input type="color" value={b.color} onChange={(e: { target: { value: string } }) => upd(b.id, { color: e.target.value }, 'Colour')} /></label>
            </div>
            <div className="st-btns">
              <label className="chk"><input type="checkbox" checked={b.visible} onChange={(e: { target: { checked: boolean } }) => upd(b.id, { visible: e.target.checked }, 'Show body')} /> Visible</label>
              <button onClick={() => p.setSel([b.profile, ...(b.profile2 ? [b.profile2] : [])])}>Show profile</button>
              <button disabled={i === 0} onClick={() => { const a = doc.bodies.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; p.commit({ ...doc, bodies: a }, 'Reorder bodies'); }}>Up</button>
              <button className="danger" onClick={() => p.commit({ ...doc, bodies: doc.bodies.filter((x) => x.id !== b.id) }, 'Delete body')}>Delete</button>
            </div>
          </Section>
        );
      })}
    </div>
  );
}

/* ---------- checks ---------- */
export function ChecksPanel({ checks, setSel }: { checks: Check[]; setSel: (s: string[]) => void }) {
  const n = (l: Check['level']) => checks.filter((c) => c.level === l).length;
  return (
    <div>
      <p className="muted small">{n('error')} error(s), {n('warning')} warning(s). Click a line to select the items it is about.</p>
      <ul className="st-checks">{checks.map((c, i) => <li key={i} className={c.level} onClick={() => c.ents && setSel(c.ents)}>{c.level === 'error' ? '✖' : c.level === 'warning' ? '⚠' : c.level === 'ok' ? '✔' : 'ℹ'} {c.text}</li>)}</ul>
    </div>
  );
}

/* ---------- history and versions ---------- */
export function HistoryPanel({ hist, doc, onUndoTo, onSaveVersion, onRestore, onDuplicate }: { hist: History; doc: StudioDoc; onUndoTo: (n: number) => void; onSaveVersion: (label: string) => void; onRestore: (id: string) => void; onDuplicate: () => void }) {
  const [label, setLabel] = useState('');
  return (
    <div>
      <Section title={`Undo history (${hist.past.length})`}>
        <ol className="st-list hist">{hist.past.slice(-40).map((h, i, a) => <li key={i}><span>{h.label}</span><button className="link" onClick={() => onUndoTo(a.length - i)} title="Undo back to before this step">undo to here</button></li>)}{!hist.past.length && <li className="muted">No steps yet.</li>}</ol>
      </Section>
      <Section title={`Versions (${doc.versions.length})`}>
        <div className="st-row"><input placeholder="Version name (optional)" value={label} onChange={(e: { target: { value: string } }) => setLabel(e.target.value)} /><button onClick={() => { onSaveVersion(label); setLabel(''); }}>Save version</button></div>
        <ul className="st-list">{doc.versions.slice().reverse().map((v) => <li key={v.id}><span title={`${v.at} by ${v.by}`}>{v.label} <small className="muted">{new Date(v.at).toLocaleString()}</small></span><button className="link" onClick={() => onRestore(v.id)}>restore</button></li>)}</ul>
        <p className="muted small">Restoring keeps the current state in the undo history, so you can go back. Up to 30 versions are kept inside the design.</p>
      </Section>
      <Section title="Design record" open={false}>
        <table className="tbl"><tbody>
          <tr><td>Design ID</td><td><code>{doc.id}</code></td></tr><tr><td>Version</td><td>{doc.version} (revision {doc.revision})</td></tr>
          <tr><td>Created</td><td>{new Date(doc.createdAt).toLocaleString()} by {doc.createdBy || 'unknown'}</td></tr><tr><td>Modified</td><td>{new Date(doc.updatedAt).toLocaleString()}</td></tr>
          <tr><td>Items</td><td>{doc.ents.length} drawing items, {doc.bodies.length} 3D bodies, {doc.features.length} features</td></tr>
          <tr><td>Original uploads</td><td>{doc.refs.length ? doc.refs.map((r) => r.name).join(', ') : 'none'}</td></tr>
          <tr><td>AI requests</td><td>{doc.ai.length} ({doc.ai.reduce((s, a) => s + a.applied.length, 0)} changes accepted, {doc.ai.reduce((s, a) => s + a.rejected.length, 0)} rejected)</td></tr>
        </tbody></table>
        <button onClick={onDuplicate}>Duplicate this design</button>
      </Section>
    </div>
  );
}
