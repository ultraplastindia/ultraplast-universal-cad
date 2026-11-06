import { openDB } from 'idb';
import type { AssemblyLike, Project } from './project.ts';
import { newId } from './project.ts';
import { authReady, cloudDelete, cloudGet, cloudList, cloudPut, isCloud } from '../cloud/client.ts';

/* Where designs live:
 *  - signed in to the cloud database (Neon): in the database, so they follow you to any computer;
 *  - otherwise: in this browser (IndexedDB), exactly as in earlier versions.
 * The functions below keep the same names and results, so the pages need no changes. */

const dbp = () => openDB('ultraplast-designer', 2, { upgrade(d) { if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' }); if (!d.objectStoreNames.contains('assemblies')) d.createObjectStore('assemblies', { keyPath: 'id' }); } });
const cloud = async (): Promise<boolean> => { await authReady(); return isCloud(); };
const stamp = <T extends { updatedAt: string }>(x: T): T => ({ ...x, updatedAt: new Date().toISOString() });

/* ---------- browser storage (always available) ---------- */
export async function localListProjects(): Promise<Project[]> {
  const all: Project[] = await (await dbp()).getAll('projects');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function localListAssemblies(): Promise<AssemblyLike[]> { return ((await (await dbp()).getAll('assemblies')) as AssemblyLike[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }

/* ---------- designs ---------- */
export async function listProjects(): Promise<Project[]> { return (await cloud()) ? cloudList<Project>('project') : localListProjects(); }
export async function getProject(id: string): Promise<Project | undefined> { return (await cloud()) ? cloudGet<Project>(id) : (await dbp()).get('projects', id); }
export async function saveProject(p: Project): Promise<void> {
  const q = stamp(p);
  if (await cloud()) await cloudPut('project', q.id, q.name, q.familyId, q); else await (await dbp()).put('projects', q);
}
export async function deleteProject(id: string): Promise<void> { if (await cloud()) await cloudDelete(id); else await (await dbp()).delete('projects', id); }
export async function duplicateProject(id: string): Promise<Project | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  const now = new Date().toISOString();
  const copy = { ...p, id: newId(), name: `${p.name} (copy)`, createdAt: now, updatedAt: now };
  await saveProject(copy);
  return copy;
}
export async function renameProject(id: string, name: string): Promise<void> {
  const p = await getProject(id);
  if (p) await saveProject({ ...p, name: name.trim().slice(0, 120) || p.name });
}

/* ---------- assemblies ---------- */
export async function listAssemblies(): Promise<AssemblyLike[]> { return (await cloud()) ? cloudList<AssemblyLike>('assembly') : localListAssemblies(); }
export async function saveAssembly(a: AssemblyLike): Promise<void> {
  const q = stamp(a);
  if (await cloud()) await cloudPut('assembly', q.id, q.name, null, q); else await (await dbp()).put('assemblies', q);
}
export async function deleteAssembly(id: string): Promise<void> { if (await cloud()) await cloudDelete(id); else await (await dbp()).delete('assemblies', id); }
