import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, param, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';

const KEYS = new Set(['catalogue', 'materials', 'chains', 'bearings', 'keys', 'components']);
const MAX_BYTES = 3_000_000;

/** Catalogue and standards tables stored in the database.
 *  GET /api/reference            -> which tables are stored and when they were updated
 *  GET /api/reference?key=...    -> one table
 *  PUT /api/reference {key,data} -> store or replace one table (administrator only) */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { fail(res, 503, 'Cloud database is not set up.'); return; }
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'Please sign in.'); return; }
    const q = sql();
    if (req.method === 'GET') {
      const key = param(req, 'key');
      if (key) {
        const rows = (await q`SELECT key, data, updated_at FROM reference_data WHERE key = ${key}`) as { key: string; data: unknown; updated_at: string }[];
        if (!rows[0]) { fail(res, 404, 'Not stored yet.'); return; }
        send(res, 200, { key, data: rows[0].data, updatedAt: new Date(rows[0].updated_at).toISOString() }); return;
      }
      const rows = (await q`SELECT key, updated_at, jsonb_typeof(data) AS type FROM reference_data ORDER BY key`) as { key: string; updated_at: string; type: string }[];
      send(res, 200, { items: rows.map((r) => ({ key: r.key, updatedAt: new Date(r.updated_at).toISOString() })) }); return;
    }
    if (req.method === 'PUT') {
      if (!guardWrite(req, res)) return;
      if (!user.isAdmin) { fail(res, 403, 'Only the administrator (first account) can change reference tables.'); return; }
      const b = bodyOf(req), key = String(b.key ?? '');
      if (!KEYS.has(key)) { fail(res, 400, 'Unknown table name.'); return; }
      if (b.data === undefined || b.data === null) { fail(res, 400, 'Data is missing.'); return; }
      const json = JSON.stringify(b.data);
      if (json.length > MAX_BYTES) { fail(res, 413, 'Table is too large.'); return; }
      await q`INSERT INTO reference_data (key, data, updated_by) VALUES (${key}, ${json}::jsonb, ${user.id}) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      send(res, 200, { ok: true }); return;
    }
    fail(res, 405, 'Method not allowed.');
  } catch (e) {
    console.error('reference error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
