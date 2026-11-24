/* Saving Design Studio designs. They are stored with the other saved designs (same table / same browser store, family "studio"),
 * so no database change is needed. The cloud table accepts about 1.5 MB per design: when a design is larger, its pictures are stored
 * as separate uploads and only their ids are kept in the design. */
import { openDB } from 'idb';
import type { StudioDoc } from './model.ts';
import { parseDoc, serializeDoc, STUDIO_FAMILY } from './model.ts';
import { getProject, saveProject } from '../storage/db.ts';
import type { Project } from '../storage/project.ts';
import { getAuth, getUpload, isCloud, putUpload } from '../cloud/client.ts';

const CLOUD_LIMIT = 1_400_000;

/** Saves the design. Returns the upload ids of pictures that were moved to uploads, so the open design remembers them. */
export async function saveStudio(d0: StudioDoc): Promise<{ note?: string; uploaded: { id: string; uploadId: string }[] }> {
  let d = { ...d0, updatedAt: new Date().toISOString() };
  let note: string | undefined;
  const uploaded: { id: string; uploadId: string }[] = [];
  if (isCloud()) {
    if (serializeDoc(d).length > CLOUD_LIMIT) {
      // 1. move pictures to uploads (each one is kept, never overwritten)
      const refs = [];
      for (const r of d.refs) {
        if (!r.dataUrl || r.uploadId) { refs.push(r.uploadId ? { ...r, dataUrl: '' } : r); continue; }
        const m = r.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) { refs.push(r); continue; }
        const uploadId = `${d.id.slice(0, 30)}_${r.id}`.replace(/[^\w-]/g, '_').slice(0, 64);
        await putUpload(uploadId, r.name, m[1], m[2], d.id);
        uploaded.push({ id: r.id, uploadId });
        refs.push({ ...r, uploadId, dataUrl: '' });
      }
      d = { ...d, refs };
      // 2. drop the oldest versions until it fits
      while (serializeDoc(d).length > CLOUD_LIMIT && d.versions.length) { d = { ...d, versions: d.versions.slice(1) }; note = 'Older versions were removed to fit the cloud size limit.'; }
      if (serializeDoc(d).length > CLOUD_LIMIT) throw new Error('This design is too large for the cloud database (about 1.4 MB without pictures). Export it as a file instead, or split it.');
    }
  }
  const rec = { ...d, familyId: STUDIO_FAMILY, params: {} } as unknown as Project;
  await saveProject(rec);
  return { note, uploaded };
}

export async function loadStudio(id: string): Promise<StudioDoc | null> {
  const p = await getProject(id);
  if (!p) return null;
  const { doc } = parseDoc(JSON.stringify(p));
  // pictures stored as uploads come back
  const refs = await Promise.all(doc.refs.map(async (r) => { if (r.dataUrl || !r.uploadId) return r; try { const u = await getUpload(r.uploadId); return { ...r, dataUrl: `data:${u.mime};base64,${u.data}` }; } catch { return r; } }));
  return { ...doc, refs };
}

/* ---------- autosave (this browser only) ---------- */
const adb = () => openDB('ultraplast-studio', 1, { upgrade(db) { db.createObjectStore('autosave'); } });
export async function autosave(d: StudioDoc): Promise<void> { try { await (await adb()).put('autosave', { at: new Date().toISOString(), text: serializeDoc(d) }, 'current'); } catch { /* storage blocked: autosave skipped */ } }
export async function readAutosave(): Promise<{ at: string; doc: StudioDoc } | null> {
  try { const r = (await (await adb()).get('autosave', 'current')) as { at: string; text: string } | undefined; if (!r) return null; return { at: r.at, doc: parseDoc(r.text).doc }; } catch { return null; }
}
export async function clearAutosave(): Promise<void> { try { await (await adb()).delete('autosave', 'current'); } catch { /* nothing to clear */ } }
export const whoAmI = (): string => { const u = getAuth().user; return u ? `${u.name} <${u.email}>` : 'this browser'; };
