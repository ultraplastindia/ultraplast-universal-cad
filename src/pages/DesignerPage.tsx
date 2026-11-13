import { useEffect, useMemo, useRef, useState } from 'react';
import { getFamily } from '../families/index.ts';
import type { Params } from '../core/types.ts';
import { buildDesign } from '../lib/design.ts';
import { validateDesign } from '../lib/validation.ts';
import { useAuth } from '../cloud/client.ts';
import { pushRecent } from '../lib/search.ts';
import { ParamForm } from '../ui/ParamForm.tsx';
import { DrawingWorkspace } from '../ui/DrawingWorkspace.tsx';
import { Viewer3D } from '../ui/Viewer3D.tsx';
import { KINDS, buildPackage, download, makeArtifact, sourceFromDesign } from '../exporters/index.ts';
import { geoToParts } from '../core/prims3d.ts';
import type { Kind } from '../exporters/index.ts';
import { getProject, saveProject } from '../storage/db.ts';
import { newId } from '../storage/project.ts';
import { go } from '../ui/router.ts';
import { VariantPicker } from '../ui/VariantPicker.tsx';
import { toast } from '../ui/Toast.tsx';

type Tab = '2d' | '3d' | 'calc' | 'export';

export function DesignerPage({ familyId, query }: { familyId: string | undefined; query: URLSearchParams }) {
  const family = familyId ? getFamily(familyId) : undefined;
  const [params, setParams] = useState<Params>(family?.defaults ?? {});
  const [rev, setRev] = useState('A');
  const [tab, setTab] = useState<Tab>('2d');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const readOnly = auth.user?.role === 'viewer';
  const baseSig = useRef(JSON.stringify({ params: family?.defaults ?? {}, rev: 'A' })); // what is already saved (or the defaults): autosave only keeps real changes
  const [mode, setMode] = useState<'quick' | 'adv'>(() => { try { return localStorage.getItem('ultraplast.mode') === 'adv' ? 'adv' : 'quick'; } catch { return 'quick'; } });
  const chooseMode = (m: 'quick' | 'adv') => { setMode(m); try { localStorage.setItem('ultraplast.mode', m); } catch { /* storage unavailable */ } };

  useEffect(() => {
    if (!family) return;
    pushRecent(family.id);
    const pid = query.get('project'), vid = query.get('variant');
    if (pid) getProject(pid).then((p) => { if (p && p.familyId === family.id) { baseSig.current = JSON.stringify({ params: p.params, rev: p.revision }); setParams(p.params); setRev(p.revision); setProjectId(p.id); setName(p.name); } else setMsg('Saved design not found.'); }).catch(() => setMsg('Could not read local storage.'));
    else if (query.get('preset')) {
      // starting values handed over by the Component types page
      try { const d = JSON.parse(sessionStorage.getItem('ultraplast.preset') ?? 'null'); if (d && d.familyId === family.id && d.params) { setParams({ ...family.defaults, ...d.params }); if (d.name) setName(String(d.name).slice(0, 120)); } } catch { /* no preset available */ }
    }
    else if (vid) { const v = family.variants.find((x) => x.id === vid); if (v) setParams({ ...v.params }); }
  }, [family, query]);

  const design = useMemo(() => (family ? buildDesign(family, params, rev) : null), [family, params, rev]);
  const parts = useMemo(() => (design?.geo ? geoToParts(design.geo) : null), [design]);
  useEffect(() => () => { parts?.forEach((p) => p.geometry.dispose()); }, [parts]);
  const validation = useMemo(() => (design ? validateDesign(design) : null), [design]);

  // Autosave: the work in progress is kept in this browser every second, so a crash, a closed tab or a lost connection does not lose it.
  const draftKey = family ? `ultraplast.draft.${family.id}` : '';
  const [draft, setDraft] = useState<{ params: Params; rev: string; name: string; projectId: string | null; at: string } | null>(null);
  const fresh = !query.get('project') && !query.get('variant') && !query.get('preset');
  useEffect(() => {
    setDraft(null);
    if (!draftKey || !fresh) return;
    try { const d = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); if (d && typeof d === 'object' && d.params && typeof d.params === 'object' && JSON.stringify(d.params) !== JSON.stringify(family?.defaults)) setDraft(d); } catch { /* damaged draft is ignored */ }
  }, [draftKey, fresh, family]);
  useEffect(() => {
    if (!draftKey || draft) return; // do not overwrite a draft that is waiting for the person's decision
    const t = setTimeout(() => { try { if (JSON.stringify({ params, rev }) === baseSig.current) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, JSON.stringify({ params, rev, name, projectId, at: new Date().toISOString() })); } catch { /* storage full or blocked: autosave is skipped */ } }, 1000);
    return () => clearTimeout(t);
  }, [draftKey, params, rev, name, projectId, draft, family]);
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } };

  if (!family || !design) {
    return <div className="page"><h1>Designer</h1><p>Select a component first. <a href="#/components">Browse components</a></p></div>;
  }
  const { calc } = design;
  const quick = mode === 'quick' && family.basic.length > 0;
  const shown = quick ? family.fields.filter((f) => family.basic.includes(f.key)) : family.fields;
  const derivedFields = family.fields.filter((f) => !family.basic.includes(f.key) && (!f.showIf || f.showIf(params)));
  /** Applies an edit; in Quick mode a change to a key value re-derives everything else. */
  const change = (next: Params) => {
    if (!quick || !family.autofill) { setParams(next); return; }
    const key = Object.keys(next).find((k) => next[k] !== params[k]);
    setParams(key && family.basic.includes(key) ? family.autofill(next, key) : next);
  };
  const show = (f: (typeof family.fields)[number]) => { const v = params[f.key]; if (f.kind === 'boolean') return v ? 'Yes' : 'No'; if (f.kind === 'select') return f.options?.find((o) => o.value === v)?.label ?? String(v); return `${typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(3) : '-'}${f.unit ? ' ' + f.unit : ''}`; };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true); setMsg(`${label}...`);
    try { await fn(); setMsg(`${label}: done.`); toast(`${label}: done.`, 'ok'); } catch (e) { const m = `${label} failed: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); if (!(e instanceof Error && e.message === 'cancelled')) toast(m, 'err'); } finally { setBusy(false); }
  };
  const exportOne = (k: Kind) => run(`Export ${k}`, async () => { setMsg(k === 'step' ? 'Loading CAD kernel for STEP (first use downloads ~10 MB)...' : `Generating ${k}...`); download(await makeArtifact(k, sourceFromDesign(design, family.id, name || design.partNo))); });
  const save = () => run('Save', async () => {
    const title = name || window.prompt('Name for this design:', design.partNo);
    if (!title) throw new Error('cancelled');
    const now = new Date().toISOString(), id = projectId ?? newId();
    await saveProject({ id, name: title, familyId: family.id, params, revision: rev, createdAt: now, updatedAt: now });
    setProjectId(id); setName(title); baseSig.current = JSON.stringify({ params, rev }); clearDraft();
  });

  return (
    <div className="designer">
      <aside className="panel">
        <h2>{family.name} <span className="badge">PRELIMINARY</span></h2>
        {draft && (
          <div className="box info"><b>Unsaved work found</b> from {new Date(draft.at).toLocaleString()}. <div className="actions"><button className="primary" onClick={() => { setParams({ ...family.defaults, ...draft.params }); setRev(draft.rev || 'A'); setName(draft.name || ''); setProjectId(draft.projectId ?? null); setDraft(null); }}>Restore it</button><button onClick={() => { clearDraft(); setDraft(null); }}>Discard</button></div></div>
        )}
        <div className="modebar" role="group" aria-label="Input mode">
          <button className={quick ? 'on' : ''} onClick={() => chooseMode('quick')} disabled={family.basic.length === 0}>Quick: key values only</button>
          <button className={!quick ? 'on' : ''} onClick={() => chooseMode('adv')}>Advanced: all parameters</button>
        </div>
        <VariantPicker variants={family.variants} onPick={(id) => { const v = family.variants.find((x) => x.id === id); if (v) setParams({ ...v.params }); }} />
        <ParamForm fields={shown} params={params} onChange={change} />
        {quick && derivedFields.length > 0 && (
          <details className="derived"><summary>Derived automatically ({derivedFields.length})</summary>
            <table className="tbl">{<tbody>{derivedFields.map((f) => <tr key={f.key}><td>{f.label}</td><td className="num">{show(f)}</td></tr>)}</tbody>}</table>
            <p className="muted">These follow from your key values. Switch to Advanced to set any of them yourself.</p>
          </details>
        )}
        {!quick && family.autofill && <button onClick={() => setParams(family.autofill!(params, 'auto'))}>Re-derive values from the key inputs</button>}
        <label className="field"><span>Drawing revision</span><input value={rev} maxLength={3} onChange={(e) => setRev(e.target.value.toUpperCase())} /></label>
        <div className="actions"><button className="primary" onClick={save} disabled={busy || readOnly} title={readOnly ? 'Your role is read-only (viewer)' : undefined}>{projectId ? 'Save changes' : 'Save design'}</button><button onClick={() => { setParams({ ...family.defaults }); }}>Reset</button></div>
        <div className="actions"><button disabled={!calc.ok} onClick={() => { sessionStorage.setItem('ultraplast.asm.add', JSON.stringify({ familyId: family.id, params })); go('assembly'); }}>Add to assembly</button></div>
        {calc.errors.length > 0 && <div className="box err"><b>Cannot generate geometry:</b><ul>{calc.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        {calc.ok && calc.warnings.length > 0 && <div className="box warn"><b>Engineering warnings</b><ul>{calc.warnings.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        {msg && <p className="muted">{msg}</p>}
      </aside>
      <section className="work">
        <nav className="tabs">{([['2d', '2D drawing'], ['3d', '3D model'], ['calc', 'Calculations & specification'], ['export', 'Downloads']] as [Tab, string][]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        {!calc.ok && <div className="box err big"><b>Design is incomplete or incompatible.</b> Fix the highlighted inputs to generate the drawing and model.</div>}
        {calc.ok && tab === '2d' && design.sheet && <DrawingWorkspace sheet={design.sheet} onEdit={(k, v) => setParams((p) => ({ ...p, [k]: v }))} />}
        {calc.ok && tab === '3d' && parts && <Viewer3D key={family.id} parts={parts} />}
        {tab === 'calc' && (
          <div className="calc">
            <h3>Inputs</h3><Table rows={calc.inputs} />
            <h3>Calculated values</h3>{calc.calculated.length ? <Table rows={calc.calculated} /> : <p className="muted">Not available until inputs are valid.</p>}
            <h3>Assumptions</h3><ul>{calc.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <h3>Applicable standards</h3><ul>{calc.standards.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        )}
        {tab === 'export' && (
          <div className="calc">
            {validation && (
              <div className={`box ${validation.status === 'fail' ? 'err' : validation.status === 'warn' ? 'warn' : 'info'}`}>
                <b>Validation: {validation.summary}</b>
                <ul className="vlist">{validation.checks.map((c, i) => <li key={i} className={`v-${c.level}`}><span aria-hidden="true">{c.level === 'ok' ? '✔' : c.level === 'error' ? '✖' : c.level === 'warn' ? '⚠' : 'ℹ'}</span> {c.text}</li>)}</ul>
              </div>
            )}
            <p className="muted">Every file below is generated from the current parameters. If a format cannot be produced, the error is shown rather than a placeholder being downloaded.</p>
            {(['2D', '3D', 'Documents'] as const).map((g) => (
              <div key={g}><h3>{g === 'Documents' ? 'Reports and data' : `${g} files`}</h3><div className="actions wrap">{KINDS.filter((k) => k.group === g).map((k) => <button key={k.kind} disabled={busy || !calc.ok} onClick={() => exportOne(k.kind)}>{k.label}</button>)}</div></div>
            ))}
            <h3>Complete design package</h3>
            <button className="primary" disabled={busy || !calc.ok} onClick={() => run('Package', async () => { download(await buildPackage(sourceFromDesign(design, family.id, name || design.partNo), setMsg)); })}>Download ZIP package</button>
            <p className="muted">STEP is built with an OpenCascade kernel in your browser. It needs a modern browser and loads a ~10 MB file the first time.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Table({ rows }: { rows: { label: string; value: string; unit?: string }[] }) {
  return <table className="tbl"><tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.value}</td><td>{r.unit ?? ''}</td></tr>)}</tbody></table>;
}
