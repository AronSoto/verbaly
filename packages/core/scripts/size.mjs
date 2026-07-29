// pillar 2 gate: budgets keep ~8% headroom so harness variance never trips a real regression
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SURFACES = [
  {
    name: 'tree-shaken createVerbaly',
    code: "export { createVerbaly } from './dist/index.js';",
    budget: 3.75,
  },
  { name: 'full core surface', code: "export * from './dist/index.js';", budget: 6.2 },
  { name: 'devtools', code: "export * from './dist/devtools.js';", budget: 1.75 },
];

let failed = false;
for (const { name, code, budget } of SURFACES) {
  const result = await build({
    stdin: { contents: code, resolveDir: root, sourcefile: 'entry.js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const kb = gzipSync(result.outputFiles[0].contents, { level: 9 }).length / 1024;
  const over = kb > budget;
  if (over) failed = true;
  console.log(
    `${over ? '✗' : '✓'} ${name}: ${kb.toFixed(2)} KB min+gzip (budget ${budget.toFixed(2)} KB)`,
  );
}

if (failed) {
  console.error(
    '[verbaly] size budget exceeded: shrink the change or raise the budget consciously (pillar 2, document it in the changelog)',
  );
  process.exit(1);
}
