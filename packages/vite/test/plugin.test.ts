import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableKey } from '@verbaly/compiler';
import { describe, expect, it } from 'vitest';
import verbalyPlugin from '../src/index';

const KEY = stableKey('Hola {name}');
const CODE = 'const s = t`Hola ${name}`;';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hook<T>(value: unknown): T {
  return (
    typeof value === 'object' && value !== null && 'handler' in value
      ? (value as { handler: unknown }).handler
      : value
  ) as T;
}

function makeProject(locales: Record<string, Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-vite-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [locale, catalog] of Object.entries(locales)) {
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
  }
  return root;
}

async function setup(root: string, command: 'serve' | 'build') {
  const plugin = verbalyPlugin({ sourceLocale: 'es' });
  await hook<(c: unknown) => Promise<void>>(plugin.configResolved)({ root, command });
  return {
    plugin,
    resolveId: hook<(id: string) => string | undefined>(plugin.resolveId),
    load: hook<(id: string) => string | undefined>(plugin.load),
    transform: hook<(code: string, id: string) => { code: string } | null | undefined>(
      plugin.transform,
    ),
    buildEnd: hook<() => void>(plugin.buildEnd),
  };
}

describe('virtual modules', () => {
  it('resolves and loads the runtime module', async () => {
    const root = makeProject({ es: {}, en: {}, pt: {} });
    const { resolveId, load } = await setup(root, 'serve');

    expect(resolveId('virtual:verbaly')).toBe('\0virtual:verbaly');
    const code = load('\0virtual:verbaly');
    expect(code).toContain('createVerbaly');
    expect(code).toContain("import('virtual:verbaly/locale/en')");
    expect(code).toContain("import('virtual:verbaly/locale/pt')");
  });

  it('serves locale catalogs as modules', async () => {
    const root = makeProject({ es: { hola: 'Hola' } });
    const { load } = await setup(root, 'serve');
    expect(load('\0virtual:verbaly/locale/es')).toBe('export default {"hola":"Hola"};\n');
  });
});

describe('dev transform', () => {
  it('rewrites code and feeds the source catalog', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, load } = await setup(root, 'serve');

    const result = transform(CODE, join(root, 'src', 'app.ts'));
    expect(result?.code).toBe(`const s = t(${JSON.stringify(KEY)}, { "name": name });`);
    expect(load('\0virtual:verbaly/locale/es')).toContain('Hola {name}');

    await sleep(150);
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8'));
    expect(es[KEY]).toBe('Hola {name}');
    expect(en[KEY]).toBe('');
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(true);
  });

  it('skips node_modules and non-source files', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'serve');
    expect(transform(CODE, join(root, 'node_modules', 'x', 'i.ts'))).toBeUndefined();
    expect(transform(CODE, join(root, 'src', 'style.css'))).toBeUndefined();
  });
});

describe('build check', () => {
  it('blocks the build on missing translations', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).toThrowError(/missing translations/);
  });

  it('passes when catalogs are complete', async () => {
    const root = makeProject({
      es: { [KEY]: 'Hola {name}' },
      en: { [KEY]: 'Hello {name}' },
    });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).not.toThrow();
  });

  it('does not write catalogs during build', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'build');
    transform(CODE, join(root, 'src', 'app.ts'));
    await sleep(150);
    expect(JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'))).toEqual({});
  });
});
