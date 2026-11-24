import { useEffect, useState } from 'react';
import type { Unit } from '../model.ts';
import { fmtLen, parseAngle, parseLen } from '../model.ts';

/** Event shapes used by the studio handlers: small structural types that fit both React's synthetic events and DOM events. */
export type KeyEv = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault(): void };
export type PtrEv = { pointerId: number; button: number; clientX: number; clientY: number; shiftKey: boolean; target: unknown; stopPropagation(): void; preventDefault(): void };

/** Number box that shows millimetres in the chosen unit and applies on Enter or when leaving the box. */
export function LenField({ label, mm, unit, onSet, min, max, title, disabled, kind = 'len' }: { label: string; mm: number; unit: Unit; onSet: (mm: number) => void; min?: number; max?: number; title?: string; disabled?: boolean; kind?: 'len' | 'deg' | 'count' | 'factor' }) {
  const show = () => (kind === 'len' ? fmtLen(mm, unit, 4) : String(+mm.toFixed(6)));
  const [t, setT] = useState(show);
  const [err, setErr] = useState('');
  useEffect(() => { setT(show()); setErr(''); }, [mm, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    const v = kind === 'len' ? parseLen(t, unit) : kind === 'deg' ? parseAngle(t) : Number(t.replace(',', '.'));
    if (v === null || !Number.isFinite(v)) { setErr('Enter a number'); return; }
    if (kind === 'count' && !Number.isInteger(v)) { setErr('Whole number'); return; }
    if (min !== undefined && v < min - 1e-12) { setErr(`Min ${kind === 'len' ? fmtLen(min, unit) : min}`); return; }
    if (max !== undefined && v > max + 1e-12) { setErr(`Max ${kind === 'len' ? fmtLen(max, unit) : max}`); return; }
    setErr('');
    if (Math.abs(v - mm) > 1e-12) onSet(v);
  };
  return (
    <label className={`st-field${err ? ' bad' : ''}`} title={title}>
      <span>{label}</span>
      <span className="st-in"><input value={t} disabled={disabled} inputMode="decimal" onChange={(e: { target: { value: string } }) => setT(e.target.value)} onBlur={apply} onKeyDown={(e: KeyEv) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') setT(show()); }} aria-invalid={!!err} />
        <small>{kind === 'len' ? unit : kind === 'deg' ? '°' : kind === 'factor' ? '×' : ''}</small></span>
      {err && <em>{err}</em>}
    </label>
  );
}
export function Section({ title, children, open = true, right }: { title: string; children?: unknown; open?: boolean; right?: unknown }) {
  return <details className="st-sec" open={open}><summary><span>{title}</span>{right as never}</summary><div className="st-sec-body">{children as never}</div></details>;
}
