import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.svelte', '**/cli.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
