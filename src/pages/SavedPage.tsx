import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteProject, duplicateProject, listProjects, renameProject, saveProject } from '../storage/db.ts';
import { parseProject, serializeProject } from '../storage/project.ts';
import type { Project } from '../storage/project.ts';
import { FAMILIES, getFamily } from '../families/index.ts';
import { download } from '../exporters/index.ts';
import { go } from '../ui/router.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { toast } from '../ui/Toast.tsx';
import { useAuth } from '../cloud/client.ts';
import { parseDoc, serializeDoc, STUDIO_FAMILY } from '../studio/model.ts';
import { saveStudio } from '../studio/store.ts';

export function SavedPage() {
  const auth = useAuth();
  const [items, setItems] = useState<Project[]>([]);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => { listProjects().then(setItems).catch(() => setMsg(auth.user ? 'Could not read your cloud designs. Check your connection and try again.' : 'Local storage is not available in this browser.')); }, []);
  useEffect(refresh, [refresh, auth.user, auth.ready]);
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      // Design Studio files have their own format; everything else is a component project
      if (text.includes('"ultraplast-studio"')) await saveStudio(parseDoc(text).doc); else await saveProject(parseProject(text, FAMILIES));
      setMsg('Project imported.'); toast('Project imported.', 'ok'); refresh();
    } catch (e) { const m = e instanceof Error ? e.message : 'Import failed.'; setMsg(m); toast(m, 'err'); }
    if (file.current) file.current.value = '';
  };
  return (
    <div className="page">
      <PageHeader title="Saved designs" subtitle={auth.user ? 'Stored in your cloud database account. Export a file to keep a backup copy.' : 'Stored in this browser only. Sign in (Account) to keep them in the cloud database.'} />
      <p className="muted">{auth.user ? 'These designs are stored in your cloud database account and open on any computer where you sign in.' : 'Designs are stored only in this browser (IndexedDB) on this device. They are not synchronised to other devices and can be lost if browser data is cleared. Use Export to keep a backup file, or sign in (Account) to store them in the cloud database.'}</p>
      <div className="actions"><input className="filterbox" placeholder="Search saved designs by name or component" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved designs" /><button onClick={() => file.current?.click()}>Import project file</button><input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} /></div>
      {msg && <p>{msg}</p>}
      <table className="tbl wide"><thead><tr><th>Name</th><th>Component</th><th>Updated</th><th /></tr></thead><tbody>
        {items.filter((p) => !q || `${p.name} ${p.familyId === STUDIO_FAMILY ? 'Design Studio' : getFamily(p.familyId)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())).map((p) => (
          <tr key={p.id}><td>{p.name}</td><td>{p.familyId === STUDIO_FAMILY ? 'Design Studio' : getFamily(p.familyId)?.name ?? p.familyId}</td><td>{new Date(p.updatedAt).toLocaleString()}</td>
            <td className="actions">
              <button onClick={() => go(p.familyId === STUDIO_FAMILY ? `studio?id=${encodeURIComponent(p.id)}` : `designer/${p.familyId}?project=${p.id}`)}>Open</button>
              <button onClick={async () => { const n = window.prompt('New name', p.name); if (n) { await renameProject(p.id, n); refresh(); } }}>Rename</button>
              <button onClick={async () => { await duplicateProject(p.id); refresh(); }}>Duplicate</button>
              <button onClick={() => download(p.familyId === STUDIO_FAMILY ? { name: `${p.name.replace(/[^\w-]+/g, '_')}.ultraplast-studio.json`, blob: new Blob([serializeDoc(parseDoc(JSON.stringify(p)).doc)], { type: 'application/json' }) } : { name: `${p.name.replace(/[^\w-]+/g, '_')}.ultraplast.json`, blob: new Blob([serializeProject(p)], { type: 'application/json' }) })}>Export</button>
              <button onClick={async () => { if (window.confirm(`Delete "${p.name}"?`)) { await deleteProject(p.id); refresh(); } }}>Delete</button>
            </td></tr>
        ))}
        {!items.length && <tr><td colSpan={4} className="muted">No saved designs yet. Open a component and press "Save design".</td></tr>}
      </tbody></table>
    </div>
  );
}
