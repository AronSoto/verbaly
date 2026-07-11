import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableKey } from '@verbaly/compiler';
import type { UnpluginOptions } from 'unplugin';
import { describe, expect, it } from 'vitest';
import { verbaly, type UnpluginVerbalyOptions } from '../src/index';

const KEY = stableKey('Hola {name}');
const CODE = 'const s = t`Hola ${name}`;';

function makeProject(locales: Record<string, Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-unplugin-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [locale, catalog] of Object.entries(locales)) {
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
  }
  return root;
}

function rawPlugin(options: UnpluginVerbalyOptions): UnpluginOptions {
  const raw = verbaly.raw(options, { framework: 'rollup', versions: {} });
  return Array.isArray(raw) ? raw[0]! : raw;
}

async function setup(root: string) {
  const plugin = rawPlugin({ root, sourceLocale: 'es' });
  await (plugin.buildStart as () => Promise<void>).call({});
  return {
    resolveId: (id: string) => (plugin.resolveId as (id: string) => string | null).call({}, id),
    loadInclude: (id: string) => (plugin.loadInclude as (id: string) => boolean).call({}, id),
    load: (id: string) => (plugin.load as (id: string) => string | null).call({}, id),
    transformInclude: (id: string) =>
      (plugin.transformInclude as (id: string) => boolean).call({}, id),
    transform: (code: string, id: string) =>
      (plugin.transform as (code: string, id: string) => { code: string } | null).call(
        {},
        code,
        id,
      ),
    buildEnd: () => (plugin.buildEnd as () => void).call({}),
  };
}

describe('virtual modules', () => {
  it('resolves and loads the runtime module', async () => {
    const root = makeProject({ es: {}, en: {}, pt: {} });
    const p = await setup(root);

    expect(p.resolveId('virtual:verbaly')).toBe('\0virtual:verbaly');
    expect(p.loadInclude('\0virtual:verbaly')).toBe(true);
    const code = p.load('\0virtual:verbaly');
    expect(code).toContain('createVerbaly');
    expect(code).toContain("import('virtual:verbaly/locale/en')");
  });

  it('serves locale catalogs as modules', async () => {
    const root = makeProject({ es: { hola: 'Hola' } });
    const p = await setup(root);
    expect(p.load('\0virtual:verbaly/locale/es')).toBe('export default {"hola":"Hola"};\n');
  });

  it('ignores non-virtual ids', async () => {
    const root = makeProject({ es: {} });
    const p = await setup(root);
    expect(p.resolveId('src/app.ts')).toBeNull();
    expect(p.loadInclude('src/app.ts')).toBe(false);
    expect(p.load('\0other')).toBeNull();
  });
});

describe('transform', () => {
  it('rewrites tagged templates to stable keys', async () => {
    const root = makeProject({ es: {}, en: {} });
    const p = await setup(root);
    const result = p.transform(CODE, join(root, 'src', 'app.ts'));
    expect(result?.code).toBe(`const s = t(${JSON.stringify(KEY)}, { "name": name });`);
  });

  it('skips node_modules and non-source files', async () => {
    const root = makeProject({ es: {} });
    const p = await setup(root);
    expect(p.transformInclude(join(root, 'node_modules', 'x', 'i.ts'))).toBe(false);
    expect(p.transformInclude(join(root, 'src', 'style.css'))).toBe(false);
    expect(p.transformInclude(join(root, 'src', 'app.tsx'))).toBe(true);
  });
});

describe('build gate', () => {
  it('blocks the build on missing translations', async () => {
    const root = makeProject({ es: {}, en: {} });
    const p = await setup(root);
    p.transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => p.buildEnd()).toThrowError(/missing translations/);
  });

  it('passes when catalogs are complete', async () => {
    const root = makeProject({
      es: { [KEY]: 'Hola {name}' },
      en: { [KEY]: 'Hello {name}' },
    });
    const p = await setup(root);
    p.transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => p.buildEnd()).not.toThrow();
  });

  it('blocks the build on unknown keys', async () => {
    const root = makeProject({ es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello {name}' } });
    const p = await setup(root);
    p.transform("const s = t('nope.missing');", join(root, 'src', 'app.ts'));
    expect(() => p.buildEnd()).toThrowError(/build blocked/);
  });

  it('can be disabled with failOnMissing: false', async () => {
    const root = makeProject({ es: {}, en: {} });
    const plugin = rawPlugin({ root, sourceLocale: 'es', failOnMissing: false });
    await (plugin.buildStart as () => Promise<void>).call({});
    (plugin.transform as (code: string, id: string) => unknown).call(
      {},
      CODE,
      join(root, 'src', 'app.ts'),
    );
    expect(() => (plugin.buildEnd as () => void).call({})).not.toThrow();
  });
});

describe('framework wrappers', () => {
  it('exposes plugins for every bundler', () => {
    expect(typeof verbaly.webpack).toBe('function');
    expect(typeof verbaly.rollup).toBe('function');
    expect(typeof verbaly.esbuild).toBe('function');
    expect(typeof verbaly.rspack).toBe('function');
    expect(typeof verbaly.vite).toBe('function');
  });
});
