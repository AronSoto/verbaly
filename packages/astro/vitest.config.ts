import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      '@verbaly/vite': fileURLToPath(new URL('../vite/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
