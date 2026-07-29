#!/usr/bin/env node
import { formatCliError, runCli } from './run';

runCli().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
