import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 20000 },
  resolve: {
    alias: {
      '#imports': fileURLToPath(new URL('./test/mocks/imports.ts', import.meta.url)),
      'virtual:verbaly': fileURLToPath(new URL('./test/mocks/virtual-verbaly.ts', import.meta.url)),
      '@verbaly/compiler': fileURLToPath(new URL('../compiler/src/index.ts', import.meta.url)),
      '@verbaly/vite': fileURLToPath(new URL('../vite/src/index.ts', import.meta.url)),
      '@verbaly/vue': fileURLToPath(new URL('../vue/src/index.ts', import.meta.url)),
      verbaly: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
