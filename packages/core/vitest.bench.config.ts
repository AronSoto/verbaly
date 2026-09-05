import { defineConfig } from 'vitest/config';

// vitest 5 dropped its bench runner, so the bench is a long test that drives tinybench itself
export default defineConfig({
  test: {
    // the name is explicit or it collides with the base config on the derived package name
    name: 'core/bench',
    include: ['bench/**/*.bench.ts'],
    testTimeout: 120000,
    disableConsoleIntercept: true,
  },
});
