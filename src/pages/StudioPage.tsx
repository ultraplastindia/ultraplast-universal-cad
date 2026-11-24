import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Pt } from '../core/types.ts';
import type { Part3D } from '../core/family.ts';
import type { Ent, StudioDoc, Unit } from '../studio/model.ts';
import { newDoc, serializeDoc, STUDIO_FAMILY, uid } from '../studio/model.ts';
import { transformEnt, translateAff } from '../studio/geom.ts';
import { buildBodies } from '../studio/solid.ts';
import { studioSheet } from '../studio/views.ts';
import { checkStudio } from '../studio/validate.ts';
import { studioDxf } from '../studio/dxf.ts';
import { calibrate } from '../studio/refs.ts';
import type { Comparison } from '../studio/compare.ts';
import { studioSource } from '../studio/export.ts';
import { addVersion, duplicateDoc, emptyHistory, pushHistory, redo, restoreVersion, undo } from '../studio/history.ts';
import type { History } from '../studio/history.ts';
import { autosave, clearAutosave, loadStudio, readAutosave, saveStudio, whoAmI } from '../studio/store.ts';
import { DEFAULT_OPTS, DEFAULT_SNAPS, StudioCanvas, TOOL_HELP } from '../studio/ui/Canvas.tsx';
import type { Snaps, Tool, ToolOpts } from '../studio/ui/Canvas.tsx';
import { BodiesPanel, ChecksPanel, ConstraintsPanel, HistoryPanel, LayersPanel, LibraryPanel, ParamsPanel, PropertiesPanel } from '../studio/ui/Panels.tsx';
import { AssistantPanel, ImportPanel } from '../studio/ui/AiPanel.tsx';
import { Studio3D } from '../studio/ui/Studio3D.tsx';
import { LenField } from '../studio/ui/Fields.tsx';
import type { KeyEv, PtrEv } from '../studio/ui/Fields.tsx';
import { DrawingWorkspace } from '../ui/DrawingWorkspace.tsx';
import { buildPackage, download, KINDS, makeArtifact } from '../exporters/index.ts';
import type { Kind } from '../exporters/index.ts';
import { listProjects } from '../storage/db.ts';
import { MATERIALS } from '../data/materials.ts';
import { useAuth } from '../cloud/client.ts';
import { go } from '../ui/router.ts';
import { toast } from '../ui/Toast.tsx';

const TOOLS: { t: Tool; label: string; key?: string; group: string }[] = [
  { t: 'select', label: 'Select', key: 's', group: 'Basic' }, { t: 'pan', label: 'Pan', key: 'h', group: 'Basic' }, { t: 'measure', label: 'Measure', group: 'Basic' },
  { t: 'line', label: 'Line', key: 'l', group: 'Draw' }, { t: 'polyline', label: 'Polyline', key: 'p', group: 'Draw' }, { t: 'rect', label: 'Rectangle', key: 'r', group: 'Draw' },
  { t: 'circle', label: 'Circle', key: 'c', group: 'Draw' }, { t: 'arc', label: 'Arc (3 pt)', key: 'a', group: 'Draw' }, { t: 'ellipse', label: 'Ellipse', group: 'Draw' },
  { t: 'polygon', label: 'Polygon', group: 'Draw' }, { t: 'spline', label: 'Spline', group: 'Draw' }, { t: 'freehand', label: 'Freehand', key: 'k', group: 'Draw' },
  { t: 'centreline', label: 'Centre line', group: 'Draw' }, { t: 'construction', label: 'Construction', group: 'Draw' }, { t: 'text', label: 'Text / note', group: 'Draw' },
  { t: 'holes', label: 'Hole pattern', group: 'Features' }, { t: 'slot', label: 'Slot', group: 'Features' },
  { t: 'dim', label: 'Dimension', key: 'd', group: 'Annotate' },
  { t: 'move', label: 'Move', key: 'm', group: 'Modify' }, { t: 'copy', label: 'Copy', group: 'Modify' }, { t: 'rotate', label: 'Rotate', group: 'Modify' }, { t: 'mirror', label: 'Mirror', group: 'Modify' },
  { t: 'offset', label: 'Offset', key: 'o', group: 'Modify' }, { t: 'trim', label: 'Trim', key: 't', group: 'Modify' }, { t: 'extend', label: 'Extend', key: 'e', group: 'Modify' },
  { t: 'fillet', label: 'Fillet', group: 'Modify' }, { t: 'chamfer', label: 'Chamfer', group: 'Modify' },
];
type Right = 'props' | 'params' | 'cons' | '3d' | 'ai' | 'import' | 'checks';
type Left = 'tools' | 'library' | 'layers' | 'history';
type View = '2d' | '3d' | 'split' | 'sheet';
const LS = 'ultraplast.studio.ui';

