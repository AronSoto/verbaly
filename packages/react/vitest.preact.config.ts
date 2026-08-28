import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      'react-dom/client': 'preact/compat/client',
      'react-dom/server': 'preact/compat/server',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      react: 'preact/compat',
    },
  },
  // environment lives here, not in a docblock; the name is explicit or it collides with react
  test: {
    testTimeout: 20000,
    name: 'react/preact',
    include: ['test/preact.test.tsx'],
    environment: 'happy-dom',
  },
});
