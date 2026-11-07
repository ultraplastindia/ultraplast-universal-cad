import { hashPassword } from './_lib/crypto.js';
import { AI_DEFAULT, keyOf, loadAi, PROVIDERS, saveAi, testProvider } from './_lib/ai.js';
import type { ProviderId } from './_lib/ai.js';
import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { mailReady, sendMail } from './_lib/mail.js';
import { currentUser } from './_lib/session.js';
import { getSetting, hint, MAIL_DEFAULT, SECURITY_DEFAULT, seal, setSetting, unseal } from './_lib/settings.js';

const ID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
const int = (v: unknown, lo: number, hi: number, d: number): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Everything the Settings page needs. Secrets are never sent: only whether a key exists and its last 4 characters. */
async function overview() {
  const [mail, security, ai] = [await getSetting('mail', MAIL_DEFAULT), await getSetting('security', SECURITY_DEFAULT), await loadAi()];
  const users = (await sql()`SELECT u.id, u.email, u.name, u.is_admin, u.disabled, u.email_verified, u.created_at, COALESCE((SELECT n FROM ai_usage a WHERE a.user_id = u.id AND a.day = current_date), 0) AS ai_today FROM users u ORDER BY u.created_at`) as { id: string; email: string; name: string; is_admin: boolean; disabled: boolean; email_verified: boolean; created_at: string; ai_today: number }[];
  return {
    mail: { enabled: mail.enabled, host: mail.host, port: mail.port, secure: mail.secure, user: mail.user, fromName: mail.fromName, fromEmail: mail.fromEmail, hasPassword: !!mail.passEnc, passwordHint: hint(unseal(mail.passEnc)), ready: await mailReady() },
    security,
    ai: { preferredVision: ai.preferredVision, preferredMesh: ai.preferredMesh, dailyLimit: ai.dailyLimit, providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, use: p.use, help: p.help, enabled: ai.providers[p.id].enabled, model: ai.providers[p.id].model, hasKey: !!ai.providers[p.id].keyEnc, keyHint: hint(keyOf(ai.providers[p.id])) })) },
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, disabled: u.disabled, verified: u.email_verified, createdAt: new Date(u.created_at).toISOString(), aiToday: u.ai_today })),
  };
}

