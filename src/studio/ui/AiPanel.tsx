import { useEffect, useRef, useState } from 'react';
import type { Detected, Reference, StudioDoc, Unit } from '../model.ts';
import { parseDoc, uid } from '../model.ts';
import { findEnt } from '../geom.ts';
import { parseDxf } from '../dxf.ts';
import { parseSvg } from '../svg.ts';
import { detectFromItems, scaleFromTexts } from '../detect.ts';
import { newReference, traceToEnts } from '../refs.ts';
import { compareDimensions, compareToReference, toGray } from '../compare.ts';
import type { Comparison } from '../compare.ts';
import { applySteps, assistPrompt, drawingToDoc, localPlan, readAssist } from '../assistant.ts';
import type { AiAssist, AiStep } from '../assistant.ts';
import type { Built } from '../solid.ts';
import { openPdf, readPicture, renderPdfPage } from '../importers.ts';
import type { Picture } from '../importers.ts';
import { aiAssist, aiDrawing, aiStatus, putUpload, useAuth } from '../../cloud/client.ts';
import { solve } from '../solver.ts';
import { Section } from './Fields.tsx';
import type { KeyEv } from './Fields.tsx';
import type { PanelProps } from './Panels.tsx';

const canAi = (role?: string) => role !== 'viewer' && role !== 'employee';

