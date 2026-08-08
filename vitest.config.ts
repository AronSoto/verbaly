import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // globbed, not listed: a second config used to be invisible here until a release caught it
    projects: ['packages/*', 'packages/*/vitest.*.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.svelte', '**/cli.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