export function StudioPage({ query }: { query: URLSearchParams }) {
  const auth = useAuth();
  const readOnly = auth.user?.role === 'viewer';
  const [doc, setDoc] = useState<StudioDoc>(() => newDoc('New design', whoAmI()));
  const [hist, setHist] = useState<History>(emptyHistory);
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [opts, setOpts] = useState<ToolOpts>(DEFAULT_OPTS);
  const [snaps, setSnaps] = useState<Snaps>(DEFAULT_SNAPS);
  const ui0 = (() => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}') as { lw?: number; rw?: number }; } catch { return {}; } })();
  const [lw, setLw] = useState(ui0.lw ?? 250), [rw, setRw] = useState(ui0.rw ?? 340);
  const [right, setRight] = useState<Right>('params');
  const [left, setLeft] = useState<Left>('tools');
  const [view, setView] = useState<View>('2d');
  const [msg, setMsg] = useState<{ m: string; k: 'ok' | 'err' | 'info' }>({ m: 'Ready. Pick a tool on the left, or import a drawing (Import tab on the right).', k: 'info' });
  const [preview, setPreview] = useState<StudioDoc | null>(null);
  const [compare, setCompare] = useState<{ c: Comparison | null; ref: string | null }>({ c: null, ref: null });
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [fit, setFit] = useState(0);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [calib, setCalib] = useState<{ p1: Pt; p2: Pt; mm: string } | null>(null);
  const [pendingDetected, setPendingDetected] = useState<string | null>(null);
  const [savedSig, setSavedSig] = useState('');
  const [restore, setRestore] = useState<{ at: string; doc: StudioDoc } | null>(null);
  const [openList, setOpenList] = useState<{ id: string; name: string; updatedAt: string }[] | null>(null);
  const [busy, setBusy] = useState('');
  const [exactParts, setExactParts] = useState<Part3D[] | null>(null);
  const clip = useRef<Ent[]>([]);
  const unit: Unit = doc.unit;

  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify({ lw, rw })); } catch { /* storage blocked */ } }, [lw, rw]);
  // the studio fills the window below the site header (whose height changes with the screen width)
  const [hdr, setHdr] = useState(70);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = rootRef.current; if (!el) return; el.style.setProperty('--lw', `${lw}px`); el.style.setProperty('--rw', `${rw}px`); el.style.setProperty('--hdr', `${hdr}px`); }, [lw, rw, hdr]);
  useEffect(() => { const h = document.querySelector('header.top') as HTMLElement | null; if (!h) return; const f = () => setHdr(h.offsetHeight); f(); const ro = new ResizeObserver(f); ro.observe(h); return () => ro.disconnect(); }, []);
  const status = useCallback((m: string, k: 'ok' | 'err' | 'info' = 'info') => { setMsg({ m, k }); if (k === 'err') toast(m, 'err'); }, []);
  const docRef = useRef(doc); docRef.current = doc;
  const commit = useCallback((next: StudioDoc, label: string) => {
    const prev = docRef.current; if (prev === next) return;
    setHist((h) => pushHistory(h, prev, label));
    const d = { ...next, updatedAt: new Date().toISOString() }; docRef.current = d; setDoc(d);
    setMsg({ m: `${label}.`, k: 'ok' });
  }, []);

  // open a saved design, or offer the autosaved one
  const id = query.get('id');
  useEffect(() => {
    let live = true;
    (async () => {
      if (id && id === docRef.current.id) return; // just saved: the design is already open
      if (id) {
        setBusy('Opening the design...');
        try { const d = await loadStudio(id); if (!live) return; if (d) { setDoc(d); setHist(emptyHistory()); setSavedSig(serializeDoc(d)); setFit((f) => f + 1); status(`Opened "${d.name}" (version ${d.version}).`, 'ok'); } else status('That design was not found.', 'err'); } catch (e) { status(e instanceof Error ? e.message : 'Could not open the design.', 'err'); }
        setBusy('');
      } else { const a = await readAutosave(); if (live && a && a.doc.ents.length) setRestore(a); }
    })();
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // autosave (this browser), a second after the last change
  useEffect(() => { if (!doc.ents.length && !doc.refs.length) return; const t = setTimeout(() => void autosave(doc), 1200); return () => clearTimeout(t); }, [doc]);
  const dirty = serializeDoc(doc) !== savedSig && (doc.ents.length > 0 || doc.refs.length > 0);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const built = useMemo(() => buildBodies(doc), [doc]);
  const deferred = useDeferredValue(doc);
  const checks = useMemo(() => { try { return checkStudio(deferred, buildBodies(deferred)); } catch (e) { return [{ level: 'error' as const, text: `Checks could not run: ${e instanceof Error ? e.message : String(e)}` }]; } }, [deferred]);
  const errs = checks.filter((c) => c.level === 'error').length, warns = checks.filter((c) => c.level === 'warning').length;
  const sheet = useMemo(() => (view === 'sheet' ? studioSheet(doc, built) : null), [view, doc, built]);

  const doUndo = () => { const r = undo(hist, doc); if (!r) return; setHist(r.h); setDoc(r.doc); setPreview(null); status(`Undo: ${r.label}`, 'info'); };
  const doRedo = () => { const r = redo(hist, doc); if (!r) return; setHist(r.h); setDoc(r.doc); status(`Redo: ${r.label}`, 'info'); };
  const deleteSel = () => {
    if (!sel.length) return;
    const ids = new Set(sel), feats = new Set(doc.ents.filter((e) => ids.has(e.id) && e.feature).map((e) => e.feature!));
    const gone = new Set([...ids, ...doc.ents.filter((e) => e.feature && feats.has(e.feature)).map((e) => e.id)]);
    commit({ ...doc, ents: doc.ents.filter((e) => !gone.has(e.id) && !(e.k === 'dim' && JSON.stringify(e.d).split('"').some((s) => gone.has(s)))), constraints: doc.constraints.filter((c) => !JSON.stringify(c).split('"').some((s) => gone.has(s))), features: doc.features.filter((f) => !feats.has(f.id)), bodies: doc.bodies.filter((b) => !gone.has(b.profile)) }, `Delete ${gone.size} item(s)`);
    setSel([]);
  };
  const paste = (dx: number) => {
    if (!clip.current.length) return;
    const m = translateAff(dx, -dx);
    const c = clip.current.filter((e) => e.k !== 'dim').map((e) => ({ ...transformEnt(e, m), id: uid(), feature: undefined, source: e.source === 'feature' || e.source === 'library' ? ('drawn' as const) : e.source }));
    commit({ ...doc, ents: [...doc.ents, ...c] }, `Paste ${c.length} item(s)`); setSel(c.map((e) => e.id));
  };
  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
      if (c && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if (c && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
      if (c && k === 'c') { clip.current = doc.ents.filter((x) => sel.includes(x.id)); status(`${clip.current.length} item(s) copied.`, 'info'); return; }
      if (c && k === 'v') { e.preventDefault(); paste(10); return; }
      if (c && k === 'd') { e.preventDefault(); clip.current = doc.ents.filter((x) => sel.includes(x.id)); paste(10); return; }
      if (c && k === 's') { e.preventDefault(); void save(); return; }
      if (c && k === 'a') { e.preventDefault(); setSel(doc.ents.map((x) => x.id)); return; }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); return; }
      if (k === 'escape') { setTool('select'); setPreview(null); return; }
      if (k === 'f' && !c) { setFit((f) => f + 1); return; }
      if (!c && !e.altKey) { const tt = TOOLS.find((x) => x.key === k); if (tt) setTool(tt.t); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const save = async (asVersion?: string) => {
    if (readOnly) { status('Your role is read-only (viewer). Ask the administrator for more access.', 'err'); return; }
    setBusy('Saving...');
    try {
      let d = { ...doc, version: savedSig ? doc.version + 1 : doc.version, createdBy: doc.createdBy || whoAmI() };
      if (asVersion !== undefined) d = addVersion(d, asVersion || `Version ${d.version}`, whoAmI());
      const r = await saveStudio(d);
      if (r.uploaded.length) d = { ...d, refs: d.refs.map((x) => { const u = r.uploaded.find((q) => q.id === x.id); return u ? { ...x, uploadId: u.uploadId } : x; }) };
      setDoc(d); setSavedSig(serializeDoc(d)); void clearAutosave();
      status(`Saved "${d.name}", version ${d.version}${auth.user ? ' in your cloud account' : ' in this browser'}.${r.note ? ` ${r.note}` : ''}`, 'ok');
      if (!id || id !== d.id) go(`studio?id=${encodeURIComponent(d.id)}`);
    } catch (e) { status(e instanceof Error ? e.message : 'Saving failed. Nothing was lost: the design is still open and autosaved in this browser.', 'err'); }
    setBusy('');
  };
  const newDesign = () => { if (dirty && !window.confirm('Start a new design? Unsaved changes stay in the autosave of this browser only.')) return; setDoc(newDoc('New design', whoAmI())); setHist(emptyHistory()); setSel([]); setSavedSig(''); setPreview(null); setCompare({ c: null, ref: null }); go('studio'); setFit((f) => f + 1); };
  const openDialog = async () => { try { const all = await listProjects(); setOpenList(all.filter((x) => x.familyId === STUDIO_FAMILY).map((x) => ({ id: x.id, name: x.name, updatedAt: x.updatedAt }))); } catch { status('Could not list saved designs.', 'err'); } };
  const exportKind = async (k: Kind | 'dxf-true' | 'zip') => {
    setBusy('Preparing the file...');
    try {
      if (k === 'dxf-true') { download({ name: `${doc.name.replace(/[^\w-]+/g, '_')}_true-size.dxf`, blob: new Blob([studioDxf(doc)], { type: 'application/dxf' }) }); status('True-size DXF downloaded (millimetres, 1:1, editable lines, arcs and circles).', 'ok'); }
      else {
        const sh = studioSheet(doc, built);
        const parts = exactParts ?? (await import('../studio/export.ts')).builtToParts(built);
        const src = studioSource(doc, built, sh, parts);
        if (k === 'zip') { download(await buildPackage(src, (m) => setBusy(m))); status('Package downloaded. README.txt inside lists anything that could not be made.', 'ok'); }
        else { if ((k === 'stl' || k === 'obj' || k === 'glb' || k === 'gltf' || k === 'step') && !doc.bodies.length) throw new Error('There is no 3D body yet. Make one in the 3D tab first.'); download(await makeArtifact(k, src)); status(`${k.toUpperCase()} downloaded.${(k === 'stl' || k === 'obj' || k === 'glb' || k === 'gltf') && !exactParts && built.reports.some((r) => r.exactOnly.length) ? ' It does not contain the exact-only features: build the exact model in the 3D view first.' : ''}`, 'ok'); }
      }
    } catch (e) { status(e instanceof Error ? e.message : 'Export failed.', 'err'); }
    setBusy('');
  };
  const doCalibrate = () => {
    if (!calib) return;
    const v = Number(calib.mm.replace(',', '.')) * (unit === 'mm' ? 1 : unit === 'cm' ? 10 : unit === 'm' ? 1000 : 25.4);
    const rid = activeRef ?? doc.refs[doc.refs.length - 1]?.id;
    if (!rid) { status('Import a picture or PDF first.', 'err'); setCalib(null); return; }
    const r = calibrate(doc, rid, calib.p1, calib.p2, v);
    if (r.error) { status(r.error, 'err'); return; }
    commit(r.doc, 'Set scale'); setCalib(null); setTool('select'); setFit((f) => f + 1);
    status(`Scale set: the picture was scaled by ${r.factor.toFixed(4)}. Traced items followed.`, 'ok');
  };
  const pp = { doc, sel, setSel, commit, status, unit, readOnly };
  const tg = [...new Set(TOOLS.map((t) => t.group))];
  const showCanvas = view === '2d' || view === 'split';
  return (
    <div className="studio" ref={rootRef}>
      {/* top toolbar */}
      <div className="st-top">
        <input className="st-title" value={doc.name} onChange={(e: { target: { value: string } }) => setDoc({ ...doc, name: e.target.value.slice(0, 120) })} aria-label="Design name" />
        <div className="st-tb">
          <button onClick={newDesign}>New</button>
          <button onClick={() => void openDialog()}>Open</button>
          <button className="primary" onClick={() => void save()} disabled={!!busy || readOnly} title={readOnly ? 'Your role is read-only (viewer)' : 'Ctrl+S'}>{dirty ? 'Save*' : 'Save'}</button>
          <button onClick={() => void save('')} disabled={!!busy || readOnly} title="Save and keep a named version">Save version</button>
          <button onClick={doUndo} disabled={!hist.past.length} title="Ctrl+Z">Undo</button>
          <button onClick={doRedo} disabled={!hist.future.length} title="Ctrl+Y">Redo</button>
          <button onClick={() => setRight('import')}>Import</button>
          <select value="" onChange={(e: { target: { value: string } }) => { if (e.target.value) void exportKind(e.target.value as Kind); }} aria-label="Export">
            <option value="">Export…</option>
            <option value="dxf-true">DXF true size 1:1 (editable)</option>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.kind === 'dxf' ? 'DXF drawing sheet (A3)' : k.kind === 'project' ? 'Studio design file (JSON)' : k.kind === 'dims' ? 'Parameters (CSV)' : k.kind === 'bom' ? 'Bodies and mass (CSV)' : k.label}</option>)}
            <option value="zip">Everything as one ZIP</option>
          </select>
          <button onClick={() => setRight('ai')}>AI Assistant</button>
          <div className="seg">{(['2d', 'split', '3d', 'sheet'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === '2d' ? '2D' : v === '3d' ? '3D' : v === 'split' ? '2D + 3D' : 'Drawing sheet'}</button>)}</div>
          <label className="st-unit">Units <select value={unit} onChange={(e: { target: { value: string } }) => setDoc({ ...doc, unit: e.target.value as Unit })}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option><option value="in">inch</option></select></label>
        </div>
      </div>
      {restore && <div className="st-banner">Unsaved work from {new Date(restore.at).toLocaleString()} was found in this browser. <button onClick={() => { setDoc(restore.doc); setHist(emptyHistory()); setRestore(null); setFit((f) => f + 1); }}>Restore it</button> <button onClick={() => { setRestore(null); void clearAutosave(); }}>Discard</button></div>}
      {readOnly && <div className="st-banner">Your role is <b>viewer</b>: you can look and export, but not save, upload or use AI.</div>}
      <div className="st-body">
        {/* left sidebar */}
        <aside className="st-left">
          <div className="tabs st-tabs">{(['tools', 'library', 'layers', 'history'] as Left[]).map((t) => <button key={t} className={left === t ? 'on' : ''} onClick={() => setLeft(t)}>{t === 'tools' ? 'Tools' : t === 'library' ? 'Library' : t === 'layers' ? 'Layers' : 'History'}</button>)}</div>
          {left === 'tools' && <div className="st-tools">
            {tg.map((g) => <div key={g}><h4>{g}</h4><div className="st-toolgrid">{TOOLS.filter((t) => t.group === g).map((t) => <button key={t.t} className={tool === t.t ? 'on' : ''} onClick={() => setTool(t.t)} title={`${TOOL_HELP[t.t]}${t.key ? ` (key ${t.key.toUpperCase()})` : ''}`}>{t.label}</button>)}</div></div>)}
            <h4>Tool options</h4>
            <ToolOptions tool={tool} opts={opts} setOpts={setOpts} unit={unit} />
            <h4>Snap</h4>
            <div className="st-snaps">
              {(['grid', 'ends', 'mids', 'centres', 'inters', 'near', 'ortho'] as (keyof Snaps)[]).map((k) => <label key={k} className="chk"><input type="checkbox" checked={!!snaps[k]} onChange={(e: { target: { checked: boolean } }) => setSnaps({ ...snaps, [k]: e.target.checked })} /> {k === 'grid' ? 'Grid' : k === 'ends' ? 'End points' : k === 'mids' ? 'Middles' : k === 'centres' ? 'Centres' : k === 'inters' ? 'Crossings' : k === 'near' ? 'On curve' : 'Ortho (H/V)'}</label>)}
              <LenField label="Grid step (0 = automatic)" mm={snaps.step} unit={unit} min={0} onSet={(v) => setSnaps({ ...snaps, step: v })} />
            </div>
          </div>}
          {left === 'library' && <LibraryPanel {...pp} />}
          {left === 'layers' && <LayersPanel {...pp} />}
          {left === 'history' && <HistoryPanel hist={hist} doc={doc} onUndoTo={(n) => { let h = hist, d = doc; for (let i = 0; i < n; i++) { const r = undo(h, d); if (!r) break; h = r.h; d = r.doc; } setHist(h); setDoc(d); }} onSaveVersion={(label) => void save(label)} onRestore={(vid) => { const r = restoreVersion(doc, vid); if ('error' in r) status(r.error, 'err'); else { commit(r, 'Restore version'); setFit((f) => f + 1); } }} onDuplicate={() => { const d = duplicateDoc(doc); setDoc(d); setHist(emptyHistory()); setSavedSig(''); go('studio'); status('This is now a copy. Save it to keep it.', 'info'); }} />}
        </aside>
        <div className="st-split" onPointerDown={(e: PtrEv) => dragWidth(e, lw, setLw, 1)} title="Drag to resize" />
        {/* centre */}
        <section className={`st-centre v-${view}`}>
          {showCanvas && <div className="st-help">{TOOL_HELP[tool]}</div>}
          <div className="st-views">
            {showCanvas && <StudioCanvas doc={doc} sel={sel} setSel={(s) => { setSel(s); if (s.length && right !== 'props' && right !== 'ai' && right !== 'import' && right !== '3d') setRight('props'); }} tool={tool} opts={opts} snaps={snaps} commit={commit} status={status} preview={preview} highlight={highlight} compare={compare.c} compareRef={compare.ref} fit={fit} onCursor={setCursor} unit={unit}
              onCalibrate={(p1, p2) => setCalib({ p1, p2, mm: '' })} onPickDetected={(tid) => { setPendingDetected(tid); setRight('import'); }} />}
            {(view === '3d' || view === 'split') && <Studio3D doc={doc} built={built} onExact={setExactParts} />}
            {view === 'sheet' && sheet && <div className="st-sheet"><DrawingWorkspace sheet={sheet} /></div>}
          </div>
        </section>
        <div className="st-split" onPointerDown={(e: PtrEv) => dragWidth(e, rw, setRw, -1)} title="Drag to resize" />
        {/* right sidebar */}
        <aside className="st-right">
          <div className="tabs st-tabs">{([['props', 'Properties'], ['params', 'Parameters'], ['cons', 'Constraints'], ['3d', '3D'], ['import', 'Import'], ['ai', 'AI'], ['checks', `Checks${errs ? ` (${errs})` : warns ? ` (${warns})` : ''}`]] as [Right, string][]).map(([k, l]) => <button key={k} className={right === k ? 'on' : ''} onClick={() => setRight(k)}>{l}</button>)}</div>
          <div className="st-panel">
            {right === 'props' && <PropertiesPanel {...pp} />}
            {right === 'params' && <>
              <div className="st-grid2">
                <label className="st-field"><span>Component type</span><input value={doc.componentType} onChange={(e: { target: { value: string } }) => setDoc({ ...doc, componentType: e.target.value.slice(0, 80) })} /></label>
                <label className="st-field"><span>Material</span><select value={doc.material} onChange={(e: { target: { value: string } }) => commit({ ...doc, material: e.target.value, bodies: doc.bodies.map((b) => ({ ...b, material: b.material === doc.material ? e.target.value : b.material })) }, 'Material')}>{MATERIALS.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>
                <label className="st-field"><span>Revision</span><input value={doc.revision} onChange={(e: { target: { value: string } }) => setDoc({ ...doc, revision: e.target.value.slice(0, 8) })} /></label>
              </div>
              <ParamsPanel {...pp} onFocus={(ids) => setHighlight(new Set(ids))} />
            </>}
            {right === 'cons' && <ConstraintsPanel {...pp} />}
            {right === '3d' && <BodiesPanel {...pp} built={built} />}
            {right === 'import' && <ImportPanel {...pp} onCompare={(c, r) => setCompare({ c, ref: r })} onTool={(t) => setTool(t)} activeRef={activeRef} setActiveRef={setActiveRef} pendingDetected={pendingDetected} />}
            {right === 'ai' && <AssistantPanel {...pp} built={built} setPreview={setPreview} />}
            {right === 'checks' && <ChecksPanel checks={checks} setSel={setSel} />}
          </div>
        </aside>
      </div>
      {/* bottom status bar */}
      <div className={`st-status ${msg.k}`}>
        <span className="st-msg">{busy || msg.m}</span>
        <span>{cursor ? `X ${(cursor[0] / (unit === 'mm' ? 1 : unit === 'cm' ? 10 : unit === 'm' ? 1000 : 25.4)).toFixed(3)}  Y ${(cursor[1] / (unit === 'mm' ? 1 : unit === 'cm' ? 10 : unit === 'm' ? 1000 : 25.4)).toFixed(3)} ${unit}` : ''}</span>
        <span>{doc.ents.length} items · {sel.length} selected · {doc.bodies.length} bodies · {built.mass > 0 ? `${built.mass.toFixed(3)} kg` : 'no mass yet'}</span>
        <button className="link" onClick={() => setRight('checks')}>{errs ? `✖ ${errs} error(s)` : '✔ no errors'} · {warns} warning(s)</button>
        <span className="muted">{dirty ? 'Unsaved changes (autosaved in this browser)' : 'Saved'}</span>
      </div>
      {calib && <div className="st-modal" role="dialog" aria-label="Set scale"><div><h3>Set scale</h3><p>The two points are {Math.hypot(calib.p2[0] - calib.p1[0], calib.p2[1] - calib.p1[1]).toFixed(3)} mm apart now. What is the real distance?</p><input autoFocus value={calib.mm} placeholder={`real distance in ${unit}`} onChange={(e: { target: { value: string } }) => setCalib({ ...calib, mm: e.target.value })} onKeyDown={(e: KeyEv) => { if (e.key === 'Enter') doCalibrate(); }} /><div className="st-btns"><button className="primary" onClick={doCalibrate}>Apply</button><button onClick={() => setCalib(null)}>Cancel</button></div></div></div>}
      {openList && <div className="st-modal" role="dialog" aria-label="Open a design"><div><h3>Open a studio design</h3>{!openList.length && <p className="muted">No saved studio designs yet.</p>}<ul className="st-list">{openList.map((x) => <li key={x.id}><span>{x.name} <small className="muted">{new Date(x.updatedAt).toLocaleString()}</small></span><button onClick={() => { setOpenList(null); go(`studio?id=${encodeURIComponent(x.id)}`); }}>Open</button></li>)}</ul><p className="muted small">To open a design file (.json) or a drawing, use Import.</p><button onClick={() => setOpenList(null)}>Close</button></div></div>}
    </div>
  );
}

