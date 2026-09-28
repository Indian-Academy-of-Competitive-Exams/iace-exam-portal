import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Its twin is CACHE in public/sw.js, which is served as written and cannot import. */
const SW_CACHE_NAME = 'iace-shell-dev';

/** Names the worker's cache for the build, so a deploy installs a fresh shell and drops the last one's assets. */
function stampServiceWorker(): Plugin {
  return {
    name: 'iace:stamp-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const file = join(options.dir ?? 'dist', 'sw.js');
      const source = readFileSync(file, 'utf8');
      if (!source.includes(SW_CACHE_NAME))
        throw new Error(`sw.js no longer names ${SW_CACHE_NAME}`);
      const build = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12);
      writeFileSync(file, source.replace(SW_CACHE_NAME, `iace-shell-${build}`));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  resolve: {
    alias: {
      // Consume contracts as TS source, not its CJS build — a browser cannot ESM-import CJS, and edits hot-reload with no rebuild.
      '@iace/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
    // Workspace packages ship TS source and must share one React instance.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@iace/ui', '@iace/contracts'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
