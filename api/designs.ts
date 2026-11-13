import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, param, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';
import { canWrite } from './_lib/roles.js';

const MAX_BYTES = 1_500_000;
const ID = /^[\w-]{1,64}$/;
type Row = { id: string; name: string; family_id: string | null; data: unknown; updated_at: string };
const out = (r: Row) => ({ id: r.id, name: r.name, familyId: r.family_id, data: r.data, updatedAt: new Date(r.updated_at).toISOString() });

/** GET    /api/designs?kind=project|assembly   list of my designs
 *  GET    /api/designs?id=...                  one design
 *  PUT    /api/designs {kind,id,name,familyId,data}   create or update (only my own)
 *  DELETE /api/designs?id=...                  delete (only my own) */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { fail(res, 503, 'Cloud database is not set up.'); return; }
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'Please sign in.'); return; }
    const q = sql();
    if (req.method === 'GET') {
      const id = param(req, 'id');
      if (id) {
        if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
        const rows = (await q`SELECT id, name, family_id, data, updated_at FROM designs WHERE id = ${id} AND owner_id = ${user.id}`) as Row[];
        if (!rows[0]) { fail(res, 404, 'Not found.'); return; }
        send(res, 200, out(rows[0])); return;
      }
      const kind = param(req, 'kind');
      if (kind !== 'project' && kind !== 'assembly') { fail(res, 400, 'kind must be project or assembly.'); return; }
      const rows = (await q`SELECT id, name, family_id, data, updated_at FROM designs WHERE owner_id = ${user.id} AND kind = ${kind} ORDER BY updated_at DESC LIMIT 1000`) as Row[];
      send(res, 200, { items: rows.map(out) }); return;
    }
    if (req.method === 'PUT') {
      if (!guardWrite(req, res)) return;
      if (!canWrite(user.role)) { fail(res, 403, 'Your role is read-only (viewer). Ask the administrator for more access.'); return; }
      const b = bodyOf(req), kind = String(b.kind ?? ''), id = String(b.id ?? ''), name = String(b.name ?? '').trim().slice(0, 120);
      if (kind !== 'project' && kind !== 'assembly') { fail(res, 400, 'kind must be project or assembly.'); return; }
      if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
      if (!name) { fail(res, 400, 'Name is required.'); return; }
      if (!b.data || typeof b.data !== 'object') { fail(res, 400, 'Design data is missing.'); return; }
      const json = JSON.stringify(b.data);
      if (json.length > MAX_BYTES) { fail(res, 413, 'Design is too large.'); return; }
      const fam = typeof b.familyId === 'string' ? b.familyId.slice(0, 64) : null;
      const rows = (await q`INSERT INTO designs (id, owner_id, kind, name, family_id, data) VALUES (${id}, ${user.id}, ${kind}, ${name}, ${fam}, ${json}::jsonb)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, family_id = EXCLUDED.family_id, data = EXCLUDED.data, updated_at = now() WHERE designs.owner_id = EXCLUDED.owner_id
        RETURNING id, name, family_id, data, updated_at`) as Row[];
      if (!rows[0]) { fail(res, 409, 'This id belongs to another account.'); return; }
      send(res, 200, out(rows[0])); return;
    }
    if (req.method === 'DELETE') {
      if (!guardWrite(req, res)) return;
      if (!canWrite(user.role)) { fail(res, 403, 'Your role is read-only (viewer). Ask the administrator for more access.'); return; }
      const id = param(req, 'id');
      if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
      await q`DELETE FROM designs WHERE id = ${id} AND owner_id = ${user.id}`;
      send(res, 200, { ok: true }); return;
    }
    fail(res, 405, 'Method not allowed.');
  } catch (e) {
    console.error('designs error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
