import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 20000 },
  resolve: {
    alias: {
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
