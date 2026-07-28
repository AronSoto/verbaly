import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { batchFormat, buildPrompt } from '../src/providers/claude';
import { structureMatches, translateCatalogs, type TranslateProvider } from '../src/translate';

function cfg(locales: string[] = ['en', 'es']) {
  return resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-')),
    sourceLocale: 'en',
    locales,
  });
}

const upper: TranslateProvider = (request) =>
  Promise.resolve(
    Object.fromEntries(
      Object.entries(request.messages).map(([key, text]) => [key, text.toUpperCase()]),
    ),
  );

describe('translateCatalogs', () => {
  it('fills only empty entries', async () => {
    const catalogs: Catalogs = {
      en: { a: 'Hello', b: 'Bye' },
      es: { a: '', b: 'Chau' },
    };
    const result = await translateCatalogs(cfg(), catalogs, upper);
    expect(catalogs.es).toEqual({ a: 'HELLO', b: 'Chau' });
    expect(result.translated).toEqual({ es: ['a'] });
  });

  it('batches requests', async () => {
    const provider = vi.fn(upper);
    const catalogs: Catalogs = {
      en: { a: '1', b: '2', c: '3' },
      es: { a: '', b: '', c: '' },
    };
    await translateCatalogs(cfg(), catalogs, provider, { batchSize: 2 });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(Object.keys(provider.mock.calls[0]![0].messages)).toEqual(['a', 'b']);
    expect(Object.keys(provider.mock.calls[1]![0].messages)).toEqual(['c']);
  });

  it('rejects translations that drop params', async () => {
    const broken: TranslateProvider = () => Promise.resolve({ a: 'Hola {nombre}' });
    const catalogs: Catalogs = { en: { a: 'Hello {name}' }, es: { a: '' } };
    const result = await translateCatalogs(cfg(), catalogs, broken);
    expect(catalogs.es!.a).toBe('');
    expect(result.invalid).toEqual({ es: ['a'] });
  });

  it('rejects translations that unwrap tags', async () => {
    const broken: TranslateProvider = () => Promise.resolve({ a: 'El gate del build' });
    const catalogs: Catalogs = { en: { a: 'The build <em>gate</em>' }, es: { a: '' } };
    const result = await translateCatalogs(cfg(), catalogs, broken);
    expect(result.invalid).toEqual({ es: ['a'] });
  });

  it('dry-run lists pending without writing', async () => {
    const provider = vi.fn(upper);
    const catalogs: Catalogs = { en: { a: 'Hello' }, es: { a: '' } };
    const result = await translateCatalogs(cfg(), catalogs, provider, { dryRun: true });
    expect(provider).not.toHaveBeenCalled();
    expect(catalogs.es!.a).toBe('');
    expect(result.pending).toEqual({ es: ['a'] });
  });

  it('respects the locales filter', async () => {
    const catalogs: Catalogs = {
      en: { a: 'Hello' },
      es: { a: '' },
      pt: { a: '' },
    };
    await translateCatalogs(cfg(['en', 'es', 'pt']), catalogs, upper, { locales: ['pt'] });
    expect(catalogs.es!.a).toBe('');
    expect(catalogs.pt!.a).toBe('HELLO');
  });

  it('passes only the batch keys origins to the provider', async () => {
    const provider = vi.fn(upper);
    const catalogs: Catalogs = { en: { a: 'Hi', b: 'Bye' }, es: { a: '', b: '' } };
    await translateCatalogs(cfg(), catalogs, provider, {
      origins: { a: ['src/a.ts'], c: ['src/c.ts'] },
    });
    // only 'a' has an origin among the missing keys; 'c' is not in this batch
    expect(provider.mock.calls[0]![0].origins).toEqual({ a: ['src/a.ts'] });
  });

  it('omits origins when none are provided', async () => {
    const provider = vi.fn(upper);
    const catalogs: Catalogs = { en: { a: 'Hi' }, es: { a: '' } };
    await translateCatalogs(cfg(), catalogs, provider);
    expect(provider.mock.calls[0]![0].origins).toBeUndefined();
  });
});

describe('structureMatches', () => {
  it('accepts preserved params, variants and tags', () => {
    expect(structureMatches('Hola {name}', 'Hello {name}')).toBe(true);
    expect(
      structureMatches(
        '{n | one: un <em>ítem</em> | other: # ítems}',
        '{n | one: one <em>item</em> | other: # items}',
      ),
    ).toBe(true);
  });

  it('rejects renamed params and missing tags', () => {
    expect(structureMatches('Hola {name}', 'Hello {nombre}')).toBe(false);
    expect(structureMatches('<em>a</em>', 'a')).toBe(false);
  });

  it('rejects a flattened plural block and one that would render empty', () => {
    const source = '{n | one: un ítem | other: # ítems}';
    expect(structureMatches(source, '{n} ítems')).toBe(false);
    expect(structureMatches(source, '{n | one: one item}')).toBe(false);
  });

  it('accepts a translation that adds the plural forms its language needs', () => {
    expect(
      structureMatches(
        '{n | one: un ítem | other: # ítems}',
        '{n | one: 1 element | few: # elementy | many: # elementów | other: # elementu}',
      ),
    ).toBe(true);
  });

  it('never rejects for a locale-specific plural gap: that is a check warning', () => {
    // pl wants few and many, but one/other still renders, so the file is not dropped
    expect(
      structureMatches(
        '{n | one: un ítem | other: # ítems}',
        '{n | one: 1 element | other: # elementów}',
      ),
    ).toBe(true);
  });
});

describe('claude provider helpers', () => {
  it('builds a per-batch json schema', () => {
    const format = batchFormat({
      sourceLocale: 'en',
      targetLocale: 'es',
      messages: { 'home.title': 'Hello', greet: 'Hi {name}' },
    });
    expect(format.type).toBe('json_schema');
    expect(format.schema.required).toEqual(['home.title', 'greet']);
    expect(format.schema.properties['home.title']).toEqual({ type: 'string' });
    expect(format.schema.additionalProperties).toBe(false);
  });

  it('prompt names both locales and carries the messages', () => {
    const prompt = buildPrompt({
      sourceLocale: 'en',
      targetLocale: 'pt',
      messages: { a: 'Hello {name}' },
    });
    expect(prompt).toContain('"en"');
    expect(prompt).toContain('"pt"');
    expect(prompt).toContain('Hello {name}');
    expect(prompt).not.toContain('Where each string appears');
  });

  it('prompt includes source locations when origins are present', () => {
    const prompt = buildPrompt({
      sourceLocale: 'en',
      targetLocale: 'pt',
      messages: { a: 'Hello' },
      origins: { a: ['src/App.tsx', 'src/home.vue'] },
    });
    expect(prompt).toContain('Where each string appears');
    expect(prompt).toContain('a: src/App.tsx, src/home.vue');
  });
});
