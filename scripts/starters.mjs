// the official starters, README by README: create, install, wire, write, translate, build, read
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pack, root, run, tryRun } from './tarballs.mjs';

// the packages a starter installs, by folder
const PACKAGES = [
  'core',
  'compiler',
  'vite',
  'react',
  'vue',
  'svelte',
  'sveltekit',
  'next',
  'nuxt',
  'astro',
];
const npmName = (folder) => (folder === 'core' ? 'verbaly' : `@verbaly/${folder}`);
const STEP_TIMEOUT = 10 * 60_000;
const inRepo = (path) => resolve(path).toLowerCase().startsWith(root.toLowerCase());
// a new user's shell: run as `pnpm starters`, the repo's pnpm settings and bins would leak in
const ENV = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => !/^(npm|pnpm)_/i.test(key))
    .map(([key, value]) =>
      /^path$/i.test(key)
        ? [
            key,
            value
              .split(delimiter)
              .filter((entry) => !inRepo(entry))
              .join(delimiter),
          ]
        : [key, value],
    ),
);
// a telemetry notice is noise in the log, and its request is not part of what we measure
Object.assign(ENV, {
  NEXT_TELEMETRY_DISABLED: '1',
  ASTRO_TELEMETRY_DISABLED: '1',
  NUXT_TELEMETRY_DISABLED: '1',
});

// the translator's half: what each source text becomes in the second language
const TRANSLATIONS = {
  'Welcome back': 'Bienvenido de nuevo',
  'Hello {name}': 'Hola {name}',
  'You have new messages': 'Tienes mensajes nuevos',
};
const PAINTED = { en: ['Welcome back', 'Hello Ada'], es: ['Bienvenido de nuevo', 'Hola Ada'] };

class Failure extends Error {
  constructor(step, detail) {
    super(step);
    this.detail = detail;
  }
}

const lines = (...rows) => `${rows.join('\n')}\n`;

// a starter that changed shape fails here, by name, instead of building the template untouched
function edit(dir, file, pairs) {
  const path = join(dir, file);
  let code = readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (!code.includes(from)) throw new Failure('wire', `${file} has no "${from}" to edit`);
    code = code.replace(from, to);
  }
  writeFileSync(path, code);
}

const VITE_PLUGIN = [
  ['import ', "import verbaly from '@verbaly/vite';\nimport "],
  ['plugins: [', 'plugins: [verbaly(), '],
];

// a flat key of pnpm-workspace.yaml, joined with what the starter already wrote there
function addToMap(file, key, entries) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const rows = entries.map(([name, value]) => `  '${name}': ${value}`).join('\n');
  const head = new RegExp(`^${key}:[ \\t]*$`, 'm');
  // a key written inline is one this joiner cannot extend, and a second one breaks the file
  if (!head.test(text) && new RegExp(`^${key}:`, 'm').test(text)) {
    throw new Failure('starter install', `pnpm-workspace.yaml writes ${key} inline: ${text}`);
  }
  const next = head.test(text)
    ? text.replace(head, `${key}:\n${rows}`)
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}:\n${rows}\n`;
  writeFileSync(file, next);
}

function textOf(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectPainted(where, locale, page, extra = {}) {
  const want = [...PAINTED[locale], ...(extra[locale] ?? [])];
  const lost = want.filter((text) => !page.text.includes(text));
  if (lost.length > 0) {
    throw new Failure(`read ${where}`, `no "${lost.join('", "')}" in: ${page.text.slice(0, 300)}`);
  }
  if (page.lang !== undefined && page.lang !== locale) {
    throw new Failure(`read ${where}`, `the text is ${locale} but <html lang="${page.lang}">`);
  }
}

// a built single-page app, painted with no saved choice and with the second language saved
function spa(dir, extra) {
  for (const [locale, saved] of [
    ['en', []],
    ['es', ['es']],
  ]) {
    const script = join(root, 'scripts', 'render-spa.mjs');
    const out = run('node', [script, join(dir, 'dist'), ...saved], root, { timeout: 60_000 });
    expectPainted(`${locale}, saved ${saved[0] ?? 'nothing'}`, locale, JSON.parse(out), extra);
  }
  return 'en and es painted';
}

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function stop(child) {
  if (child.exitCode !== null) return;
  // a server can start workers of its own, and only the whole tree frees the port
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // it exited between the check and the kill
    }
  } else {
    child.kill('SIGTERM');
  }
}

// a server-rendered app, asked in each language the way a browser asks
function server(start) {
  return async (dir, extra) => {
    const port = await freePort();
    const child = spawn(process.execPath, start(port), {
      cwd: dir,
      env: { ...ENV, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const url = `http://localhost:${port}/`;
    try {
      const until = Date.now() + 90_000;
      for (;;) {
        if (child.exitCode !== null) throw new Failure('serve', output.slice(-1500));
        if (Date.now() > until) throw new Failure('serve', `no answer on ${url}\n${output}`);
        try {
          await (await fetch(url)).arrayBuffer();
          break;
        } catch {
          await sleep(500);
        }
      }
      for (const locale of ['en', 'es']) {
        const response = await fetch(url, { headers: { 'accept-language': locale } });
        const html = await response.text();
        if (!response.ok) throw new Failure(`read ${locale}`, `${response.status}\n${output}`);
        const lang = /<html[^>]*\slang="([^"]*)"/.exec(html)?.[1];
        expectPainted(
          `${locale}, Accept-Language ${locale}`,
          locale,
          { text: textOf(html), lang },
          extra,
        );
      }
    } finally {
      stop(child);
    }
    return 'en and es rendered by the server';
  };
}

