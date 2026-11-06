import { useSyncExternalStore } from 'react';

/** Browser side of the Neon cloud database. If the website has no database set up (or you run it locally with `npm run dev`),
 *  `configured` stays false and the app keeps using the browser storage exactly as before. */
export interface CloudUser { id: string; email: string; name: string; isAdmin: boolean }
export interface AuthState { ready: boolean; configured: boolean; user: CloudUser | null }

let state: AuthState = { ready: false, configured: false, user: null };
const listeners = new Set<() => void>();
const set = (s: Partial<AuthState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
export const useAuth = (): AuthState => useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
export const getAuth = (): AuthState => state;
export const isCloud = (): boolean => state.configured && state.user !== null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init, headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers });
  const type = r.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error(r.ok ? 'Unexpected reply from the server.' : `Server error (${r.status}).`);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Server error (${r.status}).`);
  return j;
}

let first: Promise<void> | null = null;
/** Asks the server who is signed in (once at start-up; call refreshAuth() to ask again). */
export function refreshAuth(): Promise<void> {
  return call<{ configured: boolean; user: CloudUser | null }>('/api/account').then((j) => set({ ready: true, configured: j.configured, user: j.user }), () => set({ ready: true, configured: false, user: null }));
}
export const authReady = (): Promise<void> => (first ??= refreshAuth());

export async function register(email: string, password: string, name: string, code: string): Promise<void> {
  const j = await call<{ user: CloudUser }>('/api/account', { method: 'POST', body: JSON.stringify({ action: 'register', email, password, name, code }) });
  set({ user: j.user });
}
export async function login(email: string, password: string): Promise<void> {
  const j = await call<{ user: CloudUser }>('/api/account', { method: 'POST', body: JSON.stringify({ action: 'login', email, password }) });
  set({ user: j.user });
}
export async function logout(): Promise<void> {
  await call('/api/account', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
  set({ user: null });
}

/* ---------- designs and assemblies ---------- */
export type Kind = 'project' | 'assembly';
interface Row<T> { id: string; name: string; familyId: string | null; data: T; updatedAt: string }
export async function cloudList<T extends { updatedAt: string }>(kind: Kind): Promise<T[]> {
  const j = await call<{ items: Row<T>[] }>(`/api/designs?kind=${kind}`);
  return j.items.map((r) => ({ ...r.data, updatedAt: r.updatedAt }));
}
export async function cloudGet<T extends { updatedAt: string }>(id: string): Promise<T | undefined> {
  try { const r = await call<Row<T>>(`/api/designs?id=${encodeURIComponent(id)}`); return { ...r.data, updatedAt: r.updatedAt }; } catch (e) { if (e instanceof Error && /Not found/.test(e.message)) return undefined; throw e; }
}
export async function cloudPut(kind: Kind, id: string, name: string, familyId: string | null, data: object): Promise<void> {
  await call('/api/designs', { method: 'PUT', body: JSON.stringify({ kind, id, name, familyId, data }) });
}
export async function cloudDelete(id: string): Promise<void> { await call(`/api/designs?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); }

/* ---------- uploaded pictures ---------- */
export interface UploadInfo { id: string; name: string; mime: string; designId: string | null; createdAt: string }
export async function listUploads(): Promise<UploadInfo[]> { return (await call<{ items: UploadInfo[] }>('/api/uploads')).items; }
export async function putUpload(id: string, name: string, mime: string, base64: string, designId: string | null): Promise<void> {
  await call('/api/uploads', { method: 'POST', body: JSON.stringify({ id, name, mime, data: base64, designId }) });
}
export async function getUpload(id: string): Promise<{ mime: string; data: string }> { return call(`/api/uploads?id=${encodeURIComponent(id)}`); }
export async function deleteUpload(id: string): Promise<void> { await call(`/api/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); }

/* ---------- reference tables (administrator) ---------- */
export async function listReference(): Promise<{ key: string; updatedAt: string }[]> { return (await call<{ items: { key: string; updatedAt: string }[] }>('/api/reference')).items; }
export async function putReference(key: string, data: unknown): Promise<void> { await call('/api/reference', { method: 'PUT', body: JSON.stringify({ key, data }) }); }

/* ---------- component type library ---------- */
export interface TypeRow { id: string; name: string; category: string; base: string; kind: 'dedicated' | 'value' | 'assembly'; params: Record<string, string | number | boolean>; note: string; builtin: boolean }
export async function listTypes(): Promise<TypeRow[]> { return (await call<{ items: TypeRow[] }>('/api/types')).items; }
export async function putTypes(types: TypeRow[]): Promise<void> { await call('/api/types', { method: 'PUT', body: JSON.stringify({ types }) }); }
export async function deleteType(id: string): Promise<void> { await call(`/api/types?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); }
