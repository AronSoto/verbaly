import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 20000 },
  resolve: {
    alias: {
      // before the bare name, for the same reason as the react subpath below
      'virtual:verbaly/server': fileURLToPath(
        new URL('./test/mocks/virtual-verbaly-server.ts', import.meta.url),
      ),
      'virtual:verbaly': fileURLToPath(new URL('./test/mocks/virtual-verbaly.ts', import.meta.url)),
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      // before the bare name: an alias is a prefix, and the bare one would swallow the subpath
      '@verbaly/react/server': fileURLToPath(new URL('../react/src/server.ts', import.meta.url)),
      '@verbaly/react': fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