function dragWidth(e: { clientX: number }, start: number, set: (n: number) => void, dir: 1 | -1) {
  const x0 = e.clientX;
  const move = (ev: PointerEvent) => set(Math.max(180, Math.min(620, start + dir * (ev.clientX - x0))));
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

function ToolOptions({ tool, opts, setOpts, unit }: { tool: Tool; opts: ToolOpts; setOpts: (o: ToolOpts) => void; unit: Unit }) {
  const set = (k: keyof ToolOpts) => (v: number) => setOpts({ ...opts, [k]: v });
  switch (tool) {
    case 'offset': return <LenField label="Offset distance" mm={opts.dist} unit={unit} min={1e-6} onSet={set('dist')} />;
    case 'fillet': return <LenField label="Fillet radius" mm={opts.radius} unit={unit} min={1e-6} onSet={set('radius')} />;
    case 'chamfer': return <LenField label="Chamfer distance" mm={opts.chamfer} unit={unit} min={1e-6} onSet={set('chamfer')} />;
    case 'polygon': return <LenField label="Number of sides" kind="count" mm={opts.sides} unit={unit} min={3} max={200} onSet={set('sides')} />;
    case 'rotate': return <LenField label="Rotation angle (counter-clockwise)" kind="deg" mm={opts.angle} unit={unit} min={-360} max={360} onSet={set('angle')} />;
    case 'mirror': return <label className="chk"><input type="checkbox" checked={opts.mirrorCopy} onChange={(e: { target: { checked: boolean } }) => setOpts({ ...opts, mirrorCopy: e.target.checked })} /> Keep the original (mirror copy)</label>;
    case 'rect': return <label className="chk"><input type="checkbox" checked={opts.rectConstrain} onChange={(e: { target: { checked: boolean } }) => setOpts({ ...opts, rectConstrain: e.target.checked })} /> Keep the corners square (constraints)</label>;
    case 'freehand': return <label className="chk"><input type="checkbox" checked={opts.smooth} onChange={(e: { target: { checked: boolean } }) => setOpts({ ...opts, smooth: e.target.checked })} /> Smooth the stroke into a curve</label>;
    case 'text': return <><label className="st-field"><span>Text</span><input value={opts.text} onChange={(e: { target: { value: string } }) => setOpts({ ...opts, text: e.target.value.slice(0, 300) })} /></label><LenField label="Text height" mm={opts.textH} unit={unit} min={0.1} onSet={set('textH')} /></>;
    case 'dim': return <label className="st-field"><span>Two-point mode</span><select value={opts.dimMode} onChange={(e: { target: { value: string } }) => setOpts({ ...opts, dimMode: e.target.value as ToolOpts['dimMode'] })}><option value="auto">Aligned (true distance)</option><option value="h">Horizontal</option><option value="v">Vertical</option><option value="angle">Angle between two lines</option></select></label>;
    case 'holes': return <><LenField label="Number of holes" kind="count" mm={opts.holeN} unit={unit} min={1} max={360} onSet={set('holeN')} /><LenField label="Hole diameter" mm={opts.holeD} unit={unit} min={0.01} onSet={set('holeD')} /><LenField label="Pitch circle diameter" mm={opts.holePcd} unit={unit} min={0} onSet={set('holePcd')} /></>;
    case 'slot': return <><LenField label="Length (centre to centre)" mm={opts.slotLen} unit={unit} min={0} onSet={set('slotLen')} /><LenField label="Width" mm={opts.slotW} unit={unit} min={0.01} onSet={set('slotW')} /><LenField label="Angle" kind="deg" mm={opts.slotAng} unit={unit} onSet={set('slotAng')} /></>;
    default: return <p className="muted small">{TOOL_HELP[tool]}</p>;
  }
}
