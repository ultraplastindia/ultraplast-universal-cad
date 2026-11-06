import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { MATERIALS } from '../data/materials.ts';
import { getFamily } from '../families/index.ts';
import { outlineParams } from '../families/custom/custom.ts';
import { autoThreshold, backgroundDistance, DEFAULT_TRACE, toMillimetres, traceImage } from '../lib/trace.ts';
import type { RefDim, Raster } from '../lib/trace.ts';
import { saveProject } from '../storage/db.ts';
import { newId } from '../storage/project.ts';
import { listUploads, putUpload, useAuth } from '../cloud/client.ts';
import type { UploadInfo } from '../cloud/client.ts';
import { go } from '../ui/router.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { toast } from '../ui/Toast.tsx';

const MAX_SIDE = 700;       // pictures are shrunk to this size before tracing (fast, and plenty for an outline)
const MAX_FILE = 15 * 1024 * 1024;

interface Loaded { raster: Raster; url: string; mime: string; base64: string; name: string; autoThr: number }

async function loadPicture(file: File): Promise<Loaded> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture file (JPG, PNG, WebP).');
  if (file.size > MAX_FILE) throw new Error('The picture is larger than 15 MB. Please use a smaller one.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened. Try saving it as JPG or PNG.'); });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser cannot read pictures here.');
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
  const raster: Raster = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
  const url = cv.toDataURL('image/webp', 0.85), mime = url.slice(5, url.indexOf(';'));
  return { raster, url, mime, base64: url.slice(url.indexOf(',') + 1), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Picture', autoThr: autoThreshold(backgroundDistance(raster).dist) };
}

