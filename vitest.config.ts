import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // the preact run is a project of the root config: that is what makes pnpm coverage cover it
    projects: ['packages/*', 'packages/react/vitest.preact.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.svelte', '**/cli.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
