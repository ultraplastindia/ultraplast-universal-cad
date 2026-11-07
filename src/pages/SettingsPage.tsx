import { useEffect, useState } from 'react';
import { adminDo, adminGet, authReady, useAuth } from '../cloud/client.ts';
import type { AdminOverview, AdminProvider } from '../cloud/client.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { toast } from '../ui/Toast.tsx';

type Tab = 'users' | 'email' | 'security' | 'ai';
const TABS: [Tab, string][] = [['users', 'Users'], ['email', 'Email (OTP)'], ['security', 'Security'], ['ai', 'AI services']];
const MAIL_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  office365: { host: 'smtp.office365.com', port: 587, secure: false },
};

/** Administrator-only settings. The server also checks the role on every call, so hiding the page is not the only protection. */
export function SettingsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void authReady(); }, []);
  useEffect(() => { if (auth.user?.isAdmin) adminGet().then(setOv).catch((e) => setMsg(e instanceof Error ? e.message : String(e))); }, [auth.user]);

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(true); setMsg('');
    try { const m = await fn(); if (m) toast(m, 'ok'); } catch (e) { const m = `${label}: ${e instanceof Error ? e.message : String(e)}`; setMsg(m); toast(m, 'err'); } finally { setBusy(false); }
  };
  const run = (label: string, action: string, body: object = {}, ok = 'Saved.') => act(label, async () => { setOv(await adminDo(action, body)); return ok; });

  if (!auth.ready) return <div className="page"><PageHeader title="Settings" /><p className="muted">Loading...</p></div>;
  if (!auth.user?.isAdmin) return <div className="page"><PageHeader title="Settings" /><div className="box warn">Settings are only for the administrator. {auth.user ? '' : <a href="#/account">Sign in</a>}</div></div>;
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Administrator only: people, email codes, security and AI services." />
      <div className="modebar" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(''); }}>{l}</button>)}</div>
      {msg && <div className="box err">{msg}</div>}
      {!ov ? <p className="muted">Loading settings...</p> : <>
        {tab === 'users' && <Users ov={ov} me={auth.user.id} busy={busy} run={run} />}
        {tab === 'email' && <Email ov={ov} busy={busy} run={run} act={act} />}
        {tab === 'security' && <Security ov={ov} busy={busy} run={run} />}
        {tab === 'ai' && <Ai ov={ov} busy={busy} run={run} act={act} />}
      </>}
    </div>
  );
}

interface P { ov: AdminOverview; busy: boolean; run: (label: string, action: string, body?: object, ok?: string) => Promise<void>; act?: (label: string, fn: () => Promise<string | void>) => Promise<void> }