// pages written at build time, one per language
function pages(files) {
  return (dir, extra) => {
    for (const [locale, file] of Object.entries(files)) {
      const html = readFileSync(join(dir, file), 'utf8');
      expectPainted(file, locale, { text: textOf(html) }, extra);
    }
    return 'en and es pages';
  };
}

const HOSTS = {
  'vite-react': {
    create: ['create-vite@latest', 'app', '--template', 'react-ts', '--no-interactive'],
    createFlags: ['--no-immediate'],
    add: ['verbaly', '@verbaly/react', '@verbaly/vite'],
    show: ['vite', 'react'],
    wire: (dir) => edit(dir, 'vite.config.ts', VITE_PLUGIN),
    files: {
      'src/App.tsx': lines(
        "import { useT } from '@verbaly/react';",
        '',
        'export default function App() {',
        '  const t = useT();',
        "  const name = 'Ada';",
        '  return (',
        '    <main>',
        '      <h1>{t`Welcome back`}</h1>',
        '      <p>{t`Hello ${name}`}</p>',
        '    </main>',
        '  );',
        '}',
      ),
      'src/main.tsx': lines(
        "import { StrictMode } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { resolveLocale } from 'verbaly';",
        "import { locales, setLocale } from 'verbaly/app';",
        "import App from './App.tsx';",
        '',
        'setLocale(resolveLocale({ supported: locales, path: false })).then(() => {',
        "  createRoot(document.getElementById('root')!).render(",
        '    <StrictMode>',
        '      <App />',
        '    </StrictMode>,',
        '  );',
        '});',
      ),
    },
    builds: [{ steps: [['pnpm', 'run', 'build']] }],
    read: spa,
  },
  'vite-vue': {
    create: ['create-vite@latest', 'app', '--template', 'vue-ts', '--no-interactive'],
    createFlags: ['--no-immediate'],
    add: ['verbaly', '@verbaly/vue', '@verbaly/vite'],
    show: ['vite', 'vue'],
    wire: (dir) => edit(dir, 'vite.config.ts', VITE_PLUGIN),
    files: {
      'src/App.vue': lines(
        '<script setup lang="ts">',
        "import { useT } from '@verbaly/vue';",
        'const t = useT();',
        "const name = 'Ada';",
        '</script>',
        '',
        '<template>',
        '  <main>',
        '    <h1>{{ t`Welcome back` }}</h1>',
        '    <p>{{ t`Hello ${name}` }}</p>',
        '  </main>',
        '</template>',
      ),
      'src/main.ts': lines(
        "import { createApp } from 'vue';",
        "import { resolveLocale } from 'verbaly';",
        "import { locales, setLocale } from 'verbaly/app';",
        "import App from './App.vue';",
        '',
        'const app = createApp(App);',
        "setLocale(resolveLocale({ supported: locales, path: false })).then(() => app.mount('#app'));",
      ),
    },
    builds: [{ steps: [['pnpm', 'run', 'build']] }],
    read: spa,
  },
  'vite-svelte': {
    create: ['create-vite@latest', 'app', '--template', 'svelte-ts', '--no-interactive'],
    createFlags: ['--no-immediate'],
    add: ['verbaly', '@verbaly/svelte', '@verbaly/vite'],
    show: ['vite', 'svelte'],
    wire: (dir) => edit(dir, 'vite.config.ts', VITE_PLUGIN),
    files: {
      'src/App.svelte': lines(
        '<script lang="ts">',
        "  import { useT } from '@verbaly/svelte';",
        '  const t = useT();',
        "  const name = 'Ada';",
        '</script>',
        '',
        '<main>',
        '  <h1>{$t`Welcome back`}</h1>',
        '  <p>{$t`Hello ${name}`}</p>',
        '</main>',
      ),
      'src/main.ts': lines(
        "import { mount } from 'svelte';",
        "import { resolveLocale } from 'verbaly';",
        "import { locales, setLocale } from 'verbaly/app';",
        "import App from './App.svelte';",
        '',
        'setLocale(resolveLocale({ supported: locales, path: false })).then(() =>',
        "  mount(App, { target: document.getElementById('app')! }),",
        ');',
      ),
    },
    builds: [
      {
        steps: [
          ['pnpm', 'run', 'check'],
          ['pnpm', 'run', 'build'],
        ],
      },
    ],
    read: spa,
  },
  sveltekit: {
    create: ['sv@latest', 'create', 'app', '--template', 'minimal', '--types', 'ts'],
    createFlags: ['--no-add-ons', '--no-install'],
    add: ['verbaly', '@verbaly/sveltekit', '@verbaly/svelte', '@verbaly/vite'],
    show: ['@sveltejs/kit', 'svelte', 'vite'],
    wire: (dir) => {
      edit(dir, 'vite.config.ts', VITE_PLUGIN);
      edit(dir, 'src/app.html', [
        ['<html lang="en">', '<html lang="%verbaly.lang%" dir="%verbaly.dir%">'],
      ]);
      edit(dir, 'src/app.d.ts', [
        ['// interface Locals {}', 'interface Locals {\n\t\t\tverbalyLocale: string;\n\t\t}'],
      ]);
    },
    files: {
      'src/hooks.server.ts': lines(
        "import { verbalyHandle } from '@verbaly/sveltekit';",
        "import { locales, routing } from 'verbaly/app';",
        '',
        'export const handle = verbalyHandle({ locales, routing });',
      ),
      'src/routes/+layout.server.ts': lines(
        'export const load = ({ locals }) => ({ locale: locals.verbalyLocale });',
      ),
      'src/routes/+layout.ts': lines(
        "import { createRequestInstance } from 'verbaly/app';",
        '',
        'export const load = async ({ data }) => ({',
        '  ...data,',
        '  verbaly: await createRequestInstance(data.locale),',
        '});',
      ),
      'src/routes/+layout.svelte': lines(
        '<script>',
        "  import { provideVerbaly } from '@verbaly/svelte';",
        '',
        '  let { data, children } = $props();',
        '  // svelte-ignore state_referenced_locally',
        '  provideVerbaly(data.verbaly);',
        '</script>',
        '',
        '{@render children()}',
      ),
      'src/routes/+page.svelte': lines(
        '<script lang="ts">',
        "  import { useT } from '@verbaly/svelte';",
        '  const t = useT();',
        "  const name = 'Ada';",
        '</script>',
        '',
        '<h1>{$t`Welcome back`}</h1>',
        '<p>{$t`Hello ${name}`}</p>',
      ),
    },
    builds: [
      {
        steps: [
          ['pnpm', 'run', 'check'],
          ['pnpm', 'run', 'build'],
        ],
      },
    ],
    read: server((port) => [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--port',
      String(port),
      '--strictPort',
    ]),
  },
  next: {
    create: ['create-next-app@latest', 'app', '--yes', '--use-pnpm', '--disable-git'],
    createFlags: ['--no-agent-feedback', '--skip-install'],
    add: ['verbaly', '@verbaly/next', '@verbaly/react'],
    show: ['next', 'react'],
    wire: (dir) =>
      edit(dir, 'next.config.ts', [
        ['import ', "import { withVerbaly } from '@verbaly/next';\nimport "],
        ['export default nextConfig;', 'export default withVerbaly(nextConfig);'],
      ]),
    files: {
      'app/layout.tsx': lines(
        "import { getRequestLocale, getVerbalyProps } from '@verbaly/next/server';",
        "import { VerbalyProvider } from '@verbaly/next/client';",
        "import { localeDirection } from 'verbaly';",
        '',
        'export const instant = false;',
        '',
        'export default async function RootLayout({ children }: { children: React.ReactNode }) {',
        '  const locale = await getRequestLocale();',
        '  const props = await getVerbalyProps();',
        '  return (',
        '    <html lang={locale} dir={localeDirection(locale)}>',
        '      <body>',
        '        <VerbalyProvider {...props}>{children}</VerbalyProvider>',
        '      </body>',
        '    </html>',
        '  );',
        '}',
      ),
      'app/page.tsx': lines(
        "import { getT } from '@verbaly/next/server';",
        "import { Counter } from './counter';",
        '',
        'export default async function Page() {',
        '  const t = await getT();',
        "  const name = 'Ada';",
        '  return (',
        '    <main>',
        '      <h1>{t`Welcome back`}</h1>',
        '      <p>{t`Hello ${name}`}</p>',
        '      <Counter />',
        '    </main>',
        '  );',
        '}',
      ),
      'app/counter.tsx': lines(
        "'use client';",
        "import { useT } from '@verbaly/next/client';",
        '',
        'export function Counter() {',
        '  const t = useT();',
        '  return <p>{t`You have new messages`}</p>;',
        '}',
      ),
    },
    painted: { en: ['You have new messages'], es: ['Tienes mensajes nuevos'] },
    builds: [
      { label: 'turbopack', steps: [['pnpm', 'run', 'build']] },
      { label: 'webpack', steps: [['pnpm', 'exec', 'next', 'build', '--webpack']] },
    ],
    read: server((port) => ['node_modules/next/dist/bin/next', 'start', '-p', String(port)]),
  },
  nuxt: {
    create: ['nuxi@latest', 'init', 'app', '--template', 'minimal', '--packageManager', 'pnpm'],
    createFlags: ['--gitInit', 'false', '--install', 'false'],
    add: ['verbaly', '@verbaly/nuxt', '@verbaly/vue'],
    show: ['nuxt', 'vue'],
    wire: (dir) =>
      edit(dir, 'nuxt.config.ts', [
        ['defineNuxtConfig({', "defineNuxtConfig({\n  modules: ['@verbaly/nuxt'],"],
      ]),
    files: {
      'app/app.vue': lines(
        '<script setup lang="ts">',
        "import { useT } from '@verbaly/vue';",
        'const t = useT();',
        "const name = 'Ada';",
        '</script>',
        '',
        '<template>',
        '  <main>',
        '    <h1>{{ t`Welcome back` }}</h1>',
        '    <p>{{ t`Hello ${name}` }}</p>',
        '  </main>',
        '</template>',
      ),
    },
    builds: [{ steps: [['pnpm', 'run', 'build']] }],
    read: server(() => ['.output/server/index.mjs']),
  },
  astro: {
    create: ['create-astro@latest', 'app', '--template', 'minimal', '--no-install', '--no-git'],
    createFlags: ['--skip-houston', '--yes'],
    add: ['verbaly', '@verbaly/astro'],
    show: ['astro'],
    wire: (dir) =>
      edit(dir, 'astro.config.mjs', [
        ['import ', "import verbaly from '@verbaly/astro';\nimport "],
        [
          'defineConfig({',
          "defineConfig({\n  integrations: [verbaly()],\n  i18n: { locales: ['en', 'es'], defaultLocale: 'en' },",
        ],
      ]),
    files: {
      'src/components/Greeting.astro': lines(
        '---',
        "import { createRequestInstance, sourceLocale } from 'verbaly/app';",
        '',
        'const { t } = await createRequestInstance(Astro.currentLocale ?? sourceLocale);',
        "const name = 'Ada';",
        '---',
        '',
        '<h1>{t`Welcome back`}</h1>',
        '<p>{t`Hello ${name}`}</p>',
      ),
      'src/pages/index.astro': lines(
        '---',
        "import Greeting from '../components/Greeting.astro';",
        '---',
        '',
        '<html lang="en"><body><Greeting /></body></html>',
      ),
      'src/pages/es/index.astro': lines(
        '---',
        "import Greeting from '../../components/Greeting.astro';",
        '---',
        '',
        '<html lang="es"><body><Greeting /></body></html>',
      ),
    },
    builds: [{ steps: [['pnpm', 'run', 'build']] }],
    read: pages({ en: 'dist/index.html', es: 'dist/es/index.html' }),
  },
};

