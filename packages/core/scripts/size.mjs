// pillar 2 gate: three are budgets a consumer really pays, the fourth is a canary nobody ships
import { readFileSync } from 'node:fs';
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

// [.] and [*] instead of backslash escapes, which editing tools have turned into raw bytes here
const NUMBER = '([0-9]+[.][0-9]{2})';

const SURFACES = [
  {
    name: 'tree-shaken createVerbaly',
    code: "export { createVerbaly } from './dist/index.js';",
    budget: 3.32,
    // every way a README states it: the badge, its alt text, the prose and the comparison table
    claims: [
      `gzip-${NUMBER}KB`,
      `alt="${NUMBER}KB gzip`,
      `[*]{2}${NUMBER} KB gzip[*]{2}`,
      `[*]{2}${NUMBER}KB, zero deps[*]{2}`,
      `a [*]{2}${NUMBER} KB[*]{2} runtime`,
    ],
  },
  {
    name: 'a real app (runtime + dom + locale)',
    code: `export { ${REAL_APP.join(', ')} } from './dist/index.js';`,
    budget: 6.11,
    claims: [`ships [*]{2}${NUMBER} KB[*]{2}`],
  },
  { name: 'devtools', code: "export * from './dist/devtools.js';", budget: 1.75, claims: [] },
  {
    name: 'every export at once (canary, nobody ships this)',
    code: "export * from './dist/index.js';",
    budget: 7.84,
    claims: [],
  },
];

const READMES = [
  { label: 'packages/core/README.md', text: readFileSync(join(root, 'README.md'), 'utf8') },
  { label: 'README.md', text: readFileSync(join(root, '..', '..', 'README.md'), 'utf8') },
];

let failed = false;
let stale = false;
for (const { name, code, budget, claims } of SURFACES) {
  const result = await build({
    stdin: { contents: code, resolveDir: root, sourcefile: 'entry.js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const kb = gzipSync(result.outputFiles[0].contents, { level: 9 }).length / 1024;
  const measured = kb.toFixed(2);
  const over = kb > budget;
  const room = (((budget - kb) / budget) * 100).toFixed(0);
  if (over) failed = true;
  console.log(
    `${over ? '✗' : '✓'} ${name}: ${measured} KB min+gzip (budget ${budget.toFixed(2)}, ${room}% room)`,
  );

  // a number nobody re-measures goes stale in silence, and the README is where people read it
  let found = 0;
  let wrong = 0;
  for (const readme of READMES) {
    for (const claim of claims) {
      for (const [, said] of readme.text.matchAll(new RegExp(claim, 'g'))) {
        found += 1;
        if (said === measured) continue;
        wrong += 1;
        console.log(`  ✗ ${readme.label} says ${said} KB, the gate measured ${measured}`);
      }
    }
  }
  if (wrong > 0) stale = true;
  // a guard that matches nothing guards nothing: the wording moved and the patterns stayed behind
  if (claims.length > 0 && found === 0) {
    stale = true;
    console.log('  ✗ no README states this size any more: update the claims in scripts/size.mjs');
  } else if (found > 0) {
    console.log(`  ${found - wrong} of ${found} README claims say ${measured}`);
  }
}

if (stale) {
  console.error('[verbaly] a README states a size the gate did not measure: write the one above');
}
if (failed) {
  console.error(
    '[verbaly] size budget exceeded: shrink the change or raise the budget consciously (pillar 2, document it in the changelog)',
  );
}
if (failed || stale) process.exit(1);
