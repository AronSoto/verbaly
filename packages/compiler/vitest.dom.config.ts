import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// the conformance pin needs a DOM, and a pin must not hang on one comment line surviving
export default defineConfig({
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  // the name is explicit or it collides with the base config on the derived package name
  test: {
    name: 'compiler/dom',
    include: ['test/conformance.test.ts'],
    environment: 'happy-dom',
  },
});
