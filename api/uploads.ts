import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, param, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';

const MAX_B64 = 3_000_000; // about 2.2 MB image (Vercel allows 4.5 MB request bodies)
const ID = /^[\w-]{1,64}$/;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** GET    /api/uploads            my uploaded pictures (without the picture data)
 *  GET    /api/uploads?id=...     one picture as { mime, data(base64) }
 *  POST   /api/uploads {id,name,mime,data,designId}
 *  DELETE /api/uploads?id=... */
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
        const rows = (await q`SELECT mime, data FROM uploads WHERE id = ${id} AND owner_id = ${user.id}`) as { mime: string; data: string }[];
        if (!rows[0]) { fail(res, 404, 'Not found.'); return; }
        send(res, 200, rows[0]); return;
      }
      const rows = (await q`SELECT id, name, mime, design_id, created_at FROM uploads WHERE owner_id = ${user.id} ORDER BY created_at DESC LIMIT 200`) as { id: string; name: string; mime: string; design_id: string | null; created_at: string }[];
      send(res, 200, { items: rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, designId: r.design_id, createdAt: new Date(r.created_at).toISOString() })) }); return;
    }
    if (req.method === 'POST') {
      if (!guardWrite(req, res)) return;
      const b = bodyOf(req), id = String(b.id ?? ''), mime = String(b.mime ?? ''), data = String(b.data ?? ''), name = String(b.name ?? 'picture').slice(0, 120);
      if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
      if (!MIME.has(mime)) { fail(res, 400, 'Only JPEG, PNG or WebP pictures.'); return; }
      if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_B64) { fail(res, 413, 'Picture is invalid or too large.'); return; }
      const designId = typeof b.designId === 'string' && ID.test(b.designId) ? b.designId : null;
      const rows = (await q`INSERT INTO uploads (id, owner_id, name, mime, data, design_id) VALUES (${id}, ${user.id}, ${name}, ${mime}, ${data}, ${designId})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, data = EXCLUDED.data, design_id = EXCLUDED.design_id WHERE uploads.owner_id = EXCLUDED.owner_id RETURNING id`) as unknown[];
      if (!rows[0]) { fail(res, 409, 'This id belongs to another account.'); return; }
      send(res, 200, { ok: true }); return;
    }
    if (req.method === 'DELETE') {
      if (!guardWrite(req, res)) return;
      const id = param(req, 'id');
      if (!ID.test(id)) { fail(res, 400, 'Invalid id.'); return; }
      await q`DELETE FROM uploads WHERE id = ${id} AND owner_id = ${user.id}`;
      send(res, 200, { ok: true }); return;
    }
    fail(res, 405, 'Method not allowed.');
  } catch (e) {
    console.error('uploads error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
