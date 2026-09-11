#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { counted, formatCliError, loadConfig } from '@verbaly/compiler';
import { buildState } from './api';
import { startStudio } from './server';

try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !Number.isInteger(port)) {
    throw new Error(`[verbaly] --port needs a number, got "${values.port}"`);
  }
  const cfg = await loadConfig(values.root ?? process.cwd());

  // --json is the state the interface reads, on stdout, before any interface exists.
  if (values.json) {
    console.log(JSON.stringify(await buildState(cfg), null, 2));
  } else {
    const studio = await startStudio(cfg, { port });
    const state = await buildState(cfg);
    const missing = state.status.locales.reduce((n, l) => n + (l.total - l.translated), 0);
    const drafts = Object.values(state.drafts).reduce((n, keys) => n + keys.length, 0);
    console.log(`\n  Verbaly Studio   ${studio.url}`);
    console.log(`  Project          ${cfg.root}`);
    console.log(
      `  Catalog          ${counted(state.status.messages, 'message')} · ` +
        `${missing} untranslated · ${counted(drafts, 'draft')}`,
    );
    for (const problem of state.problems) console.log(`  ! ${problem.scope}: ${problem.message}`);
    console.log('\n  Ctrl+C to stop\n');
  }
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = 1;
}
