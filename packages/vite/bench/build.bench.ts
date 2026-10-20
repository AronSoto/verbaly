import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, extractProject, loadCatalogs, resolveConfig, syncProject } from '@verbaly/compiler';
import { build, type Plugin } from 'vite';
import { test } from 'vitest';
import { gatePass } from '../../compiler/src/validate';
import verbaly from '../src/index';

// the small app runs on every release; the big one holds more texts than the core's AST cache
const SIZES = [200, 1500];
const PER_MODULE = 10;
const VENDOR = 300;
const ROUNDS = 5;
const LOCALES = { sourceLocale: 'en', locales: ['en', 'es'] };

const core = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));

function makeApp(modules: number): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-build-bench-'));
  const vendor = join(root, 'node_modules', 'bench-ui');
  mkdirSync(join(root, 'src'));
  mkdirSync(vendor, { recursive: true });
  writeFileSync(join(vendor, 'package.json'), '{ "name": "bench-ui", "type": "module" }');
  // what Memos paid for: modules with no text that hooks without filters still read
  for (let v = 0; v < VENDOR; v++) {
    const body = Array.from({ length: 20 }, (_, i) => `  if (x === ${i}) return '${v}:${i}';`);
    writeFileSync(
      join(vendor, `v${v}.js`),
      `export function v${v}(x) {\n${body.join('\n')}\n  return String(x);\n}\n`,
    );
  }
  for (let m = 0; m < modules; m++) {
    const texts = Array.from({ length: PER_MODULE }, (_, k) =>
      k % 3 === 0
        ? `t\`Hello \${name}, this is screen ${m}.${k}\``
        : k % 3 === 1
          ? `t\`{\${count} | one: # file in folder ${m}.${k} | other: # files in folder ${m}.${k}}\``
          : `t\`Total for ${m}.${k}: {\${total}:currency/EUR}\``,
    );
    const code =
      `import { t } from 'virtual:verbaly';\n` +
      `import { v${m % VENDOR} as ui } from 'bench-ui/v${m % VENDOR}.js';\n` +
      `export const m${m} = (name, count, total) => [\n  ${texts.join(',\n  ')},\n].map(ui);\n`;
    writeFileSync(join(root, 'src', `m${m}.js`), code);
  }
  const own = Array.from({ length: modules }, (_, m) => `m${m}`);
  const deps = Array.from({ length: VENDOR }, (_, v) => `v${v}`);
  const main = [
    ...own.map((name) => `import { ${name} } from './${name}.js';`),
    ...deps.map((name) => `import { ${name} } from 'bench-ui/${name}.js';`),
    `console.log([${own.join(', ')}].map((f) => f('Ana', 2, 3)), [${deps.join(', ')}].length);`,
  ];
  writeFileSync(join(root, 'src', 'main.js'), `${main.join('\n')}\n`);
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.js"></script>\n');
  return root;
}

// the same build with virtual:verbaly as a plain module: what the app costs without Verbaly
const stub: Plugin = {
  name: 'bench-stub',
  resolveId: (id) => (id === 'virtual:verbaly' ? '\0bench-stub' : undefined),
  load: (id) =>
    id === '\0bench-stub' ? 'export const t = (s, ...v) => String.raw(s, ...v);' : undefined,
};

async function timeBuild(root: string, plugins: Plugin[]): Promise<number> {
  const start = performance.now();
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    resolve: { alias: { verbaly: core } },
    build: { write: false },
  });
  return performance.now() - start;
}

async function timed(work: () => unknown): Promise<number> {
  const start = performance.now();
  await work();
  return performance.now() - start;
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]!;

for (const modules of SIZES) {
  test(`a vite build of ${modules} modules with verbaly against the same build without it`, async () => {
    const root = makeApp(modules);
    try {
      const cfg = resolveConfig({ root, ...LOCALES });
      await syncProject(cfg);
      // every key translated, each with its own text, as a translated app ships them
      const en = JSON.parse(readFileSync(join(cfg.dir, 'en.json'), 'utf8')) as Record<
        string,
        string
      >;
      const es = Object.fromEntries(Object.entries(en).map(([key, text]) => [key, `ES ${text}`]));
      writeFileSync(join(cfg.dir, 'es.json'), JSON.stringify(es, null, 2));

      const rows = { without: [], withIt: [], scan: [], gateFirst: [], gateAgain: [] } as Record<
        string,
        number[]
      >;
      // one warm-up of each, then alternated rounds: this machine's load drifts within a minute
      await timeBuild(root, [stub]);
      await timeBuild(root, [verbaly(LOCALES)]);
      for (let round = 0; round < ROUNDS; round++) {
        const start = performance.now();
        const registry = await extractProject(cfg);
        rows.scan!.push(performance.now() - start);
        // an empty pass forgets every tree; core's AST cache is per process and still holds its cap
        gatePass(() => undefined);
        rows.gateFirst!.push(await timed(() => check(cfg, loadCatalogs(cfg), registry)));
        rows.gateAgain!.push(await timed(() => check(cfg, loadCatalogs(cfg), registry)));
        rows.without!.push(await timeBuild(root, [stub]));
        rows.withIt!.push(await timeBuild(root, [verbaly(LOCALES)]));
      }
      const [a, b] = [median(rows.without!), median(rows.withIt!)];
      const ms = (key: string) => `${median(rows[key]!).toFixed(0)} ms`;
      console.log(
        `vite build, ${modules} modules with ${modules * PER_MODULE} messages in 2 languages and ` +
          `${VENDOR} in node_modules (median of ${ROUNDS} builds in one process, as watch makes them):\n` +
          `  without verbaly ${a.toFixed(0)} ms  |  with verbaly ${b.toFixed(0)} ms  ` +
          `(+${(b - a).toFixed(0)} ms, ${(b / a).toFixed(2)}x)\n` +
          `  scan ${ms('scan')}  |  gate ${ms('gateFirst')} with its memo empty, ` +
          `${ms('gateAgain')} on a rebuild`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
