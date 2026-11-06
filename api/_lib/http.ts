/** Tiny request/response types so these functions need no extra type packages. Vercel provides the real objects. */
export interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown; query: Record<string, string | string[] | undefined> }
export interface Res { status(code: number): Res; json(body: unknown): void; setHeader(name: string, value: string | string[]): void; end(body?: string): void }

export const header = (req: Req, name: string): string => { const v = req.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] ?? '' : v ?? ''; };
export const param = (req: Req, name: string): string => { const v = req.query[name]; return Array.isArray(v) ? v[0] ?? '' : v ?? ''; };

export function send(res: Res, code: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}
export const fail = (res: Res, code: number, message: string): void => send(res, code, { error: message });

/** JSON body as an object (Vercel already parses JSON; this also accepts a raw string). */
export function bodyOf(req: Req): Record<string, unknown> {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return {}; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** Blocks requests sent from another website: the Origin header (when present) must match this site's own host. */
export function sameOrigin(req: Req): boolean {
  const origin = header(req, 'origin');
  if (!origin) return true;
  try { return new URL(origin).host === (header(req, 'x-forwarded-host') || header(req, 'host')); } catch { return false; }
}

/** Common checks for functions that change data. Returns true if the request may continue. */
export function guardWrite(req: Req, res: Res): boolean {
  if (!sameOrigin(req)) { fail(res, 403, 'Request blocked (different website).'); return false; }
  if (!header(req, 'content-type').includes('application/json') && req.method !== 'DELETE') { fail(res, 415, 'Send JSON.'); return false; }
  return true;
}
