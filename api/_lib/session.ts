import { cookieValue, readToken } from './crypto.js';
import { secret, sql } from './db.js';
import { header } from './http.js';
import type { Req } from './http.js';

export interface SessionUser { id: string; email: string; name: string; isAdmin: boolean }

/** The signed-in user for this request, or null. The user is looked up in the database, so a deleted account stops working at once. */
export async function currentUser(req: Req): Promise<SessionUser | null> {
  const token = cookieValue(header(req, 'cookie'));
  const id = token ? readToken(token, secret()) : null;
  if (!id) return null;
  const rows = (await sql()`SELECT id, email, name, is_admin, disabled FROM users WHERE id = ${id}`) as { id: string; email: string; name: string; is_admin: boolean; disabled: boolean }[];
  return rows[0] && !rows[0].disabled ? { id: rows[0].id, email: rows[0].email, name: rows[0].name, isAdmin: rows[0].is_admin } : null;
}