function Users({ ov, me, busy, run }: P & { me: string }) {
  const [pw, setPw] = useState<{ id: string; value: string } | null>(null);
  return (
    <section>
      <p className="muted">{ov.users.length} account(s). Make someone an administrator, switch an account off, set a new password, or delete the account (its saved designs and pictures are deleted with it).</p>
      <div style={{ overflowX: 'auto' }}><table className="tbl">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>AI today</th><th>Actions</th></tr></thead>
        <tbody>{ov.users.map((u) => (
          <tr key={u.id}>
            <td>{u.name}{u.id === me && ' (you)'}</td><td>{u.email}</td><td>{u.isAdmin ? 'Administrator' : 'User'}</td>
            <td>{u.disabled ? 'Disabled' : u.verified ? 'Active' : 'Email not confirmed'}</td><td>{u.aiToday}</td>
            <td><div className="actions" style={{ margin: 0, flexWrap: 'wrap' }}>
              <button disabled={busy || (u.id === me && u.isAdmin && ov.users.filter((x) => x.isAdmin && !x.disabled).length <= 1)} onClick={() => void run('Role', 'setAdmin', { id: u.id, value: !u.isAdmin })}>{u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
              <button disabled={busy || u.id === me} onClick={() => void run('Status', 'setDisabled', { id: u.id, value: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
              <button disabled={busy} onClick={() => setPw({ id: u.id, value: '' })}>Set password</button>
              <button disabled={busy || u.id === me} onClick={() => { if (window.confirm(`Delete ${u.email} and all of their saved designs? This cannot be undone.`)) void run('Delete', 'deleteUser', { id: u.id }, 'User deleted.'); }}>Delete</button>
            </div></td>
          </tr>))}</tbody>
      </table></div>
      {pw && (
        <form className="panel authbox" onSubmit={(e) => { e.preventDefault(); void run('Password', 'setPassword', { id: pw.id, password: pw.value }, 'Password changed.').then(() => setPw(null)); }}>
          <label className="field"><span>New password for {ov.users.find((u) => u.id === pw.id)?.email} <em>(at least 8 characters)</em></span><input type="password" minLength={8} required value={pw.value} onChange={(e) => setPw({ ...pw, value: e.target.value })} autoComplete="new-password" /></label>
          <div className="actions"><button className="primary" disabled={busy}>Change password</button><button type="button" onClick={() => setPw(null)}>Cancel</button></div>
        </form>
      )}
    </section>
  );
}

function Email({ ov, busy, run, act }: P) {
  const m = ov.mail;
  const [f, setF] = useState({ enabled: m.enabled, host: m.host, port: m.port, secure: m.secure, user: m.user, fromName: m.fromName, fromEmail: m.fromEmail, password: '' });
  const [to, setTo] = useState('');
  return (
    <section className="panel">
      <p>The app emails a 6-digit code at sign-up and at every sign-in, using <b>your own mail account</b>. Gmail and Outlook need an <b>app password</b> (not your normal password): turn on 2-step verification, then create an app password in the account's security page.</p>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        {Object.entries({ gmail: 'Gmail', outlook: 'Outlook.com', office365: 'Microsoft 365' }).map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, ...MAIL_PRESETS[k] })}>Use {l} settings</button>)}
      </div>
      <label className="field"><span>Mail server (SMTP host)</span><input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.gmail.com" /></label>
      <label className="field"><span>Port</span><input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></label>
      <label className="field"><span>Secure connection from the start (port 465)</span><input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /></label>
      <label className="field"><span>Mail account (login)</span><input type="email" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} autoComplete="off" /></label>
      <label className="field"><span>App password {m.hasPassword && <em>(saved, ends {m.passwordHint.slice(-4)}; leave empty to keep it)</em>}</span><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
      <label className="field"><span>Sender name</span><input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></label>
      <label className="field"><span>Sender address <em>(empty = the mail account)</em></span><input type="email" value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} /></label>
      <label className="field"><span>Send email codes (switch on after the test works)</span><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /></label>
      <div className="actions"><button className="primary" disabled={busy} onClick={() => void run('Save email', 'saveMail', f, 'Email settings saved.').then(() => setF((x) => ({ ...x, password: '' })))}>Save</button></div>
      <h4>Send a test email</h4>
      <div className="actions"><input type="email" placeholder="your email (empty = your own)" value={to} onChange={(e) => setTo(e.target.value)} style={{ minWidth: 260 }} />
        <button disabled={busy || !m.hasPassword} onClick={() => void act!('Test email', async () => { const r = await adminDo<{ message: string }>('testMail', { to }); return r.message; })}>Send test</button></div>
      <p className="muted">Status: {m.ready ? 'email codes are ON for sign-up and sign-in.' : 'email codes are OFF (people sign in with email and password only).'} Save first, then test. Microsoft may block basic password sign-in for some Outlook accounts; if the test fails, try Gmail or a different mail account. The password is stored encrypted and is never shown again.</p>
    </section>
  );
}

function Security({ ov, busy, run }: P) {
  return (
    <section className="panel">
      <label className="field"><span>Ask for an emailed code at every sign-in</span><input type="checkbox" checked={ov.security.otpLogin} disabled={busy} onChange={(e) => void run('Security', 'saveSecurity', { otpLogin: e.target.checked })} /></label>
      <p className="muted">Sign-up always needs a code when email is switched on. This switch controls the code at every later sign-in. It only has an effect while email is {ov.mail.ready ? 'on (it is on now)' : 'switched on in the Email tab (it is off now)'}. Sign-in locks for 15 minutes after repeated wrong passwords or codes.</p>
      <p className="muted">Keep at least one administrator whose email address you can open: if email stops working, switch it off in the database table <code>settings</code> (row <code>mail</code>) or set a new password from this page while still signed in.</p>
    </section>
  );
}

function Ai({ ov, busy, run, act }: P) {
  const a = ov.ai;
  const [local, setLocal] = useState<Record<string, { enabled: boolean; model: string; key: string }>>(() => Object.fromEntries(a.providers.map((p) => [p.id, { enabled: p.enabled, model: p.model, key: '' }])));
  const [pref, setPref] = useState({ v: a.preferredVision, m: a.preferredMesh, limit: a.dailyLimit });
  const set = (id: string, patch: Partial<{ enabled: boolean; model: string; key: string }>) => setLocal({ ...local, [id]: { ...local[id], ...patch } });
  const payload = () => ({ providers: Object.fromEntries(Object.entries(local).map(([id, x]) => [id, { enabled: x.enabled, model: x.model, key: x.key }])), preferredVision: pref.v, preferredMesh: pref.m, dailyLimit: pref.limit });
  const card = (p: AdminProvider) => {
    const x = local[p.id];
    return (
      <div key={p.id} className="typecard">
        <b>{p.label}</b><span className="muted">{p.help}</span>
        <label className="field"><span>API key {p.hasKey && <em>(saved, ends {p.keyHint.slice(-4)}; leave empty to keep it)</em>}</span><input type="password" autoComplete="off" value={x.key} onChange={(e) => set(p.id, { key: e.target.value })} placeholder={p.hasKey ? '••••••••' : 'paste key'} /></label>
        {p.use === 'vision' && <label className="field"><span>Model name <em>(change it if the provider renames models)</em></span><input value={x.model} onChange={(e) => set(p.id, { model: e.target.value })} /></label>}
        <label className="field"><span>Use this AI</span><input type="checkbox" checked={x.enabled} onChange={(e) => set(p.id, { enabled: e.target.checked })} /></label>
        <div className="actions"><button disabled={busy || !p.hasKey} onClick={() => void act!(`Test ${p.label}`, async () => { const r = await adminDo<{ message: string }>('testAi', { provider: p.id }); return `${p.label}: ${r.message}`; })}>Test saved key</button></div>
      </div>
    );
  };
  return (
    <section>
      <p>Add a key for each AI you want to use. Every AI is separate: switch on any one (or several) and the <b>Image to 3D</b> page uses it automatically. Keys are stored encrypted on the server and are never sent back to the browser. You pay the AI company directly for what is used.</p>
      <h3>Picture understanding (suggests the part type and proportions)</h3>
      <div className="typegrid">{a.providers.filter((p) => p.use === 'vision').map(card)}</div>
      <h3>3D model from a picture (mesh)</h3>
      <div className="typegrid">{a.providers.filter((p) => p.use === 'mesh').map(card)}</div>
      <h3>Choice and limits</h3>
      <label className="field"><span>Picture understanding: use</span><select value={pref.v} onChange={(e) => setPref({ ...pref, v: e.target.value })}><option value="auto">Automatic (any switched-on AI, falls back to the next)</option>{a.providers.filter((p) => p.use === 'vision').map((p) => <option key={p.id} value={p.id}>{p.label} first</option>)}</select></label>
      <label className="field"><span>3D mesh: use</span><select value={pref.m} onChange={(e) => setPref({ ...pref, m: e.target.value })}><option value="auto">Automatic</option>{a.providers.filter((p) => p.use === 'mesh').map((p) => <option key={p.id} value={p.id}>{p.label} first</option>)}</select></label>
      <label className="field"><span>AI requests per person per day <em>(0 = AI off for everyone)</em></span><input type="number" min={0} max={1000} value={pref.limit} onChange={(e) => setPref({ ...pref, limit: Number(e.target.value) })} /></label>
      <div className="actions"><button className="primary" disabled={busy} onClick={() => void run('Save AI', 'saveAi', payload(), 'AI settings saved.').then(() => setLocal((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ...v, key: '' }]))))}>Save AI settings</button></div>
      <p className="muted">After saving, press "Test saved key" on each card. AI results are suggestions: you always type or confirm the real measurement yourself.</p>
    </section>
  );
}
