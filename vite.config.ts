import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOc } from './findOc.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const oc = findOc(root);
if (!oc.js || !oc.wasm) console.warn(`[ultraplast] OpenCascade files not found in ${oc.pkg}. The site will build, but STEP export will report an error until replicad-opencascadejs is installed.`);
else console.log(`[ultraplast] OpenCascade files: ${path.relative(root, oc.js)}, ${path.relative(root, oc.wasm)}`);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@oc\/single$/, replacement: oc.js ?? path.join(root, 'src/exporters/oc-missing.js') },
      { find: /^@oc\/wasm/, replacement: oc.wasm ?? path.join(root, 'src/exporters/oc-missing.wasm') },
    ],
  },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
