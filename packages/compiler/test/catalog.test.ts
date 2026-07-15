import { mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { catalogPath, loadCatalogs, readCatalog, serializeCatalog, writeCatalog } from '../src/catalog';
import { check, formatCheckResult } from '../src/check';
import { resolveConfig } from '../src/config';
import { syncCatalogs } from '../src/extract';
import { stableKey } from '../src/key';
import { MessageRegistry } from '../src/registry';
import { formatStatusResult, status } from '../src/status';

function makeProject(locales: Record<string, Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [locale, catalog] of Object.entries(locales)) {
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
  }
  return resolveConfig({ root, sourceLocale: 'es' });
}

function registryFor(code: string) {
  const registry = new MessageRegistry();
  registry.update('app.ts', analyze(code, 'app.ts'));
  return registry;
}

describe('catalogs', () => {
  it('discovers locales from files', () => {
    const cfg = makeProject({ es: {}, en: {}, pt: {} });
    expect(cfg.locales.sort()).toEqual(['en', 'es', 'pt']);
  });

  it('serializes sorted with trailing newline', () => {
    expect(serializeCatalog({ b: '2', a: '1' })).toBe('{\n  "a": "1",\n  "b": "2"\n}\n');
  });

  it('round-trips through disk', () => {
    const cfg = makeProject({ es: {} });
    writeCatalog(cfg, 'es', { hola: 'Hola' });
    expect(loadCatalogs(cfg).es).toEqual({ hola: 'Hola' });
  });

  it('missing files read as empty catalogs, a BOM is tolerated', () => {
    const cfg = makeProject({ es: {} });
    expect(readCatalog(cfg, 'nope')).toEqual({});
    writeFileSync(join(cfg.dir, 'es.json'), '\uFEFF{"hola": "Hola"}');
    expect(readCatalog(cfg, 'es')).toEqual({ hola: 'Hola' });
  });

  it('a corrupt catalog fails loudly instead of reading as empty', () => {
    const cfg = makeProject({ es: {} });
    writeFileSync(join(cfg.dir, 'es.json'), '{corrupt');
    expect(() => readCatalog(cfg, 'es')).toThrow(/not valid JSON/);
  });

  it('skips identical writes so catalog watchers never retrigger', async () => {
    const cfg = makeProject({ es: {} });
    writeCatalog(cfg, 'es', { hola: 'Hola' });
    const before = statSync(catalogPath(cfg, 'es')).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeCatalog(cfg, 'es', { hola: 'Hola' });
    expect(statSync(catalogPath(cfg, 'es')).mtimeMs).toBe(before);
    writeCatalog(cfg, 'es', { hola: 'Chau' });
    expect(readCatalog(cfg, 'es')).toEqual({ hola: 'Chau' });
  });
});

describe('status', () => {
  const key = stableKey('Hola {name}');

  it('reports per-locale coverage against the needed set', () => {
    const cfg = makeProject({
      es: { [key]: 'Hola {name}', extra: 'Extra' },
      en: { [key]: 'Hello {name}', extra: '' },
      pt: { [key]: 'Olá {name}', extra: 'Extra' },
    });
    const result = status(cfg, loadCatalogs(cfg), registryFor('t`Hola ${name}`;'));
    expect(result.messages).toBe(2);
    expect(result.source).toBe('es');
    expect(result.locales).toContainEqual({ locale: 'en', translated: 1, total: 2 });
    expect(result.locales).toContainEqual({ locale: 'pt', translated: 2, total: 2 });
  });

  it('formats coverage with a checkmark on complete locales', () => {
    const cfg = makeProject({
      es: { [key]: 'Hola {name}' },
      en: { [key]: '' },
      pt: { [key]: 'Olá {name}' },
    });
    const text = formatStatusResult(status(cfg, loadCatalogs(cfg), registryFor('t`Hola ${name}`;')));
    expect(text).toContain('1 messages · source: es');
    expect(text).toContain('en: 0/1 translated (0%)');
    expect(text).toContain('pt: 1/1 translated (100%) ✓');
  });

  it('points at the config when there are no target locales', () => {
    const cfg = makeProject({ es: {} });
    const text = formatStatusResult(status(cfg, loadCatalogs(cfg), registryFor('')));
    expect(text).toContain('no target locales');
  });
});

describe('syncCatalogs', () => {
  it('fills source texts and placeholders', () => {
    const cfg = makeProject({ es: {}, en: {} });
    const catalogs = loadCatalogs(cfg);
    const registry = registryFor('t`Hola ${name}`;');
    const key = stableKey('Hola {name}');

    const { added } = syncCatalogs(cfg, catalogs, registry);
    expect(catalogs.es?.[key]).toBe('Hola {name}');
    expect(catalogs.en?.[key]).toBe('');
    expect(added.es).toEqual([key]);
    expect(added.en).toEqual([key]);
  });
});

describe('check', () => {
  const key = stableKey('Hola {name}');

  it('passes when complete', () => {
    const cfg = makeProject({
      es: { [key]: 'Hola {name}' },
      en: { [key]: 'Hello {name}' },
    });
    const result = check(cfg, loadCatalogs(cfg), registryFor('t`Hola ${name}`;'));
    expect(result.ok).toBe(true);
  });

  it('flags missing and empty translations', () => {
    const cfg = makeProject({
      es: { [key]: 'Hola {name}', extra: 'Extra' },
      en: { [key]: '' },
    });
    const result = check(cfg, loadCatalogs(cfg), registryFor('t`Hola ${name}`;'));
    expect(result.ok).toBe(false);
    const missingEn = result.missing.filter((m) => m.locale === 'en').map((m) => m.key);
    expect(missingEn.sort()).toEqual(['extra', key].sort());
  });

  it('flags extracted keys absent from source catalog', () => {
    const cfg = makeProject({ es: {} });
    const result = check(cfg, loadCatalogs(cfg), registryFor('t`Hola ${name}`;'));
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toMatchObject({ locale: 'es', key });
  });

  it('flags unknown explicit keys', () => {
    const cfg = makeProject({ es: {} });
    const result = check(cfg, loadCatalogs(cfg), registryFor("t('nope.key');"));
    expect(result.unknown[0]?.key).toBe('nope.key');
  });

  it('accepts explicit keys present in catalogs', () => {
    const cfg = makeProject({ es: { 'home.title': 'Inicio' } });
    const result = check(cfg, loadCatalogs(cfg), registryFor("t('home.title');"));
    expect(result.ok).toBe(true);
  });
});

describe('formatCheckResult', () => {
  it('prints missing entries with a truncated source hint', () => {
    const long = 'Un mensaje larguísimo que definitivamente supera los cuarenta caracteres';
    const cfg = makeProject({ es: {}, en: {} });
    const result = check(cfg, loadCatalogs(cfg), registryFor(`t\`${long}\`;`));
    const text = formatCheckResult(result);
    expect(text).toContain('missing translations:');
    expect(text).toContain('[es]');
    expect(text).toContain('…');
    expect(text).not.toContain(long);
  });

  it('prints unknown keys with their files', () => {
    const cfg = makeProject({ es: {} });
    const result = check(cfg, loadCatalogs(cfg), registryFor("t('ghost.key');"));
    const text = formatCheckResult(result);
    expect(text).toContain('unknown keys (not in any catalog):');
    expect(text).toContain('ghost.key (used in app.ts)');
  });
});
