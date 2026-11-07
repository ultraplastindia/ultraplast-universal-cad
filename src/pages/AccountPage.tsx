import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { authReady, forgotPassword, listReference, login, logout, putReference, register, resendCode, resetPassword, useAuth, cloudList, cloudPut, verifyCode } from '../cloud/client.ts';
import { localListAssemblies, localListProjects } from '../storage/db.ts';
import { CATEGORIES, IMPLEMENTED, PARTIAL } from '../data/catalogue.ts';
import { MATERIALS } from '../data/materials.ts';
import { ROLLER_CHAINS } from '../data/chains.ts';
import { BEARINGS } from '../data/bearings.ts';
import { KEYS } from '../data/keys.ts';
import { FAMILIES } from '../families/index.ts';
import type { AssemblyLike, Project } from '../storage/project.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { Logo } from '../ui/Logo.tsx';
import { toast } from '../ui/Toast.tsx';

/** Everything the library knows, as plain data (no functions) for storing in the database. */
const referenceTables = (): Record<string, unknown> => ({
  catalogue: { categories: CATEGORIES, implemented: IMPLEMENTED, partial: PARTIAL },
  materials: MATERIALS, chains: ROLLER_CHAINS, bearings: BEARINGS, keys: KEYS,
  components: FAMILIES.map((f) => ({ id: f.id, name: f.name, category: f.category, subcategory: f.subcategory, description: f.description, keywords: f.keywords, materials: f.materials, standards: f.standards,
    fields: f.fields.map(({ key, label, unit, kind, min, max, step }) => ({ key, label, unit, kind, min, max, step })), defaults: f.defaults, variants: f.variants })),
});

/** Full-screen sign-in layout: company panel on the left, form card on the right. */
function AuthShell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="authpage">
      <aside className="auth-brand">
        <div className="auth-brand-in">
          <Logo height={46} box />
          <h1>Conveyor Designer<span>CAD automation for chain, belt and sprocket components</span></h1>
          <ul>
            <li><b>2D drawings and 3D models</b> created from the values you type</li>
            <li><b>Photo to part:</b> upload a picture and get a real-size model</li>
            <li><b>STEP, DXF, PDF, STL</b> exports and a bill of materials</li>
            <li><b>Your designs saved</b> safely in your own account</li>
          </ul>
        </div>
        <small>Ultraplast Chainbelts Private Limited</small>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="auth-sub">{sub}</p>
          {children}
        </div>
        <p className="auth-foot">Designs are PRELIMINARY and not validated for manufacture.</p>
      </section>
    </div>
  );
}

export function AccountPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up' | 'otp' | 'forgot' | 'reset' | 'pending'>('in');
  const [otpFor, setOtpFor] = useState<{ email: string; purpose: 'signup' | 'login' } | null>(null);
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState('');
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
    const back = () => { setMode('in'); setOtp(''); setMsg(''); setInfo(''); setOtpFor(null); };
    const submit = (e: { preventDefault(): void }) => {
      e.preventDefault(); setInfo('');
      void act(mode === 'in' ? 'Sign in' : mode === 'up' ? 'Request access' : mode === 'otp' ? 'Verify' : mode === 'forgot' ? 'Reset' : 'Reset', async () => {
        if (mode === 'in' || mode === 'up') {
          const r = mode === 'in' ? await login(email, password) : await register(email, password, name, code);
          if (r.step === 'pending') { setMode('pending'); setInfo(''); }
          if (r.step === 'otp') { setOtpFor({ email: r.email, purpose: r.purpose }); setOtp(''); setMode('otp'); setInfo(`We sent a 6-digit code to ${r.email}. Enter it below. It is valid for 10 minutes.`); }
          setPassword('');
        } else if (mode === 'otp' && otpFor) { const r = await verifyCode(otpFor.email, otpFor.purpose, otp); setOtp(''); if (r.step === 'pending') { setMode('pending'); setInfo(''); } }
        else if (mode === 'forgot') { await forgotPassword(email); setMode('reset'); setInfo('If this email has an account, a 6-digit code was sent to it. Enter the code and a new password.'); }
        else if (mode === 'reset') { await resetPassword(email, otp, password); setPassword(''); setOtp(''); setMode('in'); setInfo('Password changed. Sign in with the new password.'); }
      });
    };
    if (mode === 'pending') return (
      <AuthShell title="Access request sent" sub="Your request is waiting for the administrator.">
        <div className="auth-done"><svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#e8f6ee" stroke="#117a3d" strokeWidth="1.5" /><path d="M7.5 12.5l3 3 6-7" fill="none" stroke="#117a3d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p>Thank you. You can sign in after the administrator approves your request. Please try again later or contact your administrator.</p></div>
        <div className="actions"><button className="primary wide" onClick={back}>Back to sign in</button></div>
      </AuthShell>
    );
    const heading = mode === 'up' ? ['Request access', 'Fill in your details. The administrator will approve your request.'] : mode === 'in' ? ['Welcome back', 'Sign in to your account to continue.'] : mode === 'otp' ? ['Verify your email', 'Enter the 6-digit code we emailed you.'] : mode === 'forgot' ? ['Forgot password', 'We will email you a code to set a new password.'] : ['New password', 'Enter the code and choose a new password.'];
    return (
      <AuthShell title={heading[0]} sub={heading[1]}>
        <form className="authform" onSubmit={submit}>
          {(mode === 'in' || mode === 'up') && <div className="modebar"><button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setMsg(''); setInfo(''); }}>Sign in</button><button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setMsg(''); setInfo(''); }}>Request access</button></div>}
                    {info && <div className="box info">{info}</div>}
          {mode === 'up' && <label className="field"><span>Your name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}
          {mode !== 'otp' && <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>}
          {(mode === 'in' || mode === 'up' || mode === 'reset') && <label className="field"><span>{mode === 'reset' ? 'New password' : 'Password'} {mode !== 'in' && <em>(at least 8 characters)</em>}</span><input type="password" required minLength={mode === 'in' ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>}
          {(mode === 'otp' || mode === 'reset') && <label className="field"><span>6-digit code</span><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" autoFocus style={{ letterSpacing: '0.4em', fontSize: '1.3em', maxWidth: 200 }} /></label>}
          {mode === 'up' && <label className="field"><span>Sign-up code <em>(only if your administrator gave you one)</em></span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>}
          <div className="actions">
            <button className="primary wide" disabled={busy}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Request access' : mode === 'otp' ? 'Verify and continue' : mode === 'forgot' ? 'Send code' : 'Change password'}</button>
            {mode === 'otp' && otpFor && <button type="button" disabled={busy} onClick={() => void act('Resend', async () => { await resendCode(otpFor.email, otpFor.purpose); setInfo('A new code was sent if the last one has been used or expired. Wait 30 seconds between requests.'); })}>Send a new code</button>}
            {mode !== 'in' && mode !== 'up' && <button type="button" onClick={back}>Back</button>}
          </div>
          {mode === 'in' && <p><a href="#/account" onClick={(e) => { e.preventDefault(); setMode('forgot'); setMsg(''); setInfo(''); }}>Forgot password?</a></p>}
          {msg && <div className="box err">{msg}</div>}
          {(mode === 'in' || mode === 'up') && <p className="muted">{mode === 'up' ? 'New here? Send an access request. You can sign in once the administrator approves it.' : auth.emailCodes ? 'For your safety, a one-time code is emailed to you every time you sign in.' : ''}</p>}
        </form>
      </AuthShell>
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
