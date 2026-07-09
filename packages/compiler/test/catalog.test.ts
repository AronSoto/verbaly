import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { loadCatalogs, readCatalog, serializeCatalog, writeCatalog } from '../src/catalog';
import { check, formatCheckResult } from '../src/check';
import { resolveConfig } from '../src/config';
import { syncCatalogs } from '../src/extract';
import { stableKey } from '../src/key';
import { MessageRegistry } from '../src/registry';

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

  it('missing or corrupt files read as empty catalogs', () => {
    const cfg = makeProject({ es: {} });
    expect(readCatalog(cfg, 'nope')).toEqual({});
    writeFileSync(join(cfg.dir, 'es.json'), '{corrupt');
    expect(readCatalog(cfg, 'es')).toEqual({});
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
    expect(text).toContain('ghost.key — used in app.ts');
  });
});