function versionOf(dir, name) {
  const file = join(dir, 'node_modules', ...name.split('/'), 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : 'missing';
}

async function check(name, host, work, tarballs) {
  const base = join(work, name);
  mkdirSync(base);
  const dir = join(base, 'app');
  const log = join(base, 'starters.log');
  const step = (label, cmd, args, cwd = dir) => {
    appendFileSync(log, `\n$ ${[cmd, ...args].join(' ')}\n`);
    const result = tryRun(cmd, args, cwd, { env: ENV, timeout: STEP_TIMEOUT });
    appendFileSync(log, result.out);
    if (!result.ok) throw new Failure(label, result.out.split(/\r?\n/).slice(-25).join('\n'));
    return result.out;
  };
  const verbaly = (...args) => step(`verbaly ${args[0]}`, 'npx', ['--no', 'verbaly', ...args]);

  step('create', 'npx', ['-y', ...host.create, ...host.createFlags], base);

  // pnpm resolves the version we have not published from the tarballs, nested ones included
  const workspace = join(dir, 'pnpm-workspace.yaml');
  addToMap(
    workspace,
    'overrides',
    PACKAGES.map((folder) => [npmName(folder), `'file:${tarballs[folder].replaceAll('\\', '/')}'`]),
  );
  // the starter's own build scripts are the starter's to approve, and they come before ours
  const first = tryRun('pnpm', ['install'], dir, { env: ENV, timeout: STEP_TIMEOUT });
  appendFileSync(log, `\n$ pnpm install\n${first.out}`);
  const ignored = /Ignored build scripts: ([^\r\n]+)/.exec(first.out)?.[1];
  const approved = ignored
    ? ignored.split(/,\s*/).map((spec) => spec.replace(/(.)@.*$/, '$1'))
    : [];
  if (!first.ok && approved.length === 0) throw new Failure('starter install', first.out);
  if (approved.length > 0) {
    addToMap(
      workspace,
      'allowBuilds',
      approved.map((pkg) => [pkg, 'true']),
    );
    step('starter install', 'pnpm', ['install']);
  }

  const spec = (pkg) => tarballs[PACKAGES.find((folder) => npmName(folder) === pkg)];
  // pnpm stops on a build script nobody approved, and the starter's are approved by now
  const ours = [...host.add, '@verbaly/compiler'];
  for (const [label, args] of [
    ['add', ['add', ...host.add.map(spec)]],
    ['add -D', ['add', '-D', spec('@verbaly/compiler')]],
  ]) {
    try {
      step(label, 'pnpm', args);
    } catch (error) {
      if (!/Ignored build scripts/.test(error.detail)) throw error;
      const brought = 'a Verbaly package brought a build script the user has to approve';
      throw new Failure(label, `${brought}\n${error.detail}`);
    }
  }
  const stale = ours.filter((pkg) => versionOf(dir, pkg) !== VERSION);
  if (stale.length > 0) {
    throw new Failure('add', `not this build: ${stale.map((p) => `${p} ${versionOf(dir, p)}`)}`);
  }

  verbaly('init', '--source', 'en', '--locales', 'en,es');
  host.wire(dir);
  for (const [file, content] of Object.entries(host.files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  verbaly('extract');

  const source = JSON.parse(readFileSync(join(dir, 'locales', 'en.json'), 'utf8'));
  const target = JSON.parse(readFileSync(join(dir, 'locales', 'es.json'), 'utf8'));
  for (const [key, text] of Object.entries(source)) {
    if (Object.hasOwn(TRANSLATIONS, text)) target[key] = TRANSLATIONS[text];
  }
  writeFileSync(join(dir, 'locales', 'es.json'), `${JSON.stringify(target, null, 2)}\n`);
  verbaly('check');

  const read = [];
  for (const build of host.builds) {
    for (const [cmd, ...args] of build.steps) step(args.join(' '), cmd, args);
    const said = await host.read(dir, host.painted);
    read.push(build.label ? `${build.label}: ${said}` : said);
  }
  const versions = host.show.map((pkg) => `${pkg} ${versionOf(dir, pkg)}`).join(', ');
  const builds =
    approved.length > 0 ? `, the starter's builds approved: ${approved.join(', ')}` : '';
  return `${versions}${builds} · init, extract, check · ${read.join(' · ')}`;
}

const args = process.argv.slice(2);
const keepAll = args.includes('--keep');
// a release passes the canonical build's tarballs instead of packing this checkout's dist
const given = args.includes('--tarballs') ? args[args.indexOf('--tarballs') + 1] : undefined;
const requested = args.filter((arg, i) => !arg.startsWith('-') && args[i - 1] !== '--tarballs');
const unknown = requested.filter((name) => !Object.hasOwn(HOSTS, name));
if (unknown.length > 0) {
  console.log(`[verbaly] no starter named ${unknown.join(', ')}: ${Object.keys(HOSTS).join(', ')}`);
  process.exit(1);
}
const names = requested.length > 0 ? requested : Object.keys(HOSTS);

// the version under test is the one in the tarballs, so a published one can be measured too
const found = given
  ? readdirSync(given)
      .map((file) => /^verbaly-(\d+\.\d+\.\d+\S*)\.tgz$/.exec(file)?.[1])
      .filter(Boolean)
  : [JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8')).version];
if (found.length !== 1) {
  throw new Error(`${given} needs exactly one verbaly-<version>.tgz, found ${found.length}`);
}
const VERSION = found[0];

const work = mkdtempSync(join(tmpdir(), 'verbaly-starters-'));
function packed(folder) {
  const tarballs = {};
  for (const name of PACKAGES) {
    const file = join(folder, `verbaly-${name === 'core' ? '' : `${name}-`}${VERSION}.tgz`);
    if (!existsSync(file)) throw new Error(`no ${file}: pass the folder the build packed into`);
    tarballs[name] = file;
  }
  return tarballs;
}
const tarballs = given ? packed(given) : pack(join(work, 'tarballs'), PACKAGES);
const from = given ? `the tarballs in ${given}` : 'this checkout';
console.log(`[verbaly] starters, ${VERSION} from ${from}: ${names.join(', ')}\n`);

let failed = false;
const began = Date.now();
for (const name of names) {
  const start = Date.now();
  const seconds = () => `${Math.round((Date.now() - start) / 1000)} s`;
  try {
    const said = await check(name, HOSTS[name], work, tarballs);
    console.log(`✓ ${name} (${seconds()}): ${said}`);
    if (!keepAll) rmSync(join(work, name), { recursive: true, force: true });
  } catch (error) {
    failed = true;
    const step = error instanceof Failure ? `${error.message} failed` : 'the check broke';
    console.log(`✗ ${name} (${seconds()}): ${step}`);
    console.log(`${error instanceof Failure ? error.detail : error.stack}`.replace(/^/gm, '    '));
    console.log(`    kept: ${join(work, name)}`);
  }
}

console.log(`\n[verbaly] ${Math.round((Date.now() - began) / 1000)} s in all`);
if (!failed && !keepAll) rmSync(work, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('[verbaly] starters ✓');
