import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { MATERIALS } from '../data/materials.ts';
import { getFamily } from '../families/index.ts';
import { formatList, parseList } from '../families/custom/turned.ts';
import { outlineParams } from '../families/custom/custom.ts';
import { confidenceOf, steppedFromMask, turnedFromMask } from '../lib/trace.ts';
import type { Confidence } from '../lib/trace.ts';
import { saveProject } from '../storage/db.ts';
import { newId } from '../storage/project.ts';
import type { Params } from '../core/types.ts';
import { aiAnalyse, aiFile, aiJob, aiMesh, aiStatus, putUpload, useAuth } from '../cloud/client.ts';
import type { AiStatus } from '../cloud/client.ts';
import type { AiAnalysis } from '../../api/_lib/aiShapes.ts';
import { download } from '../exporters/index.ts';
import { go } from '../ui/router.ts';
import { toast } from '../ui/Toast.tsx';
import { loadPicture, maskOf } from './imageCommon.ts';
import type { Loaded } from './imageCommon.ts';

/* ---------------- shared pieces ---------------- */
const num = (v: string): number => (v === '' ? NaN : parseFloat(v));

/** Picture chooser with the "sensitivity" controls. `children` shows controls of the mode. */
function usePicture() {
  const [pic, setPic] = useState<Loaded | null>(null);
  const [thr, setThr] = useState(60);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const choose = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg('');
    try { const p = await loadPicture(f); setPic(p); setThr(p.autoThr); setInvert(false); } catch (e) { const m = e instanceof Error ? e.message : 'Could not open the picture.'; setMsg(m); toast(m, 'err'); } finally { setBusy(false); }
  };
  const mask = useMemo(() => (pic ? maskOf(pic.raster, thr, invert) : null), [pic, thr, invert]);
  const conf = useMemo(() => (pic && mask ? confidenceOf(pic.raster, mask, thr) : null), [pic, mask, thr]);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setConfirmed(false); }, [pic, thr, invert]); // any change of picture or sensitivity needs a new confirmation
  return { pic, thr, setThr, invert, setInvert, busy, setBusy, msg, setMsg, choose, mask, conf, confirmed, setConfirmed };
}
type PicState = ReturnType<typeof usePicture>;

