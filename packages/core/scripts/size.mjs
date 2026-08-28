// pillar 2 gate. Two of these are budgets and one is a canary, and the difference matters:
// nothing ships the whole surface (sideEffects: false means a bundler keeps what you import), so
// its number is a trend line, while the two above it are what a real consumer actually pays.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// what a site that uses verbaly without a framework imports, measured instead of guessed
const REAL_APP = [
  'createVerbaly',
  'bindDom',
  'localeFromPath',
  'localePath',
  'switchLocale',
  'localeDirection',
];

const SURFACES = [
  {
    name: 'tree-shaken createVerbaly',
    code: "export { createVerbaly } from './dist/index.js';",
    budget: 3.25,
  },
  {
    name: 'a real app (runtime + dom + locale)',
    code: `export { ${REAL_APP.join(', ')} } from './dist/index.js';`,
    budget: 6.1,
  },
  { name: 'devtools', code: "export * from './dist/devtools.js';", budget: 1.75 },
  {
    name: 'every export at once (canary, nobody ships this)',
    code: "export * from './dist/index.js';",
    budget: 7.5,
  },
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
  const room = (((budget - kb) / budget) * 100).toFixed(0);
  if (over) failed = true;
  console.log(
    `${over ? '✗' : '✓'} ${name}: ${kb.toFixed(2)} KB min+gzip (budget ${budget.toFixed(2)}, ${room}% room)`,
  );
}

if (failed) {
  console.error(
    '[verbaly] size budget exceeded: shrink the change or raise the budget consciously (pillar 2, document it in the changelog)',
  );
  process.exit(1);
}