/* ---------- import and references ---------- */
export function ImportPanel(p: PanelProps & { onCompare: (c: Comparison | null, refId: string | null) => void; onTool: (t: 'calibrate') => void; activeRef: string | null; setActiveRef: (id: string | null) => void; pendingDetected: string | null }) {
  const { doc } = p;
  const auth = useAuth();
  const file = useRef<HTMLInputElement>(null);
  const rasters = useRef(new Map<string, Picture>());
  const [busy, setBusy] = useState('');
  const [pdf, setPdf] = useState<{ doc: Awaited<ReturnType<typeof openPdf>>['doc']; pages: number; name: string } | null>(null);
  const [page, setPage] = useState(1);
  const importLayer = doc.layers.find((l) => l.id === 'L4')?.id ?? doc.layers[0].id;

  const keepOriginal = async (r: Reference, pic: Picture) => {
    // the full original stays untouched; when signed in it is also stored as an upload (images only)
    if (!auth.user || auth.user.role === 'viewer') return r;
    try { const id = `${doc.id.slice(0, 30)}_${r.id}`.replace(/[^\w-]/g, '_').slice(0, 64); await putUpload(id, r.name, pic.mime, pic.base64, doc.id); return { ...r, uploadId: id }; } catch { return r; }
  };
  const addPictureRef = async (name: string, mime: string, kind: Reference['kind'], pic: Picture, mmPerPx?: number, detected: Detected[] = []) => {
    // a scale from the PDF page size is a good start, but it is only "set" once the person confirms it with a known distance
    let r = { ...newReference(name, mime, kind, pic.dataUrl, pic.w, pic.h, mmPerPx), detected, calibrated: false };
    r = await keepOriginal(r, pic);
    rasters.current.set(r.id, pic);
    p.commit({ ...doc, refs: [...doc.refs, r] }, `Import ${name}`);
    p.setActiveRef(r.id);
    return r;
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(`Reading ${f.name}...`);
    try {
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      if (ext === 'dxf') {
        const layerMap = new Map<string, string>();
        const layers = [...doc.layers];
        const r = parseDxf(await f.text(), (n) => { if (!layerMap.has(n)) { const ex = layers.find((l) => l.name === n); if (ex) layerMap.set(n, ex.id); else { const id = uid('L'); layers.push({ id, name: n.slice(0, 60), visible: true, locked: false, color: '#334155' }); layerMap.set(n, id); } } return layerMap.get(n)!; });
        p.commit({ ...doc, layers, ents: [...doc.ents, ...r.ents] }, `Import ${f.name}`);
        p.status(`${r.ents.length} items imported from ${f.name} (units: ${r.unitsNote}). ${r.warnings.join(' ')}`, r.warnings.length ? 'info' : 'ok');
      } else if (ext === 'svg') {
        const r = parseSvg(await f.text(), importLayer);
        p.commit({ ...doc, ents: [...doc.ents, ...r.ents] }, `Import ${f.name}`);
        p.status(`${r.ents.length} shapes imported (${r.unitsNote}). ${r.warnings.join(' ')}`, r.warnings.length ? 'info' : 'ok');
      } else if (ext === 'json') {
        const r = parseDoc(await f.text());
        p.commit({ ...r.doc, id: doc.id, versions: doc.versions }, `Open ${f.name}`);
        p.status(`Design file opened${r.dropped ? ` (${r.dropped} damaged item(s) were skipped)` : ''}.`, 'ok');
      } else if (ext === 'pdf' || f.type === 'application/pdf') {
        const o = await openPdf(f); setPdf({ ...o, name: f.name }); setPage(1);
        await loadPdfPage(o.doc, 1, f.name, o.pages);
      } else if (ext === 'dwg') {
        p.status('DWG is a closed format and cannot be read here. In your CAD program use "Save As" > DXF, then import the DXF.', 'err');
      } else {
        const pic = await readPicture(f);
        await addPictureRef(f.name.replace(/\.[^.]+$/, ''), f.type || pic.mime, 'image', pic);
        p.status('Picture added as a locked reference layer. Next: "Set scale" with one known distance, then trace it, draw over it, or let AI read it.', 'ok');
      }
    } catch (e) { p.status(e instanceof Error ? e.message : 'The file could not be read.', 'err'); }
    setBusy(''); if (file.current) file.current.value = '';
  };
  const loadPdfPage = async (d: Awaited<ReturnType<typeof openPdf>>['doc'], n: number, name: string, pages: number) => {
    setBusy(`Rendering page ${n} of ${pages}...`);
    const pg = await renderPdfPage(d, n);
    const det = detectFromItems(pg.items, 'pdf-text');
    const sc = scaleFromTexts(pg.items.map((i) => i.str));
    const mmPerPx = sc ? pg.mmPerPx / sc : pg.mmPerPx;
    const r = await addPictureRef(`${name.replace(/\.pdf$/i, '')} p${n}`, 'application/pdf', 'pdf', pg.picture, mmPerPx, det);
    p.status(`PDF page ${n}: ${det.length} dimension text(s) found${sc ? `, drawing scale ${sc >= 1 ? sc : `1:${+(1 / sc).toFixed(3)}`} applied` : ' (page taken as true size 1:1)'}. The page picture is a reference; confirm each dimension in the list.${pg.items.length ? '' : ' This page has no text layer (scanned): use AI reading or trace it.'}`, 'ok');
    void r;
    setBusy('');
  };
  const ref = doc.refs.find((r) => r.id === p.activeRef) ?? doc.refs[doc.refs.length - 1] ?? null;
  const updRef = (id: string, ch: Partial<Reference>, label: string) => p.commit({ ...doc, refs: doc.refs.map((r) => (r.id === id ? { ...r, ...ch } : r)) }, label);
  const rasterOf = async (r: Reference): Promise<Picture> => {
    const have = rasters.current.get(r.id); if (have) return have;
    if (!r.dataUrl) throw new Error('This picture is not loaded. Open the design again while online.');
    const img = new Image(); img.src = r.dataUrl; await img.decode();
    const cv = document.createElement('canvas'); cv.width = r.pxW; cv.height = r.pxH; const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, r.pxW, r.pxH);
    const pic: Picture = { raster: { width: r.pxW, height: r.pxH, data: ctx.getImageData(0, 0, r.pxW, r.pxH).data }, dataUrl: r.dataUrl, mime: r.mime, base64: r.dataUrl.slice(r.dataUrl.indexOf(',') + 1), w: r.pxW, h: r.pxH };
    rasters.current.set(r.id, pic); return pic;
  };
  const trace = async (r: Reference) => {
    setBusy('Tracing the outline...');
    try { const pic = await rasterOf(r); const t = traceToEnts(r, pic.raster, importLayer); if (t.error) p.status(t.error, 'err'); else { p.commit({ ...doc, ents: [...doc.ents, ...t.ents] }, 'Trace picture'); p.status(`${t.ents.length} traced item(s) added (unconfirmed, dashed orange). ${t.warnings.join(' ')}`, 'info'); } } catch (e) { p.status(e instanceof Error ? e.message : 'Tracing failed.', 'err'); }
    setBusy('');
  };
  const aiRead = async (r: Reference) => {
    setBusy('AI is reading the drawing (up to a minute)...');
    try {
      const pic = await rasterOf(r);
      // send a smaller JPEG copy (the server limit is about 2.5 MB)
      const small = pic.base64.length > 3_000_000 ? await shrink(pic.dataUrl) : { mime: pic.mime, base64: pic.base64 };
      const res = await aiDrawing(small.mime, small.base64);
      const out = drawingToDoc(doc, r.id, res.drawing, importLayer);
      p.commit({ ...out.doc, ai: [...doc.ai, { id: uid('q'), at: new Date().toISOString(), prompt: `Read drawing "${r.name}"`, reply: `${res.drawing.partType}: ${res.drawing.notes} Missing: ${res.drawing.missing.join('; ') || 'nothing listed'}`, applied: [], rejected: [] }].slice(-100) }, 'AI reading');
      p.status(`AI (${res.provider}) found ${out.added} item(s) and ${res.drawing.dimensions.length} written dimension(s). Everything is UNCONFIRMED: compare it with the original and confirm or correct it.${res.drawing.missing.length ? ` Missing on the drawing: ${res.drawing.missing.join('; ')}` : ''}`, 'info');
    } catch (e) { p.status(e instanceof Error ? e.message : 'The AI reading failed. Nothing was changed.', 'err'); }
    setBusy('');
  };
  const runCompare = async (r: Reference) => {
    setBusy('Comparing...');
    try { const pic = await rasterOf(r); const c = compareToReference(doc, r, toGray(pic.raster)); p.onCompare(c, r.id); p.status(`Match ${(c.overall * 100).toFixed(0)}% of the CAD lines lie on the drawing; ${(c.uncoveredFrac * 100).toFixed(0)}% of the drawing's lines are not converted yet (red circles). Red items do not follow the drawing.`, 'info'); } catch (e) { p.status(e instanceof Error ? e.message : 'Comparison failed.', 'err'); }
    setBusy('');
  };
  const setDet = (rid: string, tid: string, ch: Partial<Detected>, label: string) => p.commit({ ...doc, refs: doc.refs.map((r) => (r.id === rid ? { ...r, detected: r.detected.map((t) => (t.id === tid ? { ...t, ...ch } : t)) } : r)) }, label);
  /** applies a confirmed drawing dimension to the selected item */
  const applyDet = (r: Reference, t: Detected) => {
    const e = p.sel.length === 1 ? findEnt(doc, p.sel[0]) : undefined;
    if (!e || t.value === null) { p.status('Select ONE item in the drawing first (the circle, arc, line or dimension this value belongs to).', 'err'); return; }
    let next: StudioDoc | null = null;
    if ((e.k === 'circle' || e.k === 'arc') && (t.kind === 'diameter' || t.kind === 'radius')) next = { ...doc, ents: doc.ents.map((x) => (x.id === e.id && (x.k === 'circle' || x.k === 'arc') ? { ...x, r: t.kind === 'diameter' ? t.value! / 2 : t.value!, confirmed: true } : x)) };
    else if (e.k === 'dim') next = { ...doc, ents: doc.ents.map((x) => (x.id === e.id ? { ...x, drive: t.value! } : x)) };
    else if (e.k === 'line' && t.kind === 'length') next = { ...doc, ents: [...doc.ents.map((x) => (x.id === e.id ? { ...x, confirmed: true } : x)), { id: uid('d'), layer: doc.layers.find((l) => l.id === 'L2')?.id ?? doc.layers[0].id, source: 'drawn', k: 'dim', d: { kind: 'length', l: { e: e.id }, off: 8 }, drive: t.value! }] };
    if (!next) { p.status(`A ${t.kind} value cannot be applied to a ${e.k}.`, 'err'); return; }
    const s = solve(next);
    if (!s.ok) { p.status(s.error ?? 'Conflict.', 'err'); return; }
    const refs = s.doc.refs.map((x) => (x.id === r.id ? { ...x, detected: x.detected.map((y) => (y.id === t.id ? { ...y, status: 'confirmed' as const, appliedTo: e.id } : y)) } : x));
    p.commit({ ...s.doc, refs }, `Apply ${t.text}`);
  };
  const cmp = compareDimensions(doc);
  return (
    <div>
      <div className="st-btns">
        <button className="primary" onClick={() => file.current?.click()} disabled={!!busy || p.readOnly}>Import file…</button>
        <input ref={file} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.gif,.pdf,.svg,.dxf,.dwg,.json,image/*,application/pdf" onChange={(e: { target: { files?: FileList | null } }) => onFile(e.target.files?.[0])} />
      </div>
      <p className="muted small">Pictures, photos, scans, hand sketches (JPG, PNG, WebP, TIFF*), PDF drawings, SVG, DXF and studio files. *TIFF only where the browser can open it. DWG: save as DXF first.</p>
      {busy && <p className="st-busy">{busy}</p>}
      {pdf && pdf.pages > 1 && <div className="st-row"><span>PDF {pdf.name}: page</span><input type="number" min={1} max={pdf.pages} value={page} onChange={(e: { target: { value: string } }) => setPage(Math.max(1, Math.min(pdf.pages, Number(e.target.value) || 1)))} /><button onClick={() => loadPdfPage(pdf.doc, page, pdf.name, pdf.pages)}>Add this page</button></div>}
      {doc.refs.map((r) => (
        <Section key={r.id} title={`${r.kind === 'pdf' ? 'PDF page' : 'Picture'}: ${r.name}`} open={r.id === ref?.id} right={r.calibrated ? <small className="ok"> scale set</small> : <small className="warn"> scale not set</small>}>
          <div className="st-row">
            <label className="chk"><input type="checkbox" checked={r.visible} onChange={(e: { target: { checked: boolean } }) => updRef(r.id, { visible: e.target.checked }, 'Show reference')} /> Show</label>
            <label>Opacity <input type="range" min={0.05} max={1} step={0.05} value={r.opacity} onChange={(e: { target: { value: string } }) => updRef(r.id, { opacity: Number(e.target.value) }, 'Reference opacity')} /></label>
          </div>
          <p className="muted small">{r.pxW} × {r.pxH} px, {r.mmPerPx.toPrecision(4)} mm per pixel ({(r.pxW * r.mmPerPx).toFixed(1)} × {(r.pxH * r.mmPerPx).toFixed(1)} mm). The original is never changed{r.uploadId ? ' and is stored in your uploads' : ''}.</p>
          <div className="st-btns">
            <button onClick={() => { p.setActiveRef(r.id); p.onTool('calibrate'); }} title="Click two points whose real distance you know">Set scale…</button>
            <button onClick={() => trace(r)} disabled={!!busy || p.readOnly} title="Outline of the main object (photos, silhouettes)">Trace outline</button>
            <button onClick={() => aiRead(r)} disabled={!!busy || !auth.user || !canAi(auth.user.role) || p.readOnly} title={!auth.user ? 'Sign in to use AI' : !canAi(auth.user.role) ? 'AI is not available for your role' : 'Shapes, dimensions and missing information'}>AI: read drawing</button>
            <button onClick={() => runCompare(r)} disabled={!!busy}>Compare with CAD</button>
            <button onClick={() => p.onCompare(null, null)}>Clear comparison</button>
            <button className="danger" onClick={() => { if (window.confirm('Remove this reference picture from the design? (Uploaded originals stay in your uploads.)')) p.commit({ ...doc, refs: doc.refs.filter((x) => x.id !== r.id) }, 'Remove reference'); }}>Remove</button>
          </div>
          {!!r.detected.length && (
            <table className="tbl st-det"><thead><tr><th>Read</th><th>Value</th><th>From</th><th /></tr></thead><tbody>
              {r.detected.map((t) => (
                <tr key={t.id} className={`${t.status}${p.pendingDetected === t.id ? ' focus' : ''}`}>
                  <td title={`confidence ${(t.confidence * 100).toFixed(0)}%`}>{t.text}</td>
                  <td><input className="st-small" value={t.value ?? ''} onChange={(e: { target: { value: string } }) => setDet(r.id, t.id, { value: e.target.value === '' ? null : Number(e.target.value), status: 'detected' }, 'Correct value')} aria-label="Corrected value" /> {t.unit === 'deg' ? '°' : t.unit === 'count' ? '' : 'mm'}</td>
                  <td><small>{t.from === 'ai' ? 'AI' : 'PDF text'} · {t.status === 'confirmed' ? 'confirmed' : t.status === 'rejected' ? 'rejected' : 'detected'}</small></td>
                  <td className="row-actions"><button className="link" onClick={() => applyDet(r, t)} title="Apply to the selected item">apply</button><button className="link" onClick={() => setDet(r.id, t.id, { status: 'confirmed' }, 'Confirm value')}>ok</button><button className="link" onClick={() => setDet(r.id, t.id, { status: 'rejected' }, 'Reject value')}>reject</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Section>
      ))}
      {!!cmp.length && <Section title="Drawing dimensions versus the model" open={false}><table className="tbl"><thead><tr><th>Drawing</th><th>Model</th><th>Difference</th></tr></thead><tbody>{cmp.map((c, i) => <tr key={i} className={c.status}><td>{c.text}</td><td>{c.model === null ? '-' : +c.model.toFixed(3)}</td><td>{c.status === 'match' ? 'match' : c.diff === null ? 'not in model' : `${c.diff > 0 ? '+' : ''}${+c.diff.toFixed(3)}`}</td></tr>)}</tbody></table></Section>}
    </div>
  );
}
async function shrink(dataUrl: string): Promise<{ mime: string; base64: string }> {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  const u = cv.toDataURL('image/jpeg', 0.8); return { mime: 'image/jpeg', base64: u.slice(u.indexOf(',') + 1) };
}

/* ---------- assistant ---------- */
export function AssistantPanel(p: PanelProps & { built: Built; setPreview: (d: StudioDoc | null) => void }) {
  const { doc } = p;
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<(AiAssist & { from: string; prompt: string }) | null>(null);
  const [on, setOn] = useState<boolean[]>([]);
  const [crit, setCrit] = useState(false);
  const [aiOk, setAiOk] = useState<boolean | null>(null);
  useEffect(() => { if (!auth.user || !canAi(auth.user.role)) return; let live = true; aiStatus().then((s) => { if (live) setAiOk(s.vision.length > 0); }).catch(() => { if (live) setAiOk(false); }); return () => { live = false; }; }, [auth.user]);
  const preview = (pl: AiAssist, flags: boolean[]) => { const steps = pl.steps.filter((_, i) => flags[i]); const r = applySteps(doc, steps, p.sel); p.setPreview(steps.length ? r.doc : null); return r; };
  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true); p.setPreview(null);
    try {
      let res: AiAssist, from = 'built-in reader';
      if (useAi) { const r = await aiAssist(assistPrompt(doc, p.sel, q)); const a = readAssist(doc, r.text); if ('error' in a) throw new Error(a.error); res = a; from = `AI (${r.provider})`; }
      else res = localPlan(doc, q, p.sel, p.built);
      const flags = res.steps.map(() => true);
      setPlan({ ...res, from, prompt: q }); setOn(flags); setCrit(false);
      if (res.steps.length) preview(res, flags);
    } catch (e) { p.status(`${e instanceof Error ? e.message : 'The request failed.'} Nothing was changed.`, 'err'); }
    setBusy(false);
  };
  const steps = plan?.steps ?? [];
  const chosen = steps.filter((_, i) => on[i]);
  const needCrit = chosen.some((s) => s.critical);
  const results = plan && steps.length ? applySteps(doc, chosen, p.sel).results : [];
  const accept = () => {
    if (!plan) return;
    if (needCrit && !crit) { p.status('Tick the confirmation for the safety-relevant changes first.', 'err'); return; }
    const r = applySteps(doc, chosen, p.sel);
    const appliedLabels = chosen.filter((_, i) => r.results[i]?.ok).map((s) => s.why || s.action.type);
    const rejected = steps.filter((_, i) => !on[i]).map((s) => s.why || s.action.type);
    p.commit({ ...r.doc, ai: [...doc.ai, { id: uid('q'), at: new Date().toISOString(), prompt: plan.prompt, reply: plan.reply, applied: appliedLabels, rejected }].slice(-100) }, `Assistant: ${plan.prompt.slice(0, 40)}`);
    p.setPreview(null); setPlan(null); setQ('');
    p.status(`${appliedLabels.length} change(s) applied. Undo (Ctrl+Z) restores the previous design.`, 'ok');
  };
  const reject = () => { if (plan) p.commit({ ...doc, ai: [...doc.ai, { id: uid('q'), at: new Date().toISOString(), prompt: plan.prompt, reply: plan.reply, applied: [], rejected: steps.map((s) => s.why || s.action.type) }].slice(-100) }, 'Assistant: rejected'); p.setPreview(null); setPlan(null); };
  const editNum = (i: number, k: string, v: number) => { if (!plan) return; const st: AiStep[] = plan.steps.map((s, j) => (j === i ? { ...s, action: { ...s.action, [k]: v } as AiStep['action'] } : s)); const np = { ...plan, steps: st }; setPlan(np); preview(np, on); };
  return (
    <div>
      <textarea className="st-ask" rows={3} value={q} placeholder={'For example: "Make the centre hole 35 mm", "Add 12 holes Ø10 on PCD 150", "Increase the plate thickness to 8 mm", "Convert to 3D, thickness 6", "Suggest improvements to reduce material"'} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} onKeyDown={(e: KeyEv) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask(); }} />
      <div className="st-row">
        <label className="chk" title={!auth.user ? 'Sign in to use AI' : !canAi(auth.user.role) ? 'AI is not available for your role' : aiOk === false ? 'No AI service is switched on (Settings > AI services)' : ''}><input type="checkbox" checked={useAi} disabled={!auth.user || !canAi(auth.user.role) || aiOk === false} onChange={(e: { target: { checked: boolean } }) => setUseAi(e.target.checked)} /> Use the AI service (free wording, design advice)</label>
        <button className="primary" disabled={busy || !q.trim() || p.readOnly} onClick={() => void ask()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </div>
      {!useAi && <p className="muted small">Without AI, the built-in reader understands common instructions and never guesses missing sizes.</p>}
      {plan && (
        <div className="st-plan">
          <p><b>{plan.from}:</b> {plan.reply}</p>
          {!!plan.questions.length && <div className="st-q"><b>Questions:</b><ul>{plan.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {!!steps.length && <>
            <b>Proposed changes (green in the drawing, red = removed). Untick to leave one out; numbers can be edited:</b>
            <ul className="st-steps">{steps.map((s, i) => (
              <li key={i} className={results[chosen.indexOf(s)]?.ok === false ? 'bad' : ''}>
                <label className="chk"><input type="checkbox" checked={!!on[i]} onChange={(e: { target: { checked: boolean } }) => { const f = on.map((x, j) => (j === i ? e.target.checked : x)); setOn(f); preview(plan, f); }} /> {s.why || s.action.type}{s.critical && <em className="warn"> (safety-relevant)</em>}</label>
                <div className="st-nums">{Object.entries(s.action).filter(([k, v]) => typeof v === 'number' && k !== 'type').map(([k, v]) => <label key={k}>{k} <input className="st-small" type="number" value={v as number} onChange={(e: { target: { value: string } }) => editNum(i, k, Number(e.target.value))} /></label>)}</div>
                {on[i] && results[chosen.indexOf(s)] && !results[chosen.indexOf(s)].ok && <small className="err">{results[chosen.indexOf(s)].msg}</small>}
              </li>
            ))}</ul>
            {needCrit && <label className="chk warn"><input type="checkbox" checked={crit} onChange={(e: { target: { checked: boolean } }) => setCrit(e.target.checked)} /> I confirm the safety-relevant changes (sizes, thickness, material). This is my engineering decision, not the AI's.</label>}
            <div className="st-btns"><button className="primary" onClick={accept} disabled={!chosen.length || p.readOnly}>Accept selected</button><button onClick={reject}>Reject all</button></div>
          </>}
          {!!plan.suggestions.length && <div className="st-sug"><b>Suggestions (not an engineering approval):</b><ul>{plan.suggestions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {!!plan.dropped.length && <p className="muted small">Not allowed and ignored: {plan.dropped.join('; ')}</p>}
        </div>
      )}
      {!!doc.ai.length && <Section title={`Assistant history (${doc.ai.length})`} open={false}><ul className="st-list">{doc.ai.slice().reverse().slice(0, 30).map((a) => <li key={a.id}><span title={a.reply}>{new Date(a.at).toLocaleString()}: {a.prompt.slice(0, 80)} <small className="muted">({a.applied.length} applied, {a.rejected.length} rejected)</small></span></li>)}</ul></Section>}
    </div>
  );
}
