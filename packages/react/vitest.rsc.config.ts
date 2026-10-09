import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// React as a Server Component gets it: the react-server build, which has no createContext
export default defineConfig({
  resolve: {
    alias: {
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
    conditions: ['react-server'],
  },
  ssr: { resolve: { conditions: ['react-server'], externalConditions: ['react-server'] } },
  test: {
    testTimeout: 20000,
    name: 'react/rsc',
    include: ['test/rsc.test.tsx'],
  },
});
