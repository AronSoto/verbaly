import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withVerbaly, type NextConfigLike, type WebpackConfigLike } from '../src/index';
import { stopWatcher } from '../src/watch';

const DEV = 'phase-development-server';
const BUILD = 'phase-production-build';
const SERVER = 'phase-production-server';

interface ProjectOptions {
  source?: string;
  catalogs?: Record<string, Record<string, string>>;
}

function makeProject({ source, catalogs = { en: {}, es: {} } }: ProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-next-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'locales'), { recursive: true });
  if (source) writeFileSync(join(root, 'src', 'page.tsx'), source);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(catalog));
  }
  return root;
}

const inline = { sourceLocale: 'en', locales: ['en', 'es'] };

const COMPILER_TIMEOUT = 30_000;

// every test here loads the real ESM compiler through withVerbaly: not a 5s job under pnpm test
describe('withVerbaly', { timeout: COMPILER_TIMEOUT }, () => {
  it('composes turbopack alias + rules and the webpack fallback', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(BUILD);

    const alias = config.turbopack?.resolveAlias as Record<string, string>;
    expect(alias['virtual:verbaly']).toBe('./.verbaly/index.js');
    const rules = config.turbopack?.rules as Record<
      string,
      { loaders: unknown[]; condition: unknown }
    >;
    // the scope rides with the loader, so it rewrites exactly the files extract reads
    expect(rules['*']?.loaders).toEqual([
      {
        loader: '@verbaly/next/loader',
        options: {
          root,
          include: ['{src,app}/**/*.{js,jsx,ts,tsx,mjs,mts,svelte,vue,astro}'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
    ]);
    // guards against Turbopack's App Router entry (a bare glob matches it and panics)
    expect(rules['*']?.condition).toEqual({
      all: [{ not: 'foreign' }, { path: /\.[cm]?[jt]sx?$/ }],
    });

    const webpackConfig: WebpackConfigLike = {};
    (config.webpack as (c: WebpackConfigLike, ctx: unknown) => unknown)(webpackConfig, {});
    expect((webpackConfig.resolve?.alias as Record<string, string>)['virtual:verbaly']).toBe(
      join(root, '.verbaly', 'index.js'),
    );
    expect(webpackConfig.module?.rules).toHaveLength(1);
    // webpack gets the same scope, so the two bundlers never rewrite a different set of files
    const [rule] = webpackConfig.module!.rules as Array<{ use: Array<{ options?: object }> }>;
    expect(rule!.use[0]!.options).toEqual((rules['*']!.loaders[0] as { options: object }).options);
  });

  it('preserves user turbopack config and composes the user webpack fn', async () => {
    const root = makeProject();
    const calls: string[] = [];
    const user: NextConfigLike = {
      turbopack: {
        resolveAlias: { lodash: 'lodash-es' },
        rules: {
          '*.svg': { loaders: ['@svgr/webpack'] },
          '*': { loaders: ['user-loader'] },
        },
      },
      webpack: (config) => {
        calls.push('user');
        return config;
      },
    };
    const config = await withVerbaly(user, { root, ...inline })(BUILD);

    const alias = config.turbopack?.resolveAlias as Record<string, string>;
    expect(alias.lodash).toBe('lodash-es');
    expect(alias['virtual:verbaly']).toBe('./.verbaly/index.js');
    const rules = config.turbopack?.rules as Record<string, unknown>;
    expect(rules['*.svg']).toEqual({ loaders: ['@svgr/webpack'] });
    // a user '*' rule is kept: ours joins it as an array entry
    const star = rules['*'] as Array<{ loaders: Array<string | { loader: string }> }>;
    expect(star).toHaveLength(2);
    expect(star[0]?.loaders).toEqual(['user-loader']);
    expect(star[1]?.loaders.map((entry) => (entry as { loader: string }).loader)).toEqual([
      '@verbaly/next/loader',
    ]);

    const webpackConfig: WebpackConfigLike = {};
    (config.webpack as (c: WebpackConfigLike, ctx: unknown) => unknown)(webpackConfig, {});
    expect(calls).toEqual(['user']);
    expect(webpackConfig.module?.rules).toHaveLength(1);
  });

  it('resolves a function-form next config first', async () => {
    const root = makeProject();
    const config = await withVerbaly(() => ({ distDir: 'out' }), { root, ...inline })(BUILD);
    expect(config.distDir).toBe('out');
    expect((config as NextConfigLike).turbopack?.resolveAlias).toBeDefined();
  });

  it('writes the generated modules on build', async () => {
    const root = makeProject({ catalogs: { en: { x: 'X' }, es: { x: 'EQUIS' } } });
    await withVerbaly({}, { root, ...inline })(BUILD);
    expect(readFileSync(join(root, '.verbaly', 'locale', 'es.js'), 'utf8')).toBe(
      'export default {"x":"EQUIS"};\n',
    );
  });

  // Proved able to fail by throwing again by default: next build stopped on a missing text.
  it('reports missing translations and builds on, on a Next with no compile hook', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(withVerbaly({}, { root, ...inline })(BUILD)).resolves.toBeDefined();
      const said = warn.mock.calls.map(([line]: unknown[]) => String(line)).join('\n');
      expect(said).toContain('the build goes on without');
    } finally {
      warn.mockRestore();
    }
  });

  it('stops the build with failOnMissing: true, on a Next with no compile hook', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    await expect(withVerbaly({}, { root, ...inline, failOnMissing: true })(BUILD)).rejects.toThrow(
      /build blocked/,
    );
  });

  it('failOnMissing: false builds on, as the default does', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        withVerbaly({}, { root, ...inline, failOnMissing: false })(BUILD),
      ).resolves.toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('dev phase scaffolds catalogs, types and generated modules', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    // a Next project: next in its dependencies and the tsconfig create-next-app writes
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0' } }),
    );
    writeFileSync(
      join(root, 'tsconfig.json'),
      '{\n  // comments are legal here\n  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"]\n}\n',
    );
    try {
      await withVerbaly({}, { root, ...inline })(DEV);
      const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8')) as Record<
        string,
        string
      >;
      expect(Object.values(en)).toContain('Hello');
      const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
        string,
        string
      >;
      expect(Object.values(es)).toContain('');
      // the types live with the generated modules, never committed and never at the root
      expect(existsSync(join(root, '.verbaly', 'types.d.ts'))).toBe(true);
      expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
      expect(existsSync(join(root, '.verbaly', 'index.js'))).toBe(true);
      // TypeScript skips a dot folder unless tsconfig names it, like .next/types
      const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
      expect(tsconfig).toContain('".verbaly/types.d.ts"');
      expect(tsconfig).toContain('// comments are legal here');
    } finally {
      stopWatcher(root);
    }
  });

  it('names a file outside include once, however many times the config is evaluated', async () => {
    // create-next-app with no src/: components/ sits outside the default include
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    mkdirSync(join(root, 'components'), { recursive: true });
    writeFileSync(join(root, 'components', 'save.tsx'), 'export const b = () => <b>{t`Save`}</b>;');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await withVerbaly({}, { root, ...inline, failOnMissing: false })(BUILD);
    await withVerbaly({}, { root, ...inline, failOnMissing: false })(BUILD);
    const said = warn.mock.calls
      .flat()
      .filter((line) => String(line).includes('components/save.tsx'));
    expect(said).toHaveLength(1);
    expect(String(said[0])).toContain('outside the include of your verbaly config');
    warn.mockRestore();
  });

  it('writes the types in the build phase too, the one next typegen loads', async () => {
    const root = makeProject({ catalogs: { en: { greet: 'Hello {name}' }, es: { greet: '' } } });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0' } }),
    );
    await withVerbaly({}, { root, ...inline, failOnMissing: false })(BUILD);
    // .verbaly/ is never committed, so a fresh clone gets its types from typegen or the build
    expect(readFileSync(join(root, '.verbaly', 'types.d.ts'), 'utf8')).toContain(
      '"greet": { "name": unknown };',
    );
  });

  it('embeds cookie/fallback into the generated module', async () => {
    const root = makeProject();
    await withVerbaly({}, { root, ...inline, cookie: 'lang', fallback: 'es' })(BUILD);
    const runtime = readFileSync(join(root, '.verbaly', 'index.js'), 'utf8');
    expect(runtime).toContain('"cookie":"lang"');
    expect(runtime).toContain('"fallback":"es"');
  });

  it('defaults to an empty base config when called with no config', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>(undefined, { root, ...inline })(SERVER);
    expect(config.turbopack?.resolveAlias).toBeDefined();
  });

  it('registers the webpack module-replacement plugin when the instance is present', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(BUILD);
    const created: Array<[RegExp, string]> = [];
    class FakePlugin {
      constructor(test: RegExp, resource: string) {
        created.push([test, resource]);
      }
    }
    const webpackConfig: WebpackConfigLike = {};
    (config.webpack as (c: WebpackConfigLike, ctx: unknown) => unknown)(webpackConfig, {
      webpack: { NormalModuleReplacementPlugin: FakePlugin },
    });
    expect(webpackConfig.plugins).toHaveLength(1);
    expect(created[0]![0]).toEqual(/^virtual:verbaly$/);
    expect(created[0]![1]).toBe(join(root, '.verbaly', 'index.js'));
  });

  it('appends to a turbopack "*" rule that is already an array', async () => {
    const root = makeProject();
    const user: NextConfigLike = {
      turbopack: { rules: { '*': [{ loaders: ['a'] }, { loaders: ['b'] }] } },
    };
    const config = await withVerbaly(user, { root, ...inline })(BUILD);
    const star = (config.turbopack?.rules as Record<string, unknown>)['*'] as Array<{
      loaders: Array<{ loader: string }>;
    }>;
    expect(star).toHaveLength(3);
    expect(star[2]?.loaders.map((entry) => entry.loader)).toEqual(['@verbaly/next/loader']);
  });

  it('other phases only compose config: no filesystem work', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(SERVER);
    expect(existsSync(join(root, '.verbaly'))).toBe(false);
    const alias = config.turbopack?.resolveAlias as Record<string, string>;
    expect(alias['virtual:verbaly']).toBe('./.verbaly/index.js');
  });
});

