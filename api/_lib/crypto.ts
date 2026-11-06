import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Password hashing (scrypt) and signed login tokens. Uses only Node's built-in crypto, so there is nothing extra to install. */
const N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n) || N, r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

const b64 = (b: Buffer): string => b.toString('base64url');
const sign = (data: string, secret: string): string => b64(createHmac('sha256', secret).update(data).digest());

export function makeToken(userId: string, secret: string, days = 30, now = Date.now()): string {
  const payload = b64(Buffer.from(JSON.stringify({ u: userId, e: now + days * 86400000 })));
  return `${payload}.${sign(payload, secret)}`;
}
/** Returns the user id if the token is genuine and not expired, otherwise null. */
export function readToken(token: string, secret: string, now = Date.now()): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(payload, secret)), given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown }; return typeof p.u === 'string' && typeof p.e === 'number' && p.e > now ? p.u : null; } catch { return null; }
}

export const COOKIE = 'up_session';
export const cookieValue = (cookieHeader: string, name = COOKIE): string => {
  for (const part of cookieHeader.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return '';
};
export const sessionCookie = (token: string | null, days = 30): string =>
  `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? days * 86400 : 0}`;
