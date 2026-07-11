#!/usr/bin/env node
import { runCli } from './run';

runCli().catch((error: unknown) => {
  console.error('[verbaly]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