export function ImagePage() {
  const auth = useAuth();
  const [pic, setPic] = useState<Loaded | null>(null);
  const [thr, setThr] = useState(DEFAULT_TRACE.threshold);
  const [invert, setInvert] = useState(false);
  const [smooth, setSmooth] = useState(DEFAULT_TRACE.smooth);
  const [tol, setTol] = useState(DEFAULT_TRACE.tolerance);
  const [ref, setRef] = useState<RefDim>('longest');
  const [mm, setMm] = useState(100);
  const [thick, setThick] = useState(6);
  const [mat, setMat] = useState('S235 Steel');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [uploads, setUploads] = useState<UploadInfo[]>([]);

  useEffect(() => { if (auth.user) listUploads().then(setUploads).catch(() => setUploads([])); else setUploads([]); }, [auth.user]);

  const opts = useDeferredValue({ threshold: thr, invert, smooth, tolerance: tol });
  const traced = useMemo(() => (pic ? traceImage(pic.raster, opts) : null), [pic, opts]);
  const result = traced && !('error' in traced) ? traced : null;
  const real = useMemo(() => (result && mm > 0 ? toMillimetres(result, ref, mm) : null), [result, ref, mm]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg('');
    try { const p = await loadPicture(f); setPic(p); setThr(p.autoThr); setInvert(false); setName(p.name); } catch (e) { const m = e instanceof Error ? e.message : 'Could not open the picture.'; setMsg(m); toast(m, 'err'); } finally { setBusy(false); }
  };

  const create = async () => {
    if (!pic || !real) return;
    const fam = getFamily('custom_outline');
    if (!fam) return;
    const params = outlineParams(real, thick, mat), calc = fam.calculate(params);
    if (!calc.ok) { const m = `The traced shape cannot be used: ${calc.errors.join(' ')}`; setMsg(m); toast(m, 'err'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString(), id = newId(), title = name.trim() || 'Traced part';
      await saveProject({ id, name: title, familyId: fam.id, params, revision: 'A', createdAt: now, updatedAt: now });
      if (auth.user) {
        try { if (pic.base64.length < 2_900_000) await putUpload(`u_${id}`, title, pic.mime, pic.base64, id); else toast('Design saved. The picture was too large to store, only the design was kept.', 'info'); } catch (e) { toast(`Design saved, but the picture could not be stored: ${e instanceof Error ? e.message : 'error'}`, 'info'); }
      }
      toast('Part created from the picture.', 'ok');
      go(`designer/${fam.id}?project=${id}`);
    } catch (e) { const m = `Could not save: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); toast(m, 'err'); } finally { setBusy(false); }
  };

  const pathD = result ? [result.outer, ...result.holes].map((l) => `M${l.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} Z`).join(' ') : '';
  return (
    <div className="page">
      <PageHeader title="Image to 3D" subtitle="Upload a picture of a part. The app traces its outline, you give one real size, and it creates the 2D drawing and 3D model." />
      <div className="box info"><b>How to get a good result</b>
        <ul>
          <li>Take the picture straight from the front or side (not at an angle), with the part lying flat on a plain, evenly lit background. A scan or a PNG with a transparent background works best.</li>
          <li>Enter <b>one real measurement</b> (for example the overall length). Everything else is scaled from it.</li>
          <li>A single picture shows only the outline, so the part is made by extruding that outline to the thickness you enter. Holes that are visible are kept. Hidden details, bends and depth cannot be known from one picture.</li>
          <li>Always check the size and shape against the real part. The result is PRELIMINARY.</li>
        </ul>
      </div>
      <div className="imgwrap">
        <section className="panel">
          <label className="field"><span>1. Choose a picture</span><input type="file" accept="image/*" disabled={busy} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {pic && (<>
            <label className="field"><span>2. Sensitivity <em>({thr})</em></span><input type="range" min={5} max={250} value={thr} onChange={(e) => setThr(Number(e.target.value))} /><small>Raise it if the outline includes shadows or background. Lower it if parts of the shape are missing.</small></label>
            <label className="field"><span>Part is lighter than the background</span><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /></label>
            <label className="field"><span>Smoothing <em>({smooth})</em></span><input type="range" min={0} max={4} step={1} value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} /></label>
            <label className="field"><span>Simplify outline <em>({tol.toFixed(1)} px)</em></span><input type="range" min={0.5} max={4} step={0.1} value={tol} onChange={(e) => setTol(Number(e.target.value))} /><small>Higher = fewer points and straighter edges.</small></label>
            <h3>3. Real size</h3>
            <label className="field"><span>Which measurement do you know?</span>
              <select value={ref} onChange={(e) => setRef(e.target.value as RefDim)}><option value="longest">Longest side of the shape</option><option value="width">Overall width (left to right in the picture)</option><option value="height">Overall height (top to bottom in the picture)</option></select></label>
            <label className="field"><span>Its real size <em>(mm)</em></span><input type="number" min={1} step={0.1} value={Number.isFinite(mm) ? mm : ''} onChange={(e) => setMm(e.target.value === '' ? NaN : parseFloat(e.target.value))} /></label>
            <label className="field"><span>Thickness <em>(mm)</em></span><input type="number" min={0.5} step={0.5} value={Number.isFinite(thick) ? thick : ''} onChange={(e) => setThick(e.target.value === '' ? NaN : parseFloat(e.target.value))} /></label>
            <label className="field"><span>Material</span><select value={mat} onChange={(e) => setMat(e.target.value)}>{MATERIALS.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>
            <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            <div className="actions"><button className="primary" disabled={busy || !real || !(thick >= 0.5)} onClick={() => void create()}>Create drawing and 3D model</button></div>
          </>)}
          {msg && <div className="box err">{msg}</div>}
          {traced && 'error' in traced && <div className="box warn">{traced.error}</div>}
          {result?.warnings.map((w) => <div key={w} className="box warn">{w}</div>)}
        </section>
        <section>
          {!pic && <div className="box big">No picture yet. Choose one on the left to see the traced outline here.</div>}
          {pic && (
            <div className="imgprev">
              <svg viewBox={`0 0 ${pic.raster.width} ${pic.raster.height}`} role="img" aria-label="Picture with the traced outline drawn on top">
                <rect width={pic.raster.width} height={pic.raster.height} fill="#fff" />
                <image href={pic.url} width={pic.raster.width} height={pic.raster.height} />
                {result && <path d={pathD} fill="#1565c033" fillRule="evenodd" stroke="#1565c0" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                {result?.round.map((q, i) => <circle key={i} cx={q.c[0]} cy={q.c[1]} r={q.r} fill="#f59e0b44" stroke="#b45309" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
              </svg>
              {result && real && (
                <p className="muted">Traced shape: <b>{real.lengthMm.toFixed(1)} x {real.widthMm.toFixed(1)} mm</b> ({result.outer.length} outline points, {result.round.length} round hole(s), {result.holes.length} other cut-out(s)). Blue = outline, orange = round holes.</p>
              )}
            </div>
          )}
        </section>
      </div>
      {auth.user && uploads.length > 0 && (
        <>
          <h2>Your earlier pictures</h2>
          <table className="tbl wide"><thead><tr><th>Name</th><th>Date</th><th /></tr></thead><tbody>
            {uploads.map((u) => <tr key={u.id}><td>{u.name}</td><td>{new Date(u.createdAt).toLocaleString()}</td><td>{u.designId ? <a href={`#/designer/custom_outline?project=${u.designId}`}>Open the part</a> : ''}</td></tr>)}
          </tbody></table>
        </>
      )}
    </div>
  );
}