/** Administrator-only settings.  GET /api/admin -> overview.  POST /api/admin {action, ...} */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { fail(res, 503, 'Cloud database is not set up.'); return; }
    await ensureSchema();
    const me = await currentUser(req);
    if (!me) { fail(res, 401, 'Please sign in.'); return; }
    if (!me.isAdmin) { fail(res, 403, 'Settings are for the administrator only.'); return; }
    if (req.method === 'GET') { send(res, 200, await overview()); return; }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return; }
    if (!guardWrite(req, res)) return;
    const b = bodyOf(req), action = str(b.action, 30), q = sql();

    if (['setAdmin', 'setDisabled', 'deleteUser', 'setPassword'].includes(action)) {
      const id = str(b.id, 40);
      if (!ID.test(id)) { fail(res, 400, 'Bad user.'); return; }
      const t = (await q`SELECT id, is_admin, disabled FROM users WHERE id = ${id}`) as { id: string; is_admin: boolean; disabled: boolean }[];
      if (!t[0]) { fail(res, 404, 'User not found.'); return; }
      const admins = ((await q`SELECT count(*)::int AS n FROM users WHERE is_admin AND NOT disabled`) as { n: number }[])[0].n;
      const losing = t[0].is_admin && !t[0].disabled && admins <= 1; // would remove the last working administrator
      if (action === 'setAdmin') {
        const v = b.value === true;
        if (!v && losing) { fail(res, 400, 'There must be at least one administrator.'); return; }
        await q`UPDATE users SET is_admin = ${v} WHERE id = ${id}`;
      } else if (action === 'setDisabled') {
        const v = b.value === true;
        if (v && id === me.id) { fail(res, 400, 'You cannot disable your own account.'); return; }
        if (v && losing) { fail(res, 400, 'There must be at least one working administrator.'); return; }
        await q`UPDATE users SET disabled = ${v} WHERE id = ${id}`;
      } else if (action === 'deleteUser') {
        if (id === me.id) { fail(res, 400, 'You cannot delete your own account.'); return; }
        if (losing) { fail(res, 400, 'There must be at least one administrator.'); return; }
        await q`DELETE FROM users WHERE id = ${id}`; // their designs and uploads are removed with the account (ON DELETE CASCADE)
      } else {
        const pw = String(b.password ?? '');
        if (pw.length < 8 || pw.length > 200) { fail(res, 400, 'Password must be 8 to 200 characters.'); return; }
        await q`UPDATE users SET password_hash = ${hashPassword(pw)} WHERE id = ${id}`;
      }
      send(res, 200, await overview()); return;
    }

    if (action === 'saveMail') {
      const old = await getSetting('mail', MAIL_DEFAULT), pw = String(b.password ?? '');
      const next = { enabled: b.enabled === true, host: str(b.host, 200), port: int(b.port, 1, 65535, 587), secure: b.secure === true, user: str(b.user, 200), fromName: str(b.fromName, 80) || MAIL_DEFAULT.fromName, fromEmail: str(b.fromEmail, 200), passEnc: pw ? seal(pw.replace(/\s+/g, '')) : old.passEnc };
      if (next.enabled && (!next.host || !next.user || !next.passEnc)) { fail(res, 400, 'Enter the mail server, account and app password before switching email on.'); return; }
      await setSetting('mail', next); send(res, 200, await overview()); return;
    }
    if (action === 'testMail') {
      const to = str(b.to, 200) || me.email;
      try { await sendMail(to, 'Ultraplast test email', 'This is a test. Your email settings work.'); send(res, 200, { ok: true, message: `Test email sent to ${to}.` }); }
      catch (e) { fail(res, 400, e instanceof Error ? e.message : 'Could not send.'); }
      return;
    }
    if (action === 'saveSecurity') { await setSetting('security', { otpLogin: b.otpLogin === true }); send(res, 200, await overview()); return; }

    if (action === 'saveAi') {
      const cur = await loadAi(), inc = (b.providers ?? {}) as Record<string, { enabled?: unknown; model?: unknown; key?: unknown; clearKey?: unknown }>;
      for (const p of PROVIDERS) {
        const x = inc[p.id]; if (!x) continue;
        const t = cur.providers[p.id];
        if (x.clearKey === true) t.keyEnc = '';
        else if (typeof x.key === 'string' && x.key.trim()) t.keyEnc = seal(x.key.trim());
        if (typeof x.model === 'string' && x.model.trim()) t.model = str(x.model, 80);
        t.enabled = x.enabled === true && !!t.keyEnc;
      }
      const v = str(b.preferredVision, 20), m = str(b.preferredMesh, 20);
      cur.preferredVision = (['auto', 'anthropic', 'openai', 'gemini'] as const).find((i) => i === v) ?? 'auto';
      cur.preferredMesh = (['auto', 'stability', 'meshy'] as const).find((i) => i === m) ?? 'auto';
      cur.dailyLimit = int(b.dailyLimit, 0, 1000, AI_DEFAULT.dailyLimit);
      await saveAi(cur); send(res, 200, await overview()); return;
    }
    if (action === 'testAi') {
      const id = str(b.provider, 20) as ProviderId, p = PROVIDERS.find((x) => x.id === id);
      if (!p) { fail(res, 400, 'Unknown AI provider.'); return; }
      try { send(res, 200, { ok: true, message: await testProvider(id, (await loadAi()).providers[id]) }); }
      catch (e) { fail(res, 400, e instanceof Error ? e.message : 'Test failed.'); }
      return;
    }
    fail(res, 400, 'Unknown action.');
  } catch (e) {
    console.error('admin error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
