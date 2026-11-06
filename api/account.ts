import { hashPassword, makeToken, sessionCookie, verifyPassword } from './_lib/crypto.js';
import { configured, ensureSchema, secret, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** GET  /api/account                       -> { configured, user }
 *  POST /api/account {action:'register'|'login'|'logout', ...} */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { send(res, 200, { configured: false, user: null }); return; }
    await ensureSchema();
    if (req.method === 'GET') { send(res, 200, { configured: true, user: await currentUser(req) }); return; }
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
      const exists = (await q`SELECT 1 FROM users WHERE email = ${email}`) as unknown[];
      if (exists.length) { fail(res, 409, 'An account with this email already exists. Sign in instead.'); return; }
      // the very first account becomes the administrator
      const rows = (await q`INSERT INTO users (email, name, password_hash, is_admin) VALUES (${email}, ${name}, ${hashPassword(password)}, NOT EXISTS (SELECT 1 FROM users)) RETURNING id, email, name, is_admin`) as { id: string; email: string; name: string; is_admin: boolean }[];
      const u = rows[0];
      res.setHeader('Set-Cookie', sessionCookie(makeToken(u.id, secret())));
      send(res, 200, { user: { id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin } });
      return;
    }

    if (action === 'login') {
      const recent = (await q`SELECT count(*)::int AS n FROM auth_attempts WHERE email = ${email} AND at > now() - interval '15 minutes'`) as { n: number }[];
      if ((recent[0]?.n ?? 0) >= 8) { fail(res, 429, 'Too many failed attempts. Wait 15 minutes and try again.'); return; }
      const rows = (await q`SELECT id, email, name, is_admin, password_hash FROM users WHERE email = ${email}`) as { id: string; email: string; name: string; is_admin: boolean; password_hash: string }[];
      const u = rows[0];
      if (!u || !verifyPassword(password, u.password_hash)) {
        await q`INSERT INTO auth_attempts (email) VALUES (${email})`;
        fail(res, 401, 'Wrong email or password.'); return;
      }
      await q`DELETE FROM auth_attempts WHERE email = ${email}`;
      res.setHeader('Set-Cookie', sessionCookie(makeToken(u.id, secret())));
      send(res, 200, { user: { id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin } });
      return;
    }
    fail(res, 400, 'Unknown action.');
  } catch (e) {
    console.error('auth error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
