import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { loadCatalogs } from '../src/catalog';
import { loadConfig } from '../src/config';
import { pruneCatalogs } from '../src/extract';
import { MessageRegistry } from '../src/registry';
import { resolveConfig } from '../src/config';

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'verbaly-cfg-'));
}

// a ts config goes through bundle-require, which spawns esbuild: 5s is not that job under pnpm test
const ESBUILD_TIMEOUT = 30_000;

describe('loadConfig', () => {
  it('reads verbaly.config.json', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"es","dir":"i18n"}');
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('es');
    expect(cfg.dir).toBe(join(root, 'i18n'));
  });

  it('reads verbaly.config.mjs', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.mjs'), "export default { sourceLocale: 'pt' };\n");
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('pt');
  });

  it('lets overrides win', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"es"}');
    const cfg = await loadConfig(root, { sourceLocale: 'en' });
    expect(cfg.sourceLocale).toBe('en');
  });

  it('defaults without a file', async () => {
    const cfg = await loadConfig(makeRoot());
    expect(cfg.sourceLocale).toBe('en');
    expect(cfg.locales).toEqual(['en']);
  });

  it(
    'reads verbaly.config.ts',
    async () => {
      const root = makeRoot();
      writeFileSync(
        join(root, 'verbaly.config.ts'),
        "const locales: string[] = ['en', 'pt'];\nexport default { sourceLocale: 'pt', locales };\n",
      );
      const cfg = await loadConfig(root);
      expect(cfg.sourceLocale).toBe('pt');
      expect(cfg.locales).toContain('en');
    },
    ESBUILD_TIMEOUT,
  );

  it('prefers mjs over ts when both exist', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.mjs'), "export default { sourceLocale: 'es' };\n");
    writeFileSync(join(root, 'verbaly.config.ts'), "export default { sourceLocale: 'pt' };\n");
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('es');
  });

  it('falls back to defaults when an mjs config has no default export', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.mjs'), 'export const foo = 1;\n');
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('en');
  });

  it(
    'falls back to defaults when a ts config has no default export',
    async () => {
      const root = makeRoot();
      writeFileSync(join(root, 'verbaly.config.ts'), 'export const foo: number = 1;\n');
      const cfg = await loadConfig(root);
      expect(cfg.sourceLocale).toBe('en');
    },
    ESBUILD_TIMEOUT,
  );

  it(
    'rethrows a ts config that fails to bundle for a non-esbuild reason',
    async () => {
      const root = makeRoot();
      writeFileSync(join(root, 'verbaly.config.ts'), 'export default {   // unterminated\n');
      await expect(loadConfig(root)).rejects.toThrow();
    },
    ESBUILD_TIMEOUT,
  );
});

describe('resolveConfig defaults', () => {
  it('uses the process cwd when no root is given', () => {
    const cfg = resolveConfig();
    expect(cfg.root).toBe(process.cwd());
    expect(cfg.sourceLocale).toBe('en');
  });

  it('resolves an empty bundle section, so every consumer reads the same shape', () => {
    expect(resolveConfig().bundle).toEqual({});
    expect(resolveConfig({ bundle: { exclude: ['notes'] } }).bundle.exclude).toEqual(['notes']);
  });
});

describe('locale discovery', () => {
  it('discovers catalogs from the locales dir', () => {
    const root = makeRoot();
    const dir = join(root, 'locales');
    mkdirSync(dir);
    writeFileSync(join(dir, 'es.json'), '{}');
    const cfg = resolveConfig({ root });
    expect(cfg.locales).toEqual(['en', 'es']);
  });

  it('never auto-adopts the pseudo QA catalog as a target', () => {
    const root = makeRoot();
    const dir = join(root, 'locales');
    mkdirSync(dir);
    writeFileSync(join(dir, 'es.json'), '{}');
    writeFileSync(join(dir, 'en-XA.json'), '{}');
    const cfg = resolveConfig({ root });
    expect(cfg.locales).not.toContain('en-XA');
    // explicit config still wins
    const explicit = resolveConfig({ root, locales: ['en-XA'] });
    expect(explicit.locales).toContain('en-XA');
  });
});

describe('pruneCatalogs', () => {
  it('drops unreferenced keys everywhere', () => {
    const root = makeRoot();
    const dir = join(root, 'locales');
    mkdirSync(dir);
    writeFileSync(join(dir, 'es.json'), '{"used":"Usada","old":"Vieja"}');
    writeFileSync(join(dir, 'en.json'), '{"used":"Used","old":"Old"}');

    const cfg = resolveConfig({ root, sourceLocale: 'es' });
    const catalogs = loadCatalogs(cfg);
    const registry = new MessageRegistry();
    registry.update('app.ts', analyze("t('used');", 'app.ts'));

    const removed = pruneCatalogs(cfg, catalogs, registry);
    expect(removed.es).toEqual(['old']);
    expect(removed.en).toEqual(['old']);
    expect(catalogs.es).toEqual({ used: 'Usada' });
  });

  it('skips a configured locale that has no catalog object', () => {
    const root = makeRoot();
    const dir = join(root, 'locales');
    mkdirSync(dir);
    writeFileSync(join(dir, 'es.json'), '{"old":"Vieja"}');

    const cfg = resolveConfig({ root, sourceLocale: 'es', locales: ['es', 'pt'] });
    // pt is configured but absent from the catalogs map: prune must not crash on it
    const removed = pruneCatalogs(cfg, { es: { old: 'Vieja' } }, new MessageRegistry());
    expect(removed.es).toEqual(['old']);
    expect(removed.pt).toBeUndefined();
  });
});

describe('routing', () => {
  it('follows the surface: render is what builds a url tree per locale', () => {
    // no render section means no locale urls exist, so claiming a prefix mode would be a lie
    expect(resolveConfig({}).routing).toBe('no-prefix');
    expect(resolveConfig({ render: {} }).routing).toBe('prefix-except-source');
    expect(resolveConfig({ render: { sitemap: true } }).routing).toBe('prefix-except-source');
  });

  it('a named mode always wins over the inference', () => {
    expect(resolveConfig({ routing: 'no-prefix', render: {} }).routing).toBe('no-prefix');
    expect(resolveConfig({ routing: 'prefix-all' }).routing).toBe('prefix-all');
    expect(resolveConfig({ routing: 'prefix-except-source' }).routing).toBe('prefix-except-source');
  });
});

describe('icu', () => {
  it('is undefined by default, which means the catalogs decide', () => {
    expect(resolveConfig({}).icu).toBeUndefined();
  });

  it('can be forced on for messages that only arrive at runtime', () => {
    expect(resolveConfig({ icu: true }).icu).toBe(true);
    expect(resolveConfig({ icu: false }).icu).toBe(false);
  });
});
