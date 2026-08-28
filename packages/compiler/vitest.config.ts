import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  // conformance runs under vitest.dom.config.ts: node here, a DOM there, never both
  test: {
    testTimeout: 20000,
    exclude: [
      'test/conformance.test.ts',
      'test/journey.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