function PicControls({ s, sens = true }: { s: PicState; sens?: boolean }) {
  return (<>
    <label className="field"><span>1. Choose a picture</span><input type="file" accept="image/*" disabled={s.busy} onChange={(e) => { void s.choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {s.pic && sens && (<>
      <label className="field"><span>Sensitivity <em>({s.thr})</em></span><input type="range" min={5} max={250} value={s.thr} onChange={(e) => s.setThr(Number(e.target.value))} /><small>Raise it if shadows or background are included. Lower it if parts of the shape are missing.</small></label>
      <label className="field"><span>Part is lighter than the background</span><input type="checkbox" checked={s.invert} onChange={(e) => s.setInvert(e.target.checked)} /></label>
    </>)}
  </>);
}

/** Reading quality and the confirmation the person must tick before a part is created from a photo. */
export function ConfidenceBox({ conf, confirmed, onConfirm }: { conf: Confidence | null; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  if (!conf) return null;
  return (
    <div className={`box ${conf.level === 'high' ? 'info' : conf.level === 'medium' ? 'warn' : 'err'}`}>
      <b>Reading confidence: {conf.level === 'high' ? 'High' : conf.level === 'medium' ? 'Medium' : 'Low'} ({conf.score}/100)</b>
      <ul>{conf.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} /><span>I have checked these values against the real part or drawing. Values read from a picture are <b>not confirmed engineering values</b> until I confirm them.</span></label>
    </div>
  );
}

/** The picture with the part found in it shaded blue. */
function Preview({ pic, mask }: { pic: Loaded; mask: Uint8Array | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !mask) return;
    const { width: w, height: h } = pic.raster, ctx = cv.getContext('2d'); if (!ctx) return;
    const im = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) if (mask[i]) { im.data[i * 4] = 21; im.data[i * 4 + 1] = 101; im.data[i * 4 + 2] = 192; im.data[i * 4 + 3] = 90; }
    ctx.clearRect(0, 0, w, h); ctx.putImageData(im, 0, 0);
  }, [pic, mask]);
  return (
    <div className="imgprev" style={{ position: 'relative' }}>
      <img src={pic.url} alt="Your picture" style={{ width: '100%', display: 'block' }} />
      <canvas ref={ref} width={pic.raster.width} height={pic.raster.height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

/** Side view of the typed sections so the person can see at a glance whether they match the part. */
function ProfileSketch({ rows }: { rows: number[][] }) {
  const total = rows.reduce((a, r) => a + r[0], 0), maxD = Math.max(...rows.map((r) => r[1]));
  let x = 0;
  return (
    <svg viewBox={`${-total * 0.03} ${-maxD * 0.6} ${total * 1.06} ${maxD * 1.2}`} style={{ width: '100%', maxHeight: 160, background: '#f7fafc', border: '1px solid #d6dee8', borderRadius: 8 }} role="img" aria-label="Side view of the sections">
      {rows.map((r, i) => { const rx = x; x += r[0]; return <rect key={i} x={rx} y={-r[1] / 2} width={r[0]} height={r[1]} fill="#1565c022" stroke="#1565c0" vectorEffect="non-scaling-stroke" />; })}
      <line x1={0} x2={total} y1={0} y2={0} stroke="#999" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

async function savePart(familyId: string, params: Params, name: string, pic: Loaded | null, loggedIn: boolean): Promise<void> {
  const fam = getFamily(familyId); if (!fam) throw new Error('Component type missing.');
  const calc = fam.calculate(params);
  if (!calc.ok) throw new Error(`The values cannot be used: ${calc.errors.join(' ')}`);
  const now = new Date().toISOString(), id = newId(), title = name.trim() || 'Part from picture';
  await saveProject({ id, name: title, familyId, params, revision: 'A', createdAt: now, updatedAt: now });
  if (loggedIn && pic && pic.base64.length < 2_900_000) { try { await putUpload(`u_${id}`, title, pic.mime, pic.base64, id); } catch { toast('Design saved, but the picture could not be stored.', 'info'); } }
  toast('Part created. You can change every value in the designer.', 'ok');
  go(`designer/${familyId}?project=${id}`);
}
const MatSelect = ({ v, set }: { v: string; set: (v: string) => void }) => <label className="field"><span>Material</span><select value={v} onChange={(e) => set(e.target.value)}>{MATERIALS.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>;

/* ---------------- turned part ---------------- */
export function TurnedMode() {
  const s = usePicture(), auth = useAuth();
  const [axis, setAxis] = useState<'x' | 'y'>('x');
  const [ref, setRef] = useState<'length' | 'diameter'>('length');
  const [mm, setMm] = useState(100);
  const [bore, setBore] = useState(0);
  const [mat, setMat] = useState('C45 Steel');
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const r = useMemo(() => (s.pic && s.mask && mm > 0 ? turnedFromMask(s.mask, s.pic.raster.width, s.pic.raster.height, axis, ref, mm) : null), [s.pic, s.mask, axis, ref, mm]);
  const auto = r && !('error' in r) ? formatList(r.sections.map((x) => [x.length, x.diameter])) : '';
  useEffect(() => { setEdit(null); }, [auto]);
  const text = edit ?? auto, parsed = parseList(text, 2, 'section', 12);
  useEffect(() => { if (s.pic) setName(s.pic.name); }, [s.pic]);
  const create = () => { s.setBusy(true); s.setMsg(''); savePart('custom_turned', { ...getFamily('custom_turned')!.defaults, sections: text, bore, material: mat }, name, s.pic, !!auth.user).catch((e) => { const m = e instanceof Error ? e.message : String(e); s.setMsg(m); toast(m, 'err'); }).finally(() => s.setBusy(false)); };
  return (
    <div className="imgwrap">
      <section className="panel">
        <div className="box info">Take the photo from the side with the shaft or roller lying <b>horizontal (or vertical)</b>, on a plain background. The app reads the thickness along the part and makes a stepped, revolved 3D model. Round holes, keyways and threads cannot be seen this way; the bore is typed.</div>
        <PicControls s={s} />
        {s.pic && (<>
          <label className="field"><span>Part direction in the picture</span><select value={axis} onChange={(e) => setAxis(e.target.value as 'x' | 'y')}><option value="x">Lying left to right</option><option value="y">Standing top to bottom</option></select></label>
          <h3>2. Real size</h3>
          <label className="field"><span>Which measurement do you know?</span><select value={ref} onChange={(e) => setRef(e.target.value as 'length' | 'diameter')}><option value="length">Overall length</option><option value="diameter">Largest diameter</option></select></label>
          <label className="field"><span>Its real size <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(mm) ? mm : ''} onChange={(e) => setMm(num(e.target.value))} /></label>
          <label className="field"><span>Bore through the middle <em>(mm, 0 = solid)</em></span><input type="number" min={0} step={0.1} value={Number.isFinite(bore) ? bore : ''} onChange={(e) => setBore(num(e.target.value))} /></label>
          <MatSelect v={mat} set={setMat} />
          <label className="field"><span>3. Check or correct the sections <em>(length,diameter; ...)</em></span><textarea rows={5} value={text} onChange={(e) => setEdit(e.target.value)} /><small>These were read from the picture. Type the real values where you know them better.</small></label>
          <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <ConfidenceBox conf={s.conf} confirmed={s.confirmed} onConfirm={s.setConfirmed} />
          <div className="actions"><button className="primary" disabled={s.busy || !s.confirmed || typeof parsed === 'string' || !(bore >= 0)} onClick={create}>Create drawing and 3D model</button></div>
          {typeof parsed === 'string' && <div className="box warn">{parsed}</div>}
        </>)}
        {s.msg && <div className="box err">{s.msg}</div>}
        {r && 'error' in r && <div className="box warn">{r.error}</div>}
      </section>
      <section>
        {!s.pic && <div className="box big">No picture yet. Choose one on the left.</div>}
        {s.pic && <Preview pic={s.pic} mask={s.mask} />}
        {Array.isArray(parsed) && <><p className="muted">Profile that will be made ({parsed.length} section(s)):</p><ProfileSketch rows={parsed} /></>}
      </section>
    </div>
  );
}

/* ---------------- stepped block ---------------- */
export function SteppedMode() {
  const s = usePicture(), auth = useAuth();
  const [ref, setRef] = useState<'height' | 'width'>('height');
  const [mm, setMm] = useState(60);
  const [depthMode, setDepthMode] = useState<'square' | 'fixed'>('square');
  const [depth, setDepth] = useState(50);
  const [hole, setHole] = useState(0);
  const [mat, setMat] = useState('S235 Steel');
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const r = useMemo(() => (s.pic && s.mask && mm > 0 ? steppedFromMask(s.mask, s.pic.raster.width, s.pic.raster.height, ref, mm) : null), [s.pic, s.mask, ref, mm]);
  const auto = r && !('error' in r) ? formatList(r.slabs.map((x) => [x.width, depthMode === 'square' ? x.width : depth, x.height])) : '';
  useEffect(() => { setEdit(null); }, [auto]);
  const text = edit ?? auto, parsed = parseList(text, 3, 'block', 8);
  useEffect(() => { if (s.pic) setName(s.pic.name); }, [s.pic]);
  const create = () => { s.setBusy(true); s.setMsg(''); savePart('custom_stepped', { ...getFamily('custom_stepped')!.defaults, slabs: text, holeDia: hole, material: mat }, name, s.pic, !!auth.user).catch((e) => { const m = e instanceof Error ? e.message : String(e); s.setMsg(m); toast(m, 'err'); }).finally(() => s.setBusy(false)); };
  return (
    <div className="imgwrap">
      <section className="panel">
        <div className="box info">Take a photo straight from the <b>front</b> of the block, on a plain background. The app finds each step (width and height). A front photo cannot show the depth, so you give it (or choose "square" = depth equals width). Edit the list if a block is different.</div>
        <PicControls s={s} />
        {s.pic && (<>
          <h3>2. Real size</h3>
          <label className="field"><span>Which measurement do you know?</span><select value={ref} onChange={(e) => setRef(e.target.value as 'height' | 'width')}><option value="height">Overall height</option><option value="width">Widest block</option></select></label>
          <label className="field"><span>Its real size <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(mm) ? mm : ''} onChange={(e) => setMm(num(e.target.value))} /></label>
          <label className="field"><span>Depth (front to back)</span><select value={depthMode} onChange={(e) => setDepthMode(e.target.value as 'square' | 'fixed')}><option value="square">Same as each block's width (square)</option><option value="fixed">One fixed depth for all</option></select></label>
          {depthMode === 'fixed' && <label className="field"><span>Depth <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(depth) ? depth : ''} onChange={(e) => setDepth(num(e.target.value))} /></label>}
          <label className="field"><span>Centre hole through all blocks <em>(mm, 0 = none)</em></span><input type="number" min={0} step={0.1} value={Number.isFinite(hole) ? hole : ''} onChange={(e) => setHole(num(e.target.value))} /></label>
          <MatSelect v={mat} set={setMat} />
          <label className="field"><span>3. Check or correct the blocks <em>(width,depth,height; bottom first)</em></span><textarea rows={5} value={text} onChange={(e) => setEdit(e.target.value)} /></label>
          <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <ConfidenceBox conf={s.conf} confirmed={s.confirmed} onConfirm={s.setConfirmed} />
          <div className="actions"><button className="primary" disabled={s.busy || !s.confirmed || typeof parsed === 'string' || !(hole >= 0)} onClick={create}>Create drawing and 3D model</button></div>
          {typeof parsed === 'string' && <div className="box warn">{parsed}</div>}
        </>)}
        {s.msg && <div className="box err">{s.msg}</div>}
        {r && 'error' in r && <div className="box warn">{r.error}</div>}
      </section>
      <section>
        {!s.pic && <div className="box big">No picture yet. Choose one on the left.</div>}
        {s.pic && <Preview pic={s.pic} mask={s.mask} />}
      </section>
    </div>
  );
}

/* ---------------- AI helper ---------------- */
const matFor = (t: string): string => (/stainless/.test(t) ? 'SS 304' : /alumin/.test(t) ? 'Al 6061-T6' : /plastic/.test(t) ? 'UHMW-PE' : 'S235 Steel');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Turns the AI's relative numbers into real values from one typed measurement, and the matching family + parameters. */
function fromAnalysis(a: AiAnalysis, mm: number): { familyId: string; params: Params; summary: string } | string {
  const mat = matFor(a.material);
  if (a.kind === 'turned' && a.turned) {
    const tot = a.turned.sections.reduce((x, y) => x + y.length, 0), s = mm / tot, r2 = (v: number) => +(v * s).toFixed(2);
    const rows = a.turned.sections.map((x) => [r2(x.length), r2(x.diameter)]);
    return { familyId: 'custom_turned', params: { ...getFamily('custom_turned')!.defaults, sections: formatList(rows), bore: r2(a.turned.bore), material: mat }, summary: `Turned part, ${rows.length} section(s), overall length ${mm} mm` };
  }
  if (a.kind === 'stepped' && a.stepped) {
    const hTot = a.stepped.slabs.reduce((x, y) => x + y.height, 0), s = mm / hTot, r2 = (v: number) => +(v * s).toFixed(2);
    return { familyId: 'custom_stepped', params: { ...getFamily('custom_stepped')!.defaults, slabs: formatList(a.stepped.slabs.map((x) => [r2(x.width), r2(x.depth), r2(x.height)])), holeDia: 0, material: mat }, summary: `Stepped block, ${a.stepped.slabs.length} block(s), overall height ${mm} mm` };
  }
  if (a.kind === 'flat' && a.flat) {
    const xs = a.flat.outline.map((p) => p[0]), ys = a.flat.outline.map((p) => p[1]), x0 = Math.min(...xs), y1 = Math.max(...ys), longest = Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys));
    if (!(longest > 0)) return 'The AI outline has no size.';
    const s = mm / longest, P = (p: [number, number]): [number, number] => [+((p[0] - x0) * s).toFixed(2), +((y1 - p[1]) * s).toFixed(2)];
    return { familyId: 'custom_outline', params: outlineParams({ outline: a.flat.outline.map(P), cutouts: [], holes: a.flat.holes.map((h) => ({ c: P([h[0], h[1]]), r: +((h[2] / 2) * s).toFixed(2) })) }, 6, mat), summary: `Flat part, longest side ${mm} mm, thickness 6 mm (change it in the designer)` };
  }
  return 'The AI could not tell the part type. Use one of the other tabs.';
}

export function AiMode() {
  const s = usePicture(), auth = useAuth();
  const [st, setSt] = useState<AiStatus | null>(null);
  const [res, setRes] = useState<{ provider: string; analysis: AiAnalysis } | null>(null);
  const [mm, setMm] = useState(100);
  const [name, setName] = useState('');
  const [glb, setGlb] = useState<string | null>(null);
  const [meshNote, setMeshNote] = useState('');
  const [meshMm, setMeshMm] = useState(100);
  useEffect(() => { if (auth.user) aiStatus().then(setSt).catch(() => setSt(null)); else setSt(null); }, [auth.user]);
  useEffect(() => { if (s.pic) { setName(s.pic.name); setRes(null); setGlb(null); } }, [s.pic]);

  const run = async (fn: () => Promise<void>) => { s.setBusy(true); s.setMsg(''); try { await fn(); } catch (e) { const m = e instanceof Error ? e.message : String(e); s.setMsg(m); toast(m, 'err'); } finally { s.setBusy(false); setMeshNote(''); } };
  const analyse = () => run(async () => { if (!s.pic) return; const r = await aiAnalyse(s.pic.mime, s.pic.base64); setRes(r); if (r.analysis.name) setName(r.analysis.name); });
  const mesh = () => run(async () => {
    if (!s.pic) return;
    setMeshNote('Sending the picture to the AI...');
    const r = await aiMesh(s.pic.mime, s.pic.base64);
    if (r.glb) { setGlb(r.glb); return; }
    if (!r.jobId) throw new Error('The AI did not return a model.');
    for (let i = 0; i < 90; i++) {
      await sleep(4000);
      const j = await aiJob(r.jobId);
      setMeshNote(`The AI is building the model... ${Math.round(j.progress)}%`);
      if (j.status === 'SUCCEEDED' && j.glbUrl) { setGlb((await aiFile(j.glbUrl)).glb); return; }
      if (j.status === 'FAILED' || j.status === 'CANCELED') throw new Error('The AI could not build a model from this picture.');
    }
    throw new Error('The AI took too long. Try again later.');
  });
  const made = res ? fromAnalysis(res.analysis, mm) : null;
  const create = () => { if (!made || typeof made === 'string') return; s.setBusy(true); savePart(made.familyId, made.params, name, s.pic, !!auth.user).catch((e) => { const m = e instanceof Error ? e.message : String(e); s.setMsg(m); toast(m, 'err'); }).finally(() => s.setBusy(false)); };

  if (!auth.ready) return <p className="muted">Loading...</p>;
  if (!auth.configured || !auth.user) return <div className="box warn">The AI helper needs the cloud database and a signed-in account, because the AI keys are kept safely on the server. <a href="#/account">Sign in</a>. {auth.configured ? '' : 'The cloud database is not connected on this website (see the setup guide).'}</div>;
  const none = st && !st.vision.length && !st.mesh.length;
  return (
    <div className="imgwrap">
      <section className="panel">
        <div className="box info">AI suggestions use the AI services your administrator switched on in <b>Settings &gt; AI services</b>. {st ? `On now: ${[...st.vision, ...st.mesh].join(', ') || 'none'}.` : ''} {none && 'Nothing is switched on yet.'} The AI only suggests the shape and proportions: the real size always comes from the measurement <b>you</b> type.</div>
        <PicControls s={s} sens={false} />
        {s.pic && (<>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <button className="primary" disabled={s.busy || !st?.vision.length} onClick={() => void analyse()}>Recognise the part (AI)</button>
            <button disabled={s.busy || !st?.mesh.length} onClick={() => void mesh()}>Build a 3D mesh (AI)</button>
          </div>
          {meshNote && <p className="muted">{meshNote}</p>}
          {res && (<>
            <h3>AI reading ({res.provider})</h3>
            <p><b>{res.analysis.name}</b> · type: {res.analysis.kind === 'other' ? 'not recognised' : res.analysis.kind} · material guess: {res.analysis.material || 'unknown'}</p>
            {res.analysis.notes && <p className="muted">{res.analysis.notes}</p>}
            {typeof made === 'string' ? <div className="box warn">{made}</div> : made && (<>
              <label className="field"><span>{res.analysis.kind === 'turned' ? 'Real overall length' : res.analysis.kind === 'stepped' ? 'Real overall height' : 'Real longest side'} <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(mm) ? mm : ''} onChange={(e) => setMm(num(e.target.value))} /></label>
              <p className="muted">Will create: {made.summary}. Every value can be edited in the designer.</p>
              <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
              <div className="actions"><button className="primary" disabled={s.busy || !(mm > 0)} onClick={create}>Create drawing and 3D model from this</button></div>
            </>)}
          </>)}
        </>)}
        {s.msg && <div className="box err">{s.msg}</div>}
      </section>
      <section>
        {!s.pic && <div className="box big">No picture yet. Choose one on the left.</div>}
        {s.pic && !glb && <Preview pic={s.pic} mask={null} />}
        {glb && (<>
          <label className="field"><span>Real size of the longest side of the mesh <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(meshMm) ? meshMm : ''} onChange={(e) => setMeshMm(num(e.target.value))} /></label>
          <MeshViewer glb={glb} sizeMm={meshMm > 0 ? meshMm : 100} name={name || 'mesh'} />
          <p className="muted">This is an AI-made <b>mesh</b> (a shell of triangles), not an editable CAD part. Use it to look at the part from every angle and as an STL / GLB file. For a drawing with exact editable values use the other tabs.</p>
        </>)}
      </section>
    </div>
  );
}

