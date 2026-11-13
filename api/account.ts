import { hashPassword, makeToken, sessionCookie, verifyPassword } from './_lib/crypto.js';
import { configured, ensureSchema, secret, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';
import { mailReady } from './_lib/mail.js';
import { checkOtp, Friendly, issueOtp } from './_lib/otp.js';
import { getSetting, SECURITY_DEFAULT } from './_lib/settings.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

type Row = { id: string; email: string; name: string; is_admin: boolean };
const pub = (u: Row) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin });
const needOtp = async (): Promise<boolean> => (await mailReady()) && (await getSetting('security', SECURITY_DEFAULT)).otpLogin;

/** GET  /api/account                       -> { configured, user, emailCodes }
 *  POST /api/account {action:'register'|'login'|'verify'|'forgot'|'reset'|'logout', ...}
 *  With email sending set up (Settings > Email) sign-up and every sign-in need a 6-digit code mailed to the person. */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { send(res, 200, { configured: false, user: null }); return; }
    await ensureSchema();
    if (req.method === 'GET') { send(res, 200, { configured: true, user: await currentUser(req), emailCodes: await needOtp() }); return; }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return; }
    if (!guardWrite(req, res)) return;
    const b = bodyOf(req), action = String(b.action ?? '');
    if (action === 'logout') { res.setHeader('Set-Cookie', sessionCookie(null)); send(res, 200, { user: null }); return; }
    const email = String(b.email ?? '').trim().toLowerCase(), password = String(b.password ?? '');
    if (!EMAIL.test(email)) { fail(res, 400, 'Enter a valid email address.'); return; }
    const q = sql();

    if (action === 'register') {
      const need = process.env.SIGNUP_CODE;
      if (need && String(b.code ?? '') !== need) { fail(res, 403, 'The sign-up code is wrong.'); return; }
      if (password.length < 8 || password.length > 200) { fail(res, 400, 'Password must be 8 to 200 characters.'); return; }
      const name = String(b.name ?? '').trim().slice(0, 80) || email.split('@')[0];
      const flood = (await q`SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '1 hour' AND NOT approved`) as { n: number }[];
      if ((flood[0]?.n ?? 0) >= 30) { fail(res, 429, 'Too many access requests right now. Try again later.'); return; } // stops a script from filling the user list
      const exists = (await q`SELECT 1 FROM users WHERE email = ${email}`) as unknown[];
      if (exists.length) { fail(res, 409, 'An account with this email already exists. Sign in instead.'); return; }
      const codes = await needOtp();
      // the very first account becomes the administrator; it can sign up without a code because mail cannot be set up before an administrator exists
      const rows = (await q`INSERT INTO users (email, name, password_hash, is_admin, email_verified, approved) VALUES (${email}, ${name}, ${hashPassword(password)}, NOT EXISTS (SELECT 1 FROM users), ${!codes}, NOT EXISTS (SELECT 1 FROM users)) RETURNING id, email, name, is_admin, approved`) as (Row & { approved: boolean })[];
      if (codes) { await issueOtp(email, 'signup'); send(res, 200, { step: 'otp', purpose: 'signup', email }); return; }
      if (!rows[0].approved) { send(res, 200, { step: 'pending', email }); return; } // access request sent: the administrator must approve it first
      res.setHeader('Set-Cookie', sessionCookie(makeToken(rows[0].id, secret())));
      send(res, 200, { user: pub(rows[0]) });
      return;
    }

    if (action === 'login') {
      const recent = (await q`SELECT count(*)::int AS n FROM auth_attempts WHERE email = ${email} AND at > now() - interval '15 minutes'`) as { n: number }[];
      if ((recent[0]?.n ?? 0) >= 8) { fail(res, 429, 'Too many failed attempts. Wait 15 minutes and try again.'); return; }
      const rows = (await q`SELECT id, email, name, is_admin, password_hash, email_verified, disabled, approved FROM users WHERE email = ${email}`) as (Row & { password_hash: string; email_verified: boolean; disabled: boolean; approved: boolean })[];
      const u = rows[0];
      if (!u || !verifyPassword(password, u.password_hash)) {
        await q`INSERT INTO auth_attempts (email) VALUES (${email})`;
        fail(res, 401, 'Wrong email or password.'); return;
      }
      if (u.disabled) { fail(res, 403, 'This account is disabled. Ask the administrator.'); return; }
      await q`DELETE FROM auth_attempts WHERE email = ${email}`;
      if (!u.approved) { fail(res, 403, 'Your access request is waiting for the administrator to approve it. You will be able to sign in after that.'); return; }
      if (await needOtp()) {
        const purpose = u.email_verified ? 'login' : 'signup';
        await issueOtp(email, purpose); send(res, 200, { step: 'otp', purpose, email }); return;
      }
      res.setHeader('Set-Cookie', sessionCookie(makeToken(u.id, secret())));
      send(res, 200, { user: pub(u) });
      return;
    }

    if (action === 'verify') {
      const purpose = String(b.purpose ?? '') === 'signup' ? 'signup' : 'login';
      const recent = (await q`SELECT count(*)::int AS n FROM auth_attempts WHERE email = ${'otp:' + email} AND at > now() - interval '15 minutes'`) as { n: number }[];
      if ((recent[0]?.n ?? 0) >= 10) { fail(res, 429, 'Too many wrong codes. Wait 15 minutes.'); return; }
      if (!(await checkOtp(email, purpose, String(b.code ?? '').trim()))) { await q`INSERT INTO auth_attempts (email) VALUES (${'otp:' + email})`; fail(res, 401, 'The code is wrong or has expired. Ask for a new code.'); return; }
      const rows = (await q`UPDATE users SET email_verified = true WHERE email = ${email} AND NOT disabled RETURNING id, email, name, is_admin, approved`) as (Row & { approved: boolean })[];
      if (!rows[0]) { fail(res, 403, 'This account is not available.'); return; }
      if (!rows[0].approved) { send(res, 200, { step: 'pending', email }); return; }
      res.setHeader('Set-Cookie', sessionCookie(makeToken(rows[0].id, secret())));
      send(res, 200, { user: pub(rows[0]) });
      return;
    }

    if (action === 'resend') {
      const purpose = String(b.purpose ?? '') === 'signup' ? 'signup' : 'login';
      const u = (await q`SELECT 1 FROM users WHERE email = ${email} AND NOT disabled`) as unknown[];
      // a code can only be re-sent after a code was already started by a correct password, which we cannot re-check here, so only the same purpose is allowed and the 30-second / 8-per-hour limits apply
      const started = (await q`SELECT 1 FROM otp_codes WHERE email = ${email} AND purpose = ${purpose}`) as unknown[];
      if (u.length && started.length) await issueOtp(email, purpose);
      send(res, 200, { ok: true }); return;
    }

    if (action === 'forgot') {
      if (!(await mailReady())) { fail(res, 400, 'Password reset by email is not set up. Ask the administrator to set a new password for you (Settings > Users).'); return; }
      const u = (await q`SELECT 1 FROM users WHERE email = ${email} AND NOT disabled`) as unknown[];
      if (u.length) await issueOtp(email, 'reset');
      send(res, 200, { ok: true }); return; // same answer whether or not the account exists
    }

    if (action === 'reset') {
      if (password.length < 8 || password.length > 200) { fail(res, 400, 'Password must be 8 to 200 characters.'); return; }
      if (!(await checkOtp(email, 'reset', String(b.code ?? '').trim()))) { fail(res, 401, 'The code is wrong or has expired. Ask for a new code.'); return; }
      await q`UPDATE users SET password_hash = ${hashPassword(password)}, email_verified = true WHERE email = ${email}`;
      send(res, 200, { ok: true }); return;
    }
    fail(res, 400, 'Unknown action.');
  } catch (e) {
    if (e instanceof Friendly) { fail(res, 429, e.message); return; }
    console.error('auth error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
