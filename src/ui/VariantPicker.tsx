import { useMemo, useState } from 'react';

/** Searchable list for picking one of many ready-made variants (part number or size). */
export function VariantPicker({ variants, onPick, label = 'Find a ready-made size' }: { variants: { id: string; name: string }[]; onPick: (id: string) => void; label?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    return variants.filter((v) => t.every((x) => `${v.id} ${v.name}`.toLowerCase().includes(x))).slice(0, 40);
  }, [variants, q]);
  return (
    <div className="picker">
      <label className="field"><span>{label} <em>({variants.length})</em></span>
        <input value={q} placeholder="Type a part number or size, e.g. 08B 17 or 6205" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </label>
      {open && (
        <ul className="picklist">
          {list.map((v) => <li key={v.id} onMouseDown={() => { onPick(v.id); setQ(''); setOpen(false); }}><b>{v.id}</b><span className="muted"> {v.name}</span></li>)}
          {!list.length && <li className="muted">No variant matches. Use the parameters below for any custom size.</li>}
        </ul>
      )}
    </div>
  );
}
