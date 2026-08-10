import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Consume the contracts as TS source, not its CommonJS build: the build
      // targets the NestJS API, and a browser cannot ESM-import CJS. This also
      // means an edit to a contract hot-reloads here with no rebuild step.
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
    port: 5174,
    strictPort: true,
  },
});
