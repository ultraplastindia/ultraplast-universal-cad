import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES } from '../data/catalogue.ts';
import { FAMILIES, getFamily } from '../families/index.ts';
import { baseLabel, builtinTypes, mergeTypes, slug } from '../data/typeLibrary.ts';
import type { ComponentType } from '../data/typeLibrary.ts';
import { deleteType, listTypes, putTypes, useAuth } from '../cloud/client.ts';
import { go } from '../ui/router.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { ParamForm } from '../ui/ParamForm.tsx';
import { toast } from '../ui/Toast.tsx';
import type { Params } from '../core/types.ts';

const readList = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const writeList = (k: string, v: string[]): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: favourites just are not remembered */ } };

const KIND_LABEL = { dedicated: 'Engineering model', value: 'Value-based shape', assembly: 'Assembly' } as const;
interface Draft { id: string | null; name: string; category: string; base: string; params: Params; note: string }

export function TypesPage() {
  const auth = useAuth();
  const builtin = useMemo(builtinTypes, []);
  const [dbTypes, setDbTypes] = useState<ComponentType[]>([]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [favs, setFavs] = useState<string[]>(() => readList('ultraplast.favTypes'));
  const [recent, setRecent] = useState<string[]>(() => readList('ultraplast.recentTypes'));
  const [onlyFav, setOnlyFav] = useState(false);
  const toggleFav = (id: string) => { const n = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(n); writeList('ultraplast.favTypes', n); };

  const reload = () => listTypes().then((rows) => setDbTypes(rows.map((r) => ({ ...r }) as ComponentType))).catch(() => setDbTypes([]));
  useEffect(() => { if (auth.user) void reload(); else setDbTypes([]); }, [auth.user]);

  const all = useMemo(() => mergeTypes(builtin, dbTypes), [builtin, dbTypes]);
  const dbIds = useMemo(() => new Set(dbTypes.map((t) => t.id)), [dbTypes]);
  const shown = all.filter((t) => (!onlyFav || favs.includes(t.id)) && (!cat || t.category === cat) && (!q.trim() || `${t.name} ${t.note} ${baseLabel(t.base)}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const isAdmin = !!auth.user?.isAdmin;

  const create = (t: ComponentType) => {
    const r = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 6); setRecent(r); writeList('ultraplast.recentTypes', r);
    if (t.base === 'assembly') { go('assembly'); return; }
    const fam = getFamily(t.base);
    if (!fam) { toast('The base component of this type no longer exists.', 'err'); return; }
    try { sessionStorage.setItem('ultraplast.preset', JSON.stringify({ familyId: fam.id, params: t.params, name: t.name })); } catch { /* the designer then opens with default values */ }
    go(`designer/${fam.id}?preset=${Date.now()}`);
  };

  const act = async (label: string, fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { const m = `${label}: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); toast(m, 'err'); } finally { setBusy(false); } };

  const save = () => act('Save', async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) throw new Error('Enter a name for the type.');
    let kind: ComponentType['kind'] = 'dedicated';
    if (draft.base === 'assembly') kind = 'assembly';
    else {
      const fam = getFamily(draft.base);
      if (!fam) throw new Error('Choose a base component.');
      const c = fam.calculate({ ...fam.defaults, ...draft.params });
      if (!c.ok) throw new Error(`The values are not valid: ${c.errors.join(' ')}`);
      if (draft.base.startsWith('custom_')) kind = 'value';
    }
    const id = draft.id ?? `${draft.category}-${slug(name)}-${Date.now().toString(36)}`;
    await putTypes([{ id, name, category: draft.category, base: draft.base, kind, params: draft.params as ComponentType['params'], note: draft.note.slice(0, 500), builtin: false }]);
    await reload(); setDraft(null); toast('Component type saved in the database.', 'ok');
  });

  const storeAll = () => act('Store', async () => {
    for (let i = 0; i < builtin.length; i += 100) await putTypes(builtin.slice(i, i + 100).map((t) => ({ ...t, builtin: true })));
    await reload(); toast(`${builtin.length} built-in types stored in the database.`, 'ok');
  });

  const remove = (t: ComponentType) => act('Delete', async () => { await deleteType(t.id); await reload(); toast(builtin.some((b) => b.id === t.id) ? 'Reset to the built-in version.' : 'Type deleted.', 'ok'); });

  const baseFam = draft && draft.base !== 'assembly' ? getFamily(draft.base) : undefined;
  return (
    <div className="page">
      <PageHeader title="Component types" subtitle="Every kind of conveyor component, created from values. Choose a type, press Create, and enter your own sizes." />
      <div className="box info">Types marked <b>Engineering model</b> have their own calculations and drawings. Types marked <b>Value-based shape</b> start from a generic block or turned part with starting sizes: type your real values and you get the drawing, 3D model, mass and exports. The shapes are plain geometry (no details such as threads or internal parts), so check them against the real component.</div>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id}: {c.name}</option>)}</select>
        <input placeholder="Search types, for example duplex, roller, plate" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> Favourites only ({favs.length})</label>
        <span className="muted">{shown.length} of {all.length} types{dbTypes.length ? `, ${dbTypes.length} stored in the database` : ''}</span>
      </div>
      {recent.length > 0 && <div className="recent"><span className="muted">Recently used:</span>{recent.map((id) => all.find((t) => t.id === id)).filter((t): t is ComponentType => !!t).map((t) => <button key={t.id} onClick={() => create(t)}>{t.name}</button>)}</div>}
      {isAdmin && (
        <div className="box info"><b>Administrator.</b> Add your own types or change a type's starting values. Changes are stored in the database and everyone who is signed in sees them.
          <div className="actions"><button className="primary" disabled={busy} onClick={() => setDraft({ id: null, name: '', category: cat || 'B', base: 'custom_block', params: { ...getFamily('custom_block')!.defaults }, note: '' })}>Add a new type</button>
            <button disabled={busy} onClick={() => void storeAll()}>Store all built-in types in the database</button></div></div>
      )}
      {draft && (
        <section className="panel">
          <h3>{draft.id ? 'Edit type' : 'New type'}</h3>
          <label className="field"><span>Name</span><input value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="field"><span>Category</span><select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id}: {c.name}</option>)}</select></label>
          <label className="field"><span>Created by (base component)</span>
            <select value={draft.base} onChange={(e) => { const f = getFamily(e.target.value); setDraft({ ...draft, base: e.target.value, params: f ? { ...f.defaults } : {} }); }}>
              {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}<option value="assembly">Assembly designer (no values)</option></select></label>
          {baseFam && <><h4>Starting values</h4><ParamForm fields={baseFam.fields} params={draft.params} onChange={(p) => setDraft({ ...draft, params: p })} /></>}
          <label className="field"><span>Note (shown on the card)</span><input value={draft.note} maxLength={500} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
          <div className="actions"><button className="primary" disabled={busy} onClick={() => void save()}>Save to database</button><button disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
        </section>
      )}
      {msg && <div className="box err">{msg}</div>}
      <div className="typegrid">
        {shown.map((t) => (
          <div key={t.id} className="typecard">
            <div className="tc-top"><span className="letter">{t.category}</span><span className={`badge ${t.kind}`}>{KIND_LABEL[t.kind]}</span><button className={`favbtn${favs.includes(t.id) ? ' on' : ''}`} style={{ marginLeft: 'auto' }} title={favs.includes(t.id) ? 'Remove from favourites' : 'Add to favourites'} aria-label="Favourite" onClick={() => toggleFav(t.id)}>{favs.includes(t.id) ? '★' : '☆'}</button></div>
            <b>{t.name}</b>
            <span className="muted">{t.base === 'assembly' ? 'Assembly designer' : baseLabel(t.base)}</span>
            <p>{t.note}</p>
            <div className="actions"><button className="primary" onClick={() => create(t)}>{t.base === 'assembly' ? 'Open assembly designer' : 'Create from values'}</button>
              {isAdmin && <button disabled={busy} onClick={() => setDraft({ id: t.id, name: t.name, category: t.category, base: t.base, params: { ...t.params }, note: t.note })}>Edit</button>}
              {isAdmin && dbIds.has(t.id) && <button disabled={busy} onClick={() => void remove(t)}>{builtin.some((b) => b.id === t.id) ? 'Reset' : 'Delete'}</button>}</div>
          </div>
        ))}
      </div>
      {!shown.length && <p className="muted">No types match.</p>}
    </div>
  );
}
