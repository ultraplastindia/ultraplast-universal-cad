import { analyse, loadAi, meshFile, meshStart, meshStatus, order } from './_lib/ai.js';
import { configured, ensureSchema, sql } from './_lib/db.js';
import { bodyOf, fail, guardWrite, param, send } from './_lib/http.js';
import type { Req, Res } from './_lib/http.js';
import { currentUser } from './_lib/session.js';
import { canAi } from './_lib/roles.js';
import { imageMatches } from './_lib/files.js';

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** AI helpers for any signed-in user. Keys stay on the server; the browser only ever sees results.
 *  GET  /api/ai                          -> which AI services are switched on
 *  POST /api/ai {action:'analyse', mime, data}   picture -> part type + relative proportions
 *  POST /api/ai {action:'mesh', mime, data}      picture -> 3D mesh (GLB base64) or a job id
 *  GET  /api/ai?job=ID                   -> mesh job status (Meshy)
 *  GET  /api/ai?file=URL                 -> finished GLB from Meshy (host-checked) */
export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (!configured()) { fail(res, 503, 'Cloud database is not set up.'); return; }
    await ensureSchema();
    const me = await currentUser(req);
    if (!me) { fail(res, 401, 'Please sign in.'); return; }
    const s = await loadAi();
    if (req.method === 'GET') {
      const job = param(req, 'job'), file = param(req, 'file');
      if (job) { send(res, 200, await meshStatus(s, job)); return; }
      if (file) { const buf = await meshFile(file); res.setHeader('Content-Type', 'application/json'); send(res, 200, { glb: buf.toString('base64') }); return; }
      send(res, 200, { vision: order(s, 'vision'), mesh: order(s, 'mesh'), dailyLimit: s.dailyLimit });
      return;
    }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return; }
    if (!guardWrite(req, res)) return;
    if (!canAi(me.role)) { fail(res, 403, 'AI helpers are not available for your role. Ask the administrator.'); return; }
    const b = bodyOf(req), action = String(b.action ?? ''), mime = String(b.mime ?? ''), data = String(b.data ?? '');
    if (action !== 'analyse' && action !== 'mesh') { fail(res, 400, 'Unknown action.'); return; }
    if (!MIMES.has(mime)) { fail(res, 400, 'Use a JPEG, PNG or WebP picture.'); return; }
    if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 3_500_000) { fail(res, 400, 'The picture is too large (limit about 2.5 MB). Use the smaller copy.'); return; }
    if (!imageMatches(mime, data)) { fail(res, 400, 'The file is not really a picture of that type.'); return; }
    // daily limit per user (0 = no AI calls allowed)
    const used = (await sql()`INSERT INTO ai_usage (user_id, n) VALUES (${me.id}, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = ai_usage.n + 1 RETURNING n`) as { n: number }[];
    if (used[0].n > s.dailyLimit) { await sql()`UPDATE ai_usage SET n = n - 1 WHERE user_id = ${me.id} AND day = current_date`; fail(res, 429, `Daily AI limit reached (${s.dailyLimit} per person). Try tomorrow or ask the administrator.`); return; }
    try {
      if (action === 'analyse') send(res, 200, await analyse(s, { mime, base64: data }));
      else send(res, 200, await meshStart(s, { mime, base64: data }));
    } catch (e) {
      await sql()`UPDATE ai_usage SET n = greatest(n - 1, 0) WHERE user_id = ${me.id} AND day = current_date`; // a failed call does not count
      fail(res, 502, e instanceof Error ? e.message : 'The AI service failed.');
    }
  } catch (e) {
    console.error('ai error', e instanceof Error ? e.message : e);
    fail(res, 500, 'Server error. Check the Vercel function logs.');
  }
}
