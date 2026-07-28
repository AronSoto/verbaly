import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: { exclude: ['**/node_modules/**', 'test/preact.test.tsx'] },
});
