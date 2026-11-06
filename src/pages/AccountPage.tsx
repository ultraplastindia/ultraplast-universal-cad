import { useEffect, useState } from 'react';
import { authReady, listReference, login, logout, putReference, register, useAuth, cloudList, cloudPut } from '../cloud/client.ts';
import { localListAssemblies, localListProjects } from '../storage/db.ts';
import { CATEGORIES, IMPLEMENTED, PARTIAL } from '../data/catalogue.ts';
import { MATERIALS } from '../data/materials.ts';
import { ROLLER_CHAINS } from '../data/chains.ts';
import { BEARINGS } from '../data/bearings.ts';
import { KEYS } from '../data/keys.ts';
import { FAMILIES } from '../families/index.ts';
import type { AssemblyLike, Project } from '../storage/project.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { toast } from '../ui/Toast.tsx';

/** Everything the library knows, as plain data (no functions) for storing in the database. */
const referenceTables = (): Record<string, unknown> => ({
  catalogue: { categories: CATEGORIES, implemented: IMPLEMENTED, partial: PARTIAL },
  materials: MATERIALS, chains: ROLLER_CHAINS, bearings: BEARINGS, keys: KEYS,
  components: FAMILIES.map((f) => ({ id: f.id, name: f.name, category: f.category, subcategory: f.subcategory, description: f.description, keywords: f.keywords, materials: f.materials, standards: f.standards,
    fields: f.fields.map(({ key, label, unit, kind, min, max, step }) => ({ key, label, unit, kind, min, max, step })), defaults: f.defaults, variants: f.variants })),
});

export function AccountPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [local, setLocal] = useState<{ p: number; a: number } | null>(null);
  const [stored, setStored] = useState<{ key: string; updatedAt: string }[]>([]);

  useEffect(() => { void authReady(); }, []);
  useEffect(() => { localListProjects().then((p) => localListAssemblies().then((a) => setLocal({ p: p.length, a: a.length }))).catch(() => setLocal(null)); }, [auth.user]);
  useEffect(() => { if (auth.user) listReference().then(setStored).catch(() => setStored([])); }, [auth.user]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(true); setMsg('');
    try { await fn(); } catch (e) { const m = `${label}: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); toast(m, 'err'); } finally { setBusy(false); }
  };

  const copyLocal = () => act('Copy', async () => {
    const [mine, mineA] = [await cloudList<Project>('project'), await cloudList<AssemblyLike>('assembly')];
    const have = new Set([...mine.map((x) => x.id), ...mineA.map((x) => x.id)]);
    let n = 0;
    for (const p of await localListProjects()) if (!have.has(p.id)) { await cloudPut('project', p.id, p.name, p.familyId, p); n++; }
    for (const a of await localListAssemblies()) if (!have.has(a.id)) { await cloudPut('assembly', a.id, a.name, null, a); n++; }
    toast(n ? `${n} design(s) copied to your account. The browser copies were kept.` : 'Nothing new to copy.', 'ok');
  });

  const syncTables = () => act('Store tables', async () => {
    const t = referenceTables();
    for (const [k, v] of Object.entries(t)) await putReference(k, v);
    setStored(await listReference());
    toast('Catalogue, materials, chains, bearings, keys and component tables stored in the database.', 'ok');
  });

  if (!auth.ready) return <div className="page"><PageHeader title="Account" /><p className="muted">Checking the cloud database...</p></div>;

  if (!auth.configured) {
    return (
      <div className="page">
        <PageHeader title="Account" subtitle="Cloud database (Neon) is not connected on this website." />
        <div className="box warn"><b>Working in browser-only mode.</b> Designs are saved in this browser, as before. To save designs in the Neon database and sign in on any computer, follow the Neon setup steps in the README (create the database, add <code>DATABASE_URL</code> and <code>AUTH_SECRET</code> in Vercel, redeploy). Running the site locally with <code>npm run dev</code> also stays in this mode.</div>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="page">
        <PageHeader title="Account" subtitle="Sign in to save designs in the cloud database and open them from any computer." />
        <form className="panel authbox" onSubmit={(e) => { e.preventDefault(); void act(mode === 'in' ? 'Sign in' : 'Create account', async () => { if (mode === 'in') await login(email, password); else await register(email, password, name, code); setPassword(''); }); }}>
          <div className="modebar"><button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button><button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button></div>
          {mode === 'up' && <label className="field"><span>Your name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}
          <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label className="field"><span>Password {mode === 'up' && <em>(at least 8 characters)</em>}</span><input type="password" required minLength={mode === 'up' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
          {mode === 'up' && <label className="field"><span>Sign-up code <em>(only if your administrator gave you one)</em></span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>}
          <div className="actions"><button className="primary" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button></div>
          {msg && <div className="box err">{msg}</div>}
          <p className="muted">Without signing in, the app still works and saves in this browser only.</p>
        </form>
      </div>
    );
  }

  const u = auth.user;
  return (
    <div className="page">
      <PageHeader title="Account" subtitle={`Signed in as ${u.name} (${u.email})${u.isAdmin ? ' - administrator' : ''}`} />
      <div className="actions"><button disabled={busy} onClick={() => void act('Sign out', logout)}>Sign out</button></div>
      <p>Your saved designs, assemblies and picture uploads are stored in the cloud database and are visible only to your account.</p>
      {local && (local.p > 0 || local.a > 0) && (
        <div className="box info"><b>Designs in this browser:</b> {local.p} design(s) and {local.a} assembly(ies) are saved only on this computer. <div className="actions"><button className="primary" disabled={busy} onClick={() => void copyLocal()}>Copy them to my account</button></div><small>Copies only; nothing is removed from the browser and nothing already in your account is overwritten.</small></div>
      )}
      {u.isAdmin && (
        <>
          <h2>Reference tables (administrator)</h2>
          <p className="muted">Stores a copy of the built-in catalogue, materials, chain, bearing and key tables and the full component list (every family and variant) in the database. The calculations still use the tables built into the app.</p>
          <div className="actions"><button disabled={busy} onClick={() => void syncTables()}>Store / refresh tables in the database</button></div>
          {stored.length > 0 && <table className="tbl"><tbody>{stored.map((s) => <tr key={s.key}><td>{s.key}</td><td>{new Date(s.updatedAt).toLocaleString()}</td></tr>)}</tbody></table>}
        </>
      )}
      {msg && <div className="box err">{msg}</div>}
    </div>
  );
}
