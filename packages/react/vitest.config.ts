import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 20000 },
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: { exclude: ['**/node_modules/**', 'test/preact.test.tsx'] },
});
