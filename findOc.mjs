// Locates the OpenCascade (WebAssembly) files inside the installed replicad-opencascadejs package, wherever that version keeps them.
// Newer package versions restrict deep imports with an "exports" map, so we alias to the real file paths instead.
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, name, depth) {
  if (depth < 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name === name) return path.join(dir, e.name);
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) { const r = walk(path.join(dir, e.name), name, depth - 1); if (r) return r; }
  }
  return null;
}

export function findOc(root) {
  const pkg = path.join(root, 'node_modules', 'replicad-opencascadejs');
  return { js: walk(pkg, 'replicad_single.js', 4), wasm: walk(pkg, 'replicad_single.wasm', 4), pkg };
}
