import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // the preact run is a second project of @verbaly/react, not a second package: naming it
    // here is what makes CI (pnpm coverage) cover it, since react's own config excludes it
    projects: ['packages/*', 'packages/react/vitest.preact.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.svelte', '**/cli.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
