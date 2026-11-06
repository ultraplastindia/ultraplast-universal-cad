import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, param, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';

const ID = /^[\w.:-]{1,80}$/;
const KINDS = new Set(['dedicated', 'value', 'assembly']);
const MAX_ITEMS = 500;
type Row = { id: string; name: string; category: string; base: string; kind: string; params: unknown; note: string; builtin: boolean; updated_at: string };
const out = (r: Row) => ({ id: r.id, name: r.name, category: r.category, base: r.base, kind: r.kind, params: r.params, note: r.note, builtin: r.builtin, updatedAt: new Date(r.updated_at).toISOString() });

/** The component type library stored in the database.
 *  GET    /api/types           -> all types (any signed-in user)
 *  PUT    /api/types {types:[{id,name,category,base,kind,params,note,builtin}]}  add or replace (administrator only)
 *  DELETE /api/types?id=...    remove one (administrator only; a built-in type then returns to its original values) */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { fail(res, 503, 'Cloud database is not set up.'); return; }
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'Please sign in.'); return; }
    const q = sql();
    if (req.method === 'GET') {
      const rows = (await q`SELECT id, name, category, base, kind, params, note, builtin, updated_at FROM component_types ORDER BY category, name`) as Row[];
      send(res, 200, { items: rows.map(out) }); return;
    }
    if (req.method === 'PUT') {
      if (!guardWrite(req, res)) return;
      if (!user.isAdmin) { fail(res, 403, 'Only the administrator (first account) can change component types.'); return; }
      const b = bodyOf(req), list = Array.isArray(b.types) ? b.types : [];
      if (!list.length || list.length > MAX_ITEMS) { fail(res, 400, `Send 1 to ${MAX_ITEMS} types.`); return; }
      const clean: Record<string, unknown>[] = [];
      for (const t of list as Record<string, unknown>[]) {
        const id = String(t?.id ?? ''), name = String(t?.name ?? '').trim().slice(0, 120), category = String(t?.category ?? ''), base = String(t?.base ?? '').slice(0, 64), kind = String(t?.kind ?? 'value');
        if (!ID.test(id) || !name || !/^[A-Z]$/.test(category) || !base || !KINDS.has(kind) || !t.params || typeof t.params !== 'object' || Array.isArray(t.params)) { fail(res, 400, `Invalid type "${id || name}".`); return; }
        clean.push({ id, name, category, base, kind, params: t.params, note: String(t.note ?? '').slice(0, 500), builtin: t.builtin === true });
      }
      const json = JSON.stringify(clean);
      if (json.length > 2_000_000) { fail(res, 413, 'Too much data in one request.'); return; }
      await q`INSERT INTO component_types (id, name, category, base, kind, params, note, builtin, updated_by)
        SELECT t.id, t.name, t.category, t.base, t.kind, t.params, t.note, t.builtin, ${user.id}::uuid FROM jsonb_to_recordset(${json}::jsonb) AS t(id text, name text, category text, base text, kind text, params jsonb, note text, builtin boolean)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, base = EXCLUDED.base, kind = EXCLUDED.kind, params = EXCLUDED.params, note = EXCLUDED.note, builtin = EXCLUDED.builtin, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      send(res, 200, { ok: true, count: clean.length }); return;
    }
    if (req.method === 'DELETE') {
      if (!guardWrite(req, res)) return;
      if (!user.isAdmin) { fail(res, 403, 'Only the administrator can delete component types.'); return; }
      const id = param(req, 'id');
      if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
      await q`DELETE FROM component_types WHERE id = ${id}`;
      send(res, 200, { ok: true }); return;
    }
    fail(res, 405, 'Method not allowed.');
  } catch (e) {
    console.error('types error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