describe('withVerbaly: the gate belongs to the build, not to whoever loads the config (0.67.0)', {
  timeout: COMPILER_TIMEOUT,
}, () => {
  const ANALYZE = 'phase-analyze';

  // a next that runs compiler.runAfterProductionCompile ships this file, from 15.4 on
  function withHook(root: string): string {
    const next = join(root, 'node_modules', 'next');
    mkdirSync(join(next, 'dist', 'build'), { recursive: true });
    writeFileSync(join(next, 'package.json'), '{"name":"next","version":"16.3.8"}');
    writeFileSync(join(next, 'dist', 'build', 'after-production-compile.js'), '');
    return root;
  }

  it('loads past missing translations, so next typegen works, and reports after the compile', async () => {
    const root = withHook(makeProject({ source: 'export const s = t`Hello`;' }));
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(BUILD);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const hook = config.compiler?.runAfterProductionCompile as () => Promise<void>;
      await expect(hook()).resolves.toBeUndefined();
      const said = warn.mock.calls.map(([line]: unknown[]) => String(line)).join('\n');
      expect(said).toContain('the build goes on without');
    } finally {
      warn.mockRestore();
    }
  });

  it('with failOnMissing: true, still loads past them and blocks after the compile', async () => {
    const root = withHook(makeProject({ source: 'export const s = t`Hello`;' }));
    const options = { root, ...inline, failOnMissing: true };
    const config = await withVerbaly<NextConfigLike>({}, options)(BUILD);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hook = config.compiler?.runAfterProductionCompile as () => Promise<void>;
      await expect(hook()).rejects.toThrow(/build blocked/);
    } finally {
      error.mockRestore();
    }
  });

  // Proved able to fail by rethrowing the gate's error: Next printed the whole list twice.
  it('prints the report once and throws a short line, as Next prints a failed hook twice', async () => {
    const root = withHook(makeProject({ source: 'export const s = t`Hello`;' }));
    const options = { root, ...inline, failOnMissing: true };
    const config = await withVerbaly<NextConfigLike>({}, options)(BUILD);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hook = config.compiler?.runAfterProductionCompile as () => Promise<void>;
      const short = /^\[verbaly\] build blocked, the reason is printed above$/;
      await expect(hook()).rejects.toThrow(short);
      const printed = error.mock.calls.map(([line]: unknown[]) => String(line));
      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain('missing translations:');
    } finally {
      error.mockRestore();
    }
  });

  it("runs the user's own hook first and keeps the rest of their compiler options", async () => {
    const root = withHook(makeProject());
    const calls: string[] = [];
    const user = {
      compiler: {
        removeConsole: true,
        runAfterProductionCompile: async () => {
          calls.push('user');
        },
      },
    };
    const config = await withVerbaly(user, { root, ...inline })(BUILD);
    const compilerConfig = config.compiler as typeof user.compiler;
    expect(compilerConfig.removeConsole).toBe(true);
    await compilerConfig.runAfterProductionCompile();
    expect(calls).toEqual(['user']);
  });

  it('leaves a compiler option alone when there is no gate to run', async () => {
    const root = withHook(makeProject());
    const config = await withVerbaly(
      { compiler: { removeConsole: true } },
      { root, ...inline, failOnMissing: false },
    )(DEV).finally(() => stopWatcher(root));
    expect(config.compiler).toEqual({ removeConsole: true });
  });

  it('writes the generated modules in the analyze phase, which compiles the app too', async () => {
    const root = makeProject({ catalogs: { en: { x: 'X' }, es: { x: 'EQUIS' } } });
    await withVerbaly({}, { root, ...inline })(ANALYZE);
    expect(existsSync(join(root, '.verbaly', 'index.js'))).toBe(true);
  });

  it("ships the code's text over a catalog that was edited by hand, like dev does", async () => {
    const root = makeProject({
      source: "export const s = t.id('greet')`Hello`;",
      catalogs: { en: { greet: 'Edited by hand' }, es: { greet: 'Hola' } },
    });
    await withVerbaly({}, { root, ...inline })(BUILD);
    expect(readFileSync(join(root, '.verbaly', 'locale', 'en.js'), 'utf8')).toBe(
      'export default {"greet":"Hello"};\n',
    );
    // the catalog on disk is the author's file: a build never writes it
    expect(readFileSync(join(root, 'locales', 'en.json'), 'utf8')).toContain('Edited by hand');
  });

  it('dev drops the draft of a key that is gone from the state file', async () => {
    const root = makeProject({ catalogs: { en: { a: 'A' }, es: { a: 'A es' } } });
    writeFileSync(join(root, 'locales', '.verbaly-drafts.json'), JSON.stringify({ es: ['a', 'gone'] }));
    try {
      await withVerbaly({}, { root, ...inline })(DEV);
    } finally {
      stopWatcher(root);
    }
    const state = JSON.parse(readFileSync(join(root, 'locales', '.verbaly-state.json'), 'utf8'));
    expect(state.drafts).toEqual({ es: ['a'] });
    expect(Object.keys(state.fingerprints.es)).toEqual(['a']);
  });
});
