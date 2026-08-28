import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@verbaly/svelte': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
    conditions: ['browser'], // svelte client build, not index-server
  },
  test: {
    testTimeout: 20000,
    environment: 'happy-dom',
  },
});