/* ---------------- mesh viewer (all angles) ---------------- */
type V = 'iso' | 'face' | 'back' | 'side' | 'left' | 'top' | 'bottom';
function MeshRig({ cmd, size }: { cmd: { v: V; n: number }; size: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    const d = size * 2.3, pos: Record<V, [number, number, number]> = { face: [0, 0, d], side: [d, 0, 0], top: [0, d, 0], iso: [d * 0.7, d * 0.55, d * 0.85], back: [0, 0, -d], left: [-d, 0, 0], bottom: [0, -d, 0] };
    camera.position.set(...pos[cmd.v]);
    camera.up.set(0, cmd.v === 'top' || cmd.v === 'bottom' ? 0 : 1, cmd.v === 'top' ? -1 : cmd.v === 'bottom' ? 1 : 0);
    camera.lookAt(0, 0, 0); camera.far = size * 60; camera.updateProjectionMatrix();
    if (controls) { controls.target.set(0, 0, 0); controls.update(); }
  }, [cmd, size, camera, controls]);
  return null;
}
const LABEL: Record<V, string> = { iso: 'Isometric', face: 'Front', back: 'Back', side: 'Right', left: 'Left', top: 'Top', bottom: 'Bottom' };

function MeshViewer({ glb, sizeMm, name }: { glb: string; sizeMm: number; name: string }) {
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const [err, setErr] = useState('');
  const [cmd, setCmd] = useState<{ v: V; n: number }>({ v: 'iso', n: 0 });
  useEffect(() => {
    setErr('');
    try {
      const bin = atob(glb), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      new GLTFLoader().parse(buf.buffer as ArrayBuffer, '', (g) => setRoot(g.scene), () => setErr('The 3D file could not be read.'));
    } catch { setErr('The 3D file could not be read.'); }
  }, [glb]);
  /** centred on the origin and scaled so the longest side equals the typed real size (mm) */
  const scaled = useMemo(() => {
    if (!root) return null;
    const g = new THREE.Group(), obj = root.clone(true), box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = sizeMm / Math.max(size.x, size.y, size.z, 1e-9);
    obj.position.sub(c); g.add(obj); g.scale.setScalar(k); g.updateMatrixWorld(true);
    return { g, dims: [size.x * k, size.y * k, size.z * k] as [number, number, number] };
  }, [root, sizeMm]);
  if (err) return <div className="box err">{err}</div>;
  if (!scaled) return <p className="muted">Loading the 3D model...</p>;
  const exportGlb = () => new GLTFExporter().parse(scaled.g, (r) => download({ name: `${name}.glb`, blob: new Blob([r as ArrayBuffer], { type: 'model/gltf-binary' }) } as Parameters<typeof download>[0]), () => toast('Could not export the GLB.', 'err'), { binary: true });
  const exportStl = () => download({ name: `${name}.stl`, blob: new Blob([new STLExporter().parse(scaled.g, { binary: true }) as unknown as BlobPart], { type: 'model/stl' }) } as Parameters<typeof download>[0]);
  return (
    <div className="viewer">
      <div className="toolbar"><div className="seg">{(Object.keys(LABEL) as V[]).map((v) => <button key={v} onClick={() => setCmd({ v, n: Date.now() })}>{LABEL[v]}</button>)}</div></div>
      <div className="canvas-wrap">
        <Canvas gl={{ alpha: true }} camera={{ fov: 40, near: 0.1 }}>
          <hemisphereLight args={['#ffffff', '#8892a0', 1.1]} />
          <directionalLight position={[sizeMm, sizeMm * 2, sizeMm * 3]} intensity={2} />
          <MeshRig cmd={cmd} size={sizeMm} />
          <primitive object={scaled.g} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
        <div className="hint">Size {scaled.dims.map((d) => d.toFixed(1)).join(' x ')} mm (X x Y x Z) · drag = rotate · wheel = zoom</div>
      </div>
      <div className="actions"><button onClick={exportGlb}>Download GLB</button><button onClick={exportStl}>Download STL</button></div>
    </div>
  );
}
