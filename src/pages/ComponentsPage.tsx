import { useMemo, useState } from 'react';
import { FAMILIES, getFamily } from '../families/index.ts';
import { CATEGORIES } from '../data/catalogue.ts';
import { MATERIALS } from '../data/materials.ts';
import { searchCatalogue, getRecent } from '../lib/search.ts';
import { SearchBox } from '../ui/SearchBox.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { Preview } from '../ui/Preview.tsx';
import { go } from '../ui/router.ts';

export function ComponentsPage({ query }: { query: URLSearchParams }) {
  const [q, setQ] = useState(query.get('q') ?? '');
  const [applied, setApplied] = useState(query.get('q') ?? '');
  const [cat, setCat] = useState(query.get('cat') ?? '');
  const [mat, setMat] = useState('');
  const res = useMemo(() => searchCatalogue(FAMILIES, applied, { category: cat || undefined, material: mat || undefined }), [applied, cat, mat]);
  const recent = getRecent().map(getFamily).filter((f): f is NonNullable<typeof f> => !!f);
  const total = CATEGORIES.reduce((a, c) => a + c.items.length, 0);
  return (
    <div className="page">
      <PageHeader title="Component library" subtitle="Search by name, part number, material, standard or size. Open any component to design it." />
      <SearchBox value={q} onChange={setQ} onSubmit={setApplied} />
      <div className="filters">
        <label>Category <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id} - {c.name}</option>)}</select></label>
        <label>Material <select value={mat} onChange={(e) => setMat(e.target.value)}><option value="">Any</option>{MATERIALS.map((m) => <option key={m.id}>{m.id}</option>)}</select></label>
        {recent.length > 0 && <span className="muted">Recently used: {recent.map((f) => <a key={f.id} href={`#/designer/${f.id}`}>{f.name}</a>)}</span>}
      </div>
      <p className="muted">{res.hits.length} implemented component families, {res.hits.reduce((a, h) => a + h.variantCount, 0)} matching variants. Library tracks {total} catalogue items; the rest are listed below as planned.</p>
      <div className="cards">
        {res.hits.map(({ family: f, variants, variantCount }) => (
          <article key={f.id} className="card">
            <Preview family={f} />
            <div className="card-body">
              <h3>{f.name}</h3>
              <div className="muted">Category {f.category} - {CATEGORIES.find((c) => c.id === f.category)?.name} / {f.subcategory}</div>
              <p>{f.description}</p>
              <div className="muted"><b>Materials:</b> {f.materials.join(', ')}</div>
              <div className="muted"><b>Standards:</b> {f.standards.join(', ')}</div>
              <div className="chips">{variants.map((v) => <a key={v.id} className="chip" href={`#/designer/${f.id}?variant=${encodeURIComponent(v.id)}`} title={v.name}>{v.id}</a>)}{variantCount > variants.length && <span className="muted"> +{variantCount - variants.length} more variants</span>}</div>
              <div className="actions"><button className="primary" onClick={() => go(`designer/${f.id}`)}>Design</button>
                {f.related.map((r) => { const rf = getFamily(r); return rf ? <a key={r} href={`#/designer/${r}`} className="related">Related: {rf.name}</a> : null; })}</div>
            </div>
          </article>
        ))}
        {!res.hits.length && <p>No implemented component matches this search.</p>}
      </div>
      {res.pending.length > 0 && (
        <details className="pending"><summary>Planned, not yet implemented ({res.pending.length})</summary>
          <p className="muted">These are in the component register but have no calculation or geometry yet, so there is no Design button.</p>
          <ul>{res.pending.map((p) => <li key={p.category + p.item}>{p.item} <span className="muted">(Category {p.category})</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}
