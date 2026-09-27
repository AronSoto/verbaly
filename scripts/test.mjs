import { spawnSync } from 'node:child_process';

// every package reports even when one fails, and a capped worker pool held green under load
const run = spawnSync('pnpm -r --no-bail --no-sort test', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '4' },
});

process.exit(run.status ?? 1);
