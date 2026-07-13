import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'virtual:verbaly': fileURLToPath(new URL('./test/mocks/virtual-verbaly.ts', import.meta.url)),
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      '@verbaly/react': fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
