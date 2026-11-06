import { useMemo, useState } from 'react';
import { FAMILIES } from '../families/index.ts';
import { suggest } from '../lib/search.ts';

export function SearchBox({ value, onChange, onSubmit, big, compact, id, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; big?: boolean; compact?: boolean; id?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const sug = useMemo(() => suggest(FAMILIES, value), [value]);
  return (
    <div className={`searchbox${big ? ' big' : ''}${compact ? ' compact' : ''}`}>
      <input id={id} placeholder={placeholder ?? 'Search components: sprocket, shaft, bearing 6205, 08B-1, C45 Steel ...'} value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(false); onSubmit(value); } if (e.key === 'Escape') setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => setOpen(true)} aria-label="Search components" autoComplete="off" />
      {!compact && <button onClick={() => { setOpen(false); onSubmit(value); }}>Search</button>}
      {open && sug.length > 0 && <ul className="suggest">{sug.map((s) => <li key={s} onMouseDown={() => { onChange(s); setOpen(false); onSubmit(s); }}>{s}</li>)}</ul>}
    </div>
  );
}
