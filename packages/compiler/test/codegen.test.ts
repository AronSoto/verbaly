import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDts, generateLocaleModule, generateRuntimeModule } from '../src/codegen';
import { resolveConfig } from '../src/config';
import { collectParams, renderParamType } from '../src/params';

describe('generateRuntimeModule', () => {
  it('inlines source and lazy-loads the rest', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'es',
      locales: ['es', 'en', 'pt'],
    });
    const code = generateRuntimeModule(cfg);
    expect(code).toContain("import source from 'virtual:verbaly/locale/es'");
    expect(code).toContain('"en": () => import(\'virtual:verbaly/locale/en\')');
    expect(code).toContain('"pt": () => import(\'virtual:verbaly/locale/pt\')');
    expect(code).not.toContain('"es": () =>');
    expect(code).toContain('locale: "es"');
  });

  it('exposes the per-request factory and locale metadata (SSR)', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    const code = generateRuntimeModule(cfg);
    expect(code).toContain('export const sourceLocale = "en"');
    expect(code).toContain('export const locales = ["en","es"]');
    expect(code).toContain('export function createInstance(options)');
    expect(code).toContain('...options,');
    // the SPA singleton is built from the same factory
    expect(code).toContain('const v = createInstance()');
    // the no-FOUC contract codified: fresh instance + awaited catalog
    expect(code).toContain('export async function createRequestInstance(locale)');
    expect(code).toContain('await instance.loadLocale(locale)');
  });

  it('wires loaders through the core', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'es',
      locales: ['es', 'en'],
    });
    const code = generateRuntimeModule(cfg);
    expect(code).toContain('loaders: localeLoaders');
    expect(code).toContain('await v.loadLocale(locale)');
  });

  it('exposes raw catalogs via loadMessages', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    const code = generateRuntimeModule(cfg);
    expect(code).toContain('export async function loadMessages(locale)');
    expect(code).toContain('if (locale === "en") return source;');
  });

  it('supports custom locale imports and extra exports', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    const code = generateRuntimeModule(cfg, {
      localeImport: (locale) => `./locale/${locale}.js`,
      extraExports: 'export const requestOptions = {"cookie":"v"};\n',
    });
    expect(code).toContain("import source from './locale/en.js'");
    expect(code).toContain('"es": () => import(\'./locale/es.js\')');
    expect(code).not.toContain('virtual:verbaly/locale');
    expect(code).toContain('export const requestOptions = {"cookie":"v"};');
  });
});

describe('generateLocaleModule', () => {
  it('emits a default export', () => {
    expect(generateLocaleModule({ a: 'A' })).toBe('export default {"a":"A"};\n');
  });
});

describe('collectParams', () => {
  it('infers number from plurals', () => {
    const params = collectParams('{count | one: uno | other: # más}');
    expect(renderParamType(params.get('count')!)).toBe('number');
  });

  it('infers string from selects', () => {
    const params = collectParams('{gender | male: él | other: elle}');
    expect(renderParamType(params.get('gender')!)).toBe('string');
  });

  it('infers number from formats', () => {
    const params = collectParams('{price:currency/EUR}');
    expect(renderParamType(params.get('price')!)).toBe('number');
  });

  it('infers dates', () => {
    const params = collectParams('{when:date/long}');
    expect(renderParamType(params.get('when')!)).toBe('Date | number | string');
  });

  it('defaults to unknown', () => {
    const params = collectParams('Hola {name}');
    expect(renderParamType(params.get('name')!)).toBe('unknown');
  });

  it('finds params nested in variants', () => {
    const params = collectParams('{n | one: {name} tiene uno | other: {name} tiene #}');
    expect(params.has('name')).toBe(true);
  });
});

describe('generateDts', () => {
  it('types keys and params', () => {
    const dts = generateDts({
      greeting: 'Hola {name}',
      inbox: '{count | one: uno | other: #}',
      plain: 'Sin params',
    });
    expect(dts).toContain('"greeting": { "name": unknown };');
    expect(dts).toContain('"inbox": { "count": number };');
    expect(dts).toContain('"plain": never;');
    expect(dts).toContain("declare module 'virtual:verbaly'");
    expect(dts).toContain('setLocale(locale: string): Promise<void>');
    expect(dts).toContain('export namespace t {');
    expect(dts).toContain(
      "options?: import('verbaly').VerbalyOptions<VerbalyKey>,\n  ): import('verbaly').Verbaly<VerbalyKey>;",
    );
    expect(dts).toContain('export const locales: string[];');
    expect(dts).toContain(
      'export function loadMessages(locale: string): Promise<Record<string, string>>;',
    );
  });
});
