import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, Sheet } from '../cad2d/sheet.ts';
import { describeEnt, pickEntity } from '../cad2d/pick.ts';
import { entSvg, logoElement, sheetSvgInner } from '../exporters/svg.ts';

interface VB { x: number; y: number; w: number; h: number }

export function DrawingWorkspace({ sheet, onEdit }: { sheet: Sheet; onEdit?: (key: string, value: number) => void }) {
  const full: VB = { x: 0, y: 0, w: sheet.w, h: sheet.h };
  const [vb, setVb] = useState<VB>(full);
  const [show, setShow] = useState({ dim: true, centre: true, hidden: true, hatch: true, grid: false });
  const [measure, setMeasure] = useState(false);
  const [pts, setPts] = useState<[number, number][]>([]);
  const [selIdx, setSelIdx] = useState(-1);
  const [editVal, setEditVal] = useState('');
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: VB; moved: boolean } | null>(null);

  const hide = useMemo(() => { const h = new Set<Layer>(); (['dim', 'centre', 'hidden', 'hatch'] as const).forEach((k) => { if (!show[k]) h.add(k); }); return h; }, [show]);
  const inner = useMemo(() => sheetSvgInner(sheet, { hide, grid: show.grid }), [sheet, hide, show.grid]);
  const logo = useMemo(() => logoElement(sheet, '/assets/Logo.png'), [sheet]);
  const sel = selIdx >= 0 ? sheet.ents[selIdx] : undefined;
  const selSvg = useMemo(() => (sel ? entSvg(sel, '#f97316', 0.9) : ''), [sel]);
  useEffect(() => { setSelIdx(-1); }, [sheet]);
  useEffect(() => { setEditVal(sel && sel.t === 'text' && sel.edit ? String(sel.edit.value) : ''); }, [sel]);

  const toView = (cx: number, cy: number, v: VB) => { const r = ref.current!.getBoundingClientRect(); return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h }; };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setVb((v) => { const k = e.deltaY > 0 ? 1.15 : 1 / 1.15, w = Math.min(sheet.w * 1.5, Math.max(8, v.w * k)), h = w * (sheet.h / sheet.w), p = toView(e.clientX, e.clientY, v);
        return { x: p.x - ((p.x - v.x) / v.w) * w, y: p.y - ((p.y - v.y) / v.h) * h, w, h }; });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [sheet]);

  const down = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const r = ref.current!.getBoundingClientRect(), dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setVb({ ...d.vb, x: d.vb.x - (dx / r.width) * d.vb.w, y: d.vb.y - (dy / r.height) * d.vb.h });
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved) return;
    const p = toView(e.clientX, e.clientY, vb), sx = p.x, sy = sheet.h - p.y;
    if (measure) setPts((a) => (a.length >= 2 ? [[sx, sy]] : [...a, [sx, sy]]));
    else setSelIdx(pickEntity(sheet.ents, sx, sy, 0.8 + (vb.w / sheet.w) * 1.6));
  };
  const dist = pts.length === 2 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) / sheet.scale : null;
  const flag = (k: keyof typeof show, label: string) => <label className="chk"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {label}</label>;
  const zoom = (k: number) => setVb((v) => { const w = Math.min(sheet.w * 1.5, Math.max(8, v.w * k)), h = w * (sheet.h / sheet.w); return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }; });
  const editable = sel && sel.t === 'text' && sel.edit && onEdit;
  const apply = () => { const v = parseFloat(editVal); if (sel && sel.t === 'text' && sel.edit && Number.isFinite(v)) onEdit?.(sel.edit.key, v); };

  return (
    <div className="drawing">
      <div className="toolbar">
        <div className="seg"><button onClick={() => setVb(full)}>Reset view</button><button onClick={() => zoom(1 / 1.4)}>Zoom +</button><button onClick={() => zoom(1.4)}>Zoom −</button></div>
        {flag('dim', 'Dimensions')}{flag('centre', 'Centre lines')}{flag('hidden', 'Hidden lines')}{flag('hatch', 'Hatching')}{flag('grid', 'Grid')}
        <label className="chk"><input type="checkbox" checked={measure} onChange={(e) => { setMeasure(e.target.checked); setPts([]); setSelIdx(-1); }} /> Measure</label>
        <span className="muted">Scale {sheet.scaleLabel}{measure ? (dist !== null ? ` · distance ${dist.toFixed(3)} mm` : ' · click two points') : ''}</span>
      </div>
      <div className="selbar">
        {!measure && !sel && <span className="muted">Click any line, circle or dimension to select it. Click a dimension marked <b>editable</b> to change it.</span>}
        {sel && <span><b>Selected:</b> {describeEnt(sel)}</span>}
        {editable && sel.t === 'text' && sel.edit && (
          <span className="editrow">Edit <code>{sel.edit.key}</code>: <input type="number" step="any" value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /><button className="primary" onClick={apply}>Apply</button></span>
        )}
        {sel && sel.t === 'text' && !sel.edit && /\d/.test(sel.s) && <span className="muted"> This value is calculated, so it is changed through the other parameters.</span>}
      </div>
      <svg ref={ref} className="sheet" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} style={{ cursor: measure ? 'crosshair' : 'pointer', touchAction: 'none' }}>
        <rect width={sheet.w} height={sheet.h} fill="#fff" />
        <g transform={`translate(0,${sheet.h}) scale(1,-1)`} dangerouslySetInnerHTML={{ __html: inner }} />
        <g transform={`translate(0,${sheet.h}) scale(1,-1)`} dangerouslySetInnerHTML={{ __html: selSvg }} />
        <g dangerouslySetInnerHTML={{ __html: logo }} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={sheet.h - p[1]} r={1.2} fill="#d9480f" />)}
        {pts.length === 2 && <line x1={pts[0][0]} y1={sheet.h - pts[0][1]} x2={pts[1][0]} y2={sheet.h - pts[1][1]} stroke="#d9480f" strokeWidth={0.4} />}
      </svg>
    </div>
  );
}
