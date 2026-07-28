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
  // environment lives here, not in a per-file docblock: losing that one comment drops the
  // whole suite into node and every DOM assertion fails at once (@verbaly/svelte does the same)
  // name is explicit: as a project of the root config it would otherwise collide with
  // @verbaly/react (both configs read the same package.json) and vitest refuses to start
  test: {
    name: 'react/preact',
    include: ['test/preact.test.tsx'],
    environment: 'happy-dom',
  },
});
