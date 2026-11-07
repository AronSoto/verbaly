import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';
import { verbaly } from '../src/index';

// real builds: a bundler can refuse an import before any plugin hook sees it
const BUILD_TIMEOUT = 60_000;

function project(): string {
  // unplugin 3.7 loses its webpack virtual modules under a linked path, as macOS's tmpdir is
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'verbaly-bundlers-')));
  mkdirSync(join(root, 'locales'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify({ sourceLocale: 'en' }));
  writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ hello: 'Hello' }));
  writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ hello: 'Hola desde es' }));
  writeFileSync(
    join(root, 'src', 'main.js'),
    "import { t, setLocale } from 'verbaly/app';\nsetLocale('es').then(() => console.log(t('hello')));\n",
  );
  return root;
}

// every file the build wrote, so a locale module that never made it is a missing text
function emitted(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

describe('verbaly/app through a real bundler', () => {
  // Proved able to fail by importing the locales as virtual:verbaly/locale/* again.
  it(
    'builds with webpack, whose URI schemes refuse a virtual: import before any plugin',
    async () => {
      const root = project();
      const out = join(root, 'out');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stats = await new Promise<webpack.Stats>((resolve, reject) =>
        webpack(
          {
            mode: 'production',
            target: 'node',
            context: root,
            entry: './src/main.js',
            output: { path: out, filename: 'main.js' },
            externals: { verbaly: 'commonjs verbaly' },
            plugins: [verbaly.webpack({ root })],
          },
          (error, result) => (error || !result ? reject(error) : resolve(result)),
        ),
      );
      expect(stats.toString('errors-only').trim()).toBe('');
      expect(emitted(out)).toContain('Hola desde es');
    },
    BUILD_TIMEOUT,
  );

  it(
    'builds with esbuild, each language in a chunk of its own',
    async () => {
      const root = project();
      const out = join(root, 'out');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await build({
        absWorkingDir: root,
        entryPoints: ['src/main.js'],
        bundle: true,
        splitting: true,
        format: 'esm',
        outdir: out,
        external: ['verbaly'],
        logLevel: 'silent',
        plugins: [verbaly.esbuild({ root })],
      });
      expect(emitted(out)).toContain('Hola desde es');
    },
    BUILD_TIMEOUT,
  );

  it(
    'writes the types a fresh clone needs (0.79.0)',
    async () => {
      const root = project();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await build({
        absWorkingDir: root,
        entryPoints: ['src/main.js'],
        bundle: true,
        write: false,
        format: 'esm',
        external: ['verbaly'],
        logLevel: 'silent',
        plugins: [verbaly.esbuild({ root })],
      });
      expect(readFileSync(join(root, 'src', 'verbaly.d.ts'), 'utf8')).toContain('hello');
    },
    BUILD_TIMEOUT,
  );
});
