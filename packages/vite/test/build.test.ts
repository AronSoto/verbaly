import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import verbalyPlugin from '../src/index';

// real builds: an alias runs before every plugin, so only a bundler shows what it swallows
const BUILD_TIMEOUT = 60_000;
const core = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));

function project(main: string): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-vite-build-'));
  mkdirSync(join(root, 'locales'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify({ sourceLocale: 'en' }));
  writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ hello: 'Hello' }));
  writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ hello: 'Hola desde vite' }));
  writeFileSync(join(root, 'src', 'main.js'), main);
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.js"></script>\n');
  return root;
}

type Alias = Record<string, string> | { find: RegExp; replacement: string }[];

async function shipped(root: string, alias: Alias): Promise<string> {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const result = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [verbalyPlugin()],
    resolve: { alias },
    build: { write: false },
  })) as Rolldown.RolldownOutput;
  return result.output.map((file) => ('code' in file ? file.code : '')).join('\n');
}

describe('a vite build of the project module', () => {
  // Proved able to fail by importing the languages as verbaly/app/locale/* again.
  it(
    'keeps building an app that aliases verbaly as a string, as a monorepo does',
    async () => {
      const root = project("import { t } from 'virtual:verbaly';\nconsole.log(t('hello'));\n");
      expect(await shipped(root, { verbaly: core })).toContain('Hola desde vite');
    },
    BUILD_TIMEOUT,
  );

  it(
    'builds verbaly/app with each language in a chunk of its own',
    async () => {
      const root = project("import { t } from 'verbaly/app';\nconsole.log(t('hello'));\n");
      // an exact alias: verbaly alone, so verbaly/app still reaches the plugin
      const exact = [{ find: /^verbaly$/, replacement: core }];
      expect(await shipped(root, exact)).toContain('Hola desde vite');
    },
    BUILD_TIMEOUT,
  );

  it(
    'ships the project module when the app only imports an adapter, as a provider-less app does',
    async () => {
      const root = project("import { useT } from '@verbaly/react';\nconsole.log(useT());\n");
      const adapter = join(root, 'src', 'adapter.js');
      // the hook reads what verbaly/app registers, as @verbaly/react does with no provider
      writeFileSync(adapter, "export const useT = () => globalThis[Symbol.for('verbaly.app')];\n");
      const alias = [
        { find: /^verbaly$/, replacement: core },
        { find: /^@verbaly\/react$/, replacement: adapter },
      ];
      const code = await shipped(root, alias);
      expect(code).toContain('verbaly.app');
      expect(code).toContain('Hola desde vite');
    },
    BUILD_TIMEOUT,
  );

  it(
    'writes the types a fresh clone needs, with the keys the code adds (0.79.0)',
    async () => {
      const root = project(
        "import { t } from 'verbaly/app';\nconsole.log(t('hello'), t.id('signedIn')`Signed in`);\n",
      );
      await shipped(root, [{ find: /^verbaly$/, replacement: core }]);
      const dts = readFileSync(join(root, 'src', 'verbaly.d.ts'), 'utf8');
      expect(dts).toContain('signedIn');
      expect(dts).toContain('hello');
    },
    BUILD_TIMEOUT,
  );
});
