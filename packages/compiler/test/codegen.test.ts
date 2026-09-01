import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDts, generateLocaleModule, generateRuntimeModule } from '../src/codegen';
import { needsIcu, needsRelative } from '../src/catalog';
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

  it('the source locale never gets a loader, which keeps the singleton free of a boot fetch', () => {
    const cfg = resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-')),
      sourceLocale: 'en',
      locales: ['en', 'es', 'pt'],
    });
    const loaders = /const localeLoaders = \{([\s\S]*?)\n\};/.exec(generateRuntimeModule(cfg))![1]!;
    expect(loaders).toContain('"es"');
    expect(loaders).toContain('"pt"');
    expect(loaders).not.toContain('"en"');
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

describe('routing reaches the virtual module', () => {
  it('exports the mode and helpers already bound to it', () => {
    const cfg = resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'], routing: 'prefix-all' });
    const mod = generateRuntimeModule(cfg);
    expect(mod).toContain('export const routing = "prefix-all"');
    // bound means the caller has nothing left to pass wrong: that was the whole footgun
    expect(mod).toContain('supported: locales, sourceLocale, routing');
    expect(mod).toContain('export function localePath(locale, options)');
    expect(mod).toContain('export function localeFromPath(options)');
  });

  it('declares them in the generated types', () => {
    const dts = generateDts({ a: 'Hi' });
    expect(dts).toContain("export const routing: import('verbaly').Routing;");
    expect(dts).toContain('export function localePath(');
    expect(dts).toContain('export function localeFromPath(');
  });
});

describe('declared keys', () => {
  it('ships an identity helper, so a key module works with or without a bundler plugin', () => {
    const cfg = resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'] });
    const mod = generateRuntimeModule(cfg);
    expect(mod).toContain('export function defineKeys(keys)');
    expect(mod).toContain('return keys;');
  });

  it('constrains every leaf to a key the catalog really has', () => {
    // the point of the helper: a key that does not exist is an error where it is declared
    const dts = generateDts({ a: 'Hi' });
    expect(dts).toContain(
      'export type VerbalyKeyTree = VerbalyKey | { readonly [name: string]: VerbalyKeyTree };',
    );
    // const keeps the literal types, without it every value widens to string and t(key) breaks
    expect(dts).toContain('export function defineKeys<const T extends VerbalyKeyTree>(keys: T): T;');
  });
});

describe('the bound switcher', () => {
  it('hands the mode, the locales and the source to core, leaving only the router', () => {
    const cfg = resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'], render: {} });
    const mod = generateRuntimeModule(cfg);
    expect(mod).toContain('export function switchLocale(locale, options)');
    expect(mod).toContain('supported: locales, sourceLocale, routing, ...options');
  });

  it('declares it without the three the project already answered', () => {
    const dts = generateDts({ a: 'Hi' });
    expect(dts).toContain('export function switchLocale(');
    expect(dts).toContain("'routing' | 'supported' | 'sourceLocale'");
  });
});

describe('the ICU parser rides only where a catalog reads it', () => {
  const cfg = () => resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'] });

  it('is absent from the module when no catalog uses ICU', () => {
    const mod = generateRuntimeModule(cfg());
    expect(mod).not.toContain('parseIcu');
    expect(mod).not.toContain('icu:');
  });

  it('is imported and passed when a catalog does', () => {
    const mod = generateRuntimeModule(cfg(), { icu: true });
    expect(mod).toContain('parseIcu');
    expect(mod).toContain('icu: parseIcu,');
    // it goes to createInstance, so a per-request SSR instance gets it too
    expect(mod.indexOf('icu: parseIcu')).toBeGreaterThan(mod.indexOf('createVerbaly({'));
  });
});

describe('needsIcu', () => {
  it('sees ICU in any locale, at any depth', () => {
    expect(needsIcu({ en: { a: 'Hi {name}' } })).toBe(false);
    expect(needsIcu({ en: { a: '{n | one: # x | other: # y}' } })).toBe(false);
    expect(needsIcu({ en: { a: 'Hi' }, es: { a: '{c, plural, other {#}}' } })).toBe(true);
    expect(needsIcu({ en: { g: { deep: '{v, select, a {A} other {B}}' } } as never })).toBe(true);
  });

  it('does not mistake our own syntax or a stray brace for ICU', () => {
    expect(needsIcu({ en: { a: '{price:currency/EUR}' } })).toBe(false);
    expect(needsIcu({ en: { a: 'Use {{ }} to escape' } })).toBe(false);
    expect(needsIcu({ en: { a: 'a, plural, b' } })).toBe(false);
  });
});

describe('needsRelative', () => {
  it('sees a real relative message, with or without a unit', () => {
    expect(needsRelative({ en: { a: 'Updated {when:relative}' } })).toBe(true);
    expect(needsRelative({ en: { a: 'in {n:relative/day}' } })).toBe(true);
    expect(needsRelative({ en: { a: 'Hi {name}' } })).toBe(false);
  });

  it('does not fire on prose that shows the syntax escaped', () => {
    // a docs site writes the braces as entities, and detecting that is the 0.29.0 lesson again
    const docs = 'Relative time (<code>&#123;when:relative&#125;</code>) uses Intl';
    expect(needsRelative({ en: { a: docs } })).toBe(false);
    expect(
      needsIcu({ en: { a: 'Write <code>&#123;n, plural, one &#123;#&#125;&#125;</code>' } }),
    ).toBe(false);
  });
});

describe('the relative formatter rides only where a catalog writes it', () => {
  const cfg = () => resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'] });

  it('is absent from the module when no catalog uses it', () => {
    expect(generateRuntimeModule(cfg())).not.toContain('relative');
  });

  it('is merged into formatters, never spread over by the caller options', () => {
    const mod = generateRuntimeModule(cfg(), { relative: true });
    expect(mod).toContain('relativeFormatter');
    // the merge order is the whole point: ...options first, then formatters rebuilt around it
    expect(mod).toContain('formatters: { relative: relativeFormatter, ...options?.formatters }');
    expect(mod.indexOf('...options,')).toBeLessThan(mod.indexOf('formatters: { relative'));
  });
});
