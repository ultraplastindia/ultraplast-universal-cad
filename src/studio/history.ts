import type { StudioDoc, Version } from './model.ts';
import { parseDoc, serializeDoc, uid } from './model.ts';

/* Undo/redo and named versions. Documents are immutable objects, so the undo history simply keeps references (cheap).
 * Versions are stored inside the design (without pictures) so no database change is needed. */

export interface History { past: { doc: StudioDoc; label: string }[]; future: { doc: StudioDoc; label: string }[] }
export const MAX_UNDO = 150;
export const emptyHistory = (): History => ({ past: [], future: [] });
export function pushHistory(h: History, prev: StudioDoc, label: string): History { return { past: [...h.past.slice(-(MAX_UNDO - 1)), { doc: prev, label }], future: [] }; }
export function undo(h: History, cur: StudioDoc): { h: History; doc: StudioDoc; label: string } | null {
  const last = h.past[h.past.length - 1]; if (!last) return null;
  return { h: { past: h.past.slice(0, -1), future: [{ doc: cur, label: last.label }, ...h.future] }, doc: last.doc, label: last.label };
}
export function redo(h: History, cur: StudioDoc): { h: History; doc: StudioDoc; label: string } | null {
  const nx = h.future[0]; if (!nx) return null;
  return { h: { past: [...h.past, { doc: cur, label: nx.label }], future: h.future.slice(1) }, doc: nx.doc, label: nx.label };
}

export const MAX_VERSIONS = 30;
/** Adds a named version (snapshot without pictures and without older versions). */
export function addVersion(d: StudioDoc, label: string, by: string): StudioDoc {
  const snap = serializeDoc({ ...d, versions: [], refs: d.refs.map((r) => ({ ...r, dataUrl: '' })) });
  const v: Version = { id: uid('v'), label: label.slice(0, 80) || `Version ${d.version}`, at: new Date().toISOString(), by, snapshot: snap };
  return { ...d, versions: [...d.versions, v].slice(-MAX_VERSIONS) };
}
/** Restores a version. Pictures are taken from the current design (they are never stored twice); the version list is kept. */
export function restoreVersion(d: StudioDoc, versionId: string): StudioDoc | { error: string } {
  const v = d.versions.find((x) => x.id === versionId); if (!v) return { error: 'Version not found.' };
  try {
    const { doc } = parseDoc(v.snapshot);
    const refs = doc.refs.map((r) => ({ ...r, dataUrl: d.refs.find((c) => c.id === r.id)?.dataUrl ?? r.dataUrl }));
    return { ...doc, id: d.id, versions: d.versions, refs, version: d.version, updatedAt: new Date().toISOString() };
  } catch (e) { return { error: e instanceof Error ? e.message : 'The version could not be read.' }; }
}
/** A copy of the design with a new id (pictures kept, versions dropped). */
export function duplicateDoc(d: StudioDoc): StudioDoc { const now = new Date().toISOString(); return { ...d, id: uid('s_'), name: `${d.name} (copy)`, version: 1, createdAt: now, updatedAt: now, versions: [] }; }
