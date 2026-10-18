import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// a whole vite build per round, so it lives apart from the package's own suite
export default defineConfig({
  test: {
    // the name is explicit or it collides with the base config on the derived package name
    name: 'vite/bench',
    include: ['bench/**/*.bench.ts'],
    testTimeout: 120000,
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: {
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
