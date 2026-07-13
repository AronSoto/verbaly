import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

describe('withVerbaly', () => {
  it('composes turbopack alias + rules and the webpack fallback', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(BUILD);

    const alias = config.turbopack?.resolveAlias as Record<string, string>;
    expect(alias['virtual:verbaly']).toBe('./.verbaly/index.js');
    const rules = config.turbopack?.rules as Record<
      string,
      { loaders: string[]; condition: unknown }
    >;
    expect(rules['*']?.loaders).toEqual(['@verbaly/next/loader']);
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
    // a user '*' rule is kept — ours joins it as an array entry
    const star = rules['*'] as Array<{ loaders: string[] }>;
    expect(star).toHaveLength(2);
    expect(star[0]?.loaders).toEqual(['user-loader']);
    expect(star[1]?.loaders).toEqual(['@verbaly/next/loader']);

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

  it('blocks the build on missing translations', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    await expect(withVerbaly({}, { root, ...inline })(BUILD)).rejects.toThrow(/build blocked/);
  });

  it('failOnMissing: false opts out of the gate', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
    await expect(
      withVerbaly({}, { root, ...inline, failOnMissing: false })(BUILD),
    ).resolves.toBeDefined();
  });

  it('dev phase scaffolds catalogs, types and generated modules', async () => {
    const root = makeProject({ source: 'export const s = t`Hello`;' });
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
      expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(true);
      expect(existsSync(join(root, '.verbaly', 'index.js'))).toBe(true);
    } finally {
      stopWatcher(root);
    }
  });

  it('embeds cookie/fallback into the generated module', async () => {
    const root = makeProject();
    await withVerbaly({}, { root, ...inline, cookie: 'lang', fallback: 'es' })(BUILD);
    const runtime = readFileSync(join(root, '.verbaly', 'index.js'), 'utf8');
    expect(runtime).toContain('"cookie":"lang"');
    expect(runtime).toContain('"fallback":"es"');
  });

  it('other phases only compose config — no filesystem work', async () => {
    const root = makeProject();
    const config = await withVerbaly<NextConfigLike>({}, { root, ...inline })(SERVER);
    expect(existsSync(join(root, '.verbaly'))).toBe(false);
    const alias = config.turbopack?.resolveAlias as Record<string, string>;
    expect(alias['virtual:verbaly']).toBe('./.verbaly/index.js');
  });
});
