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
});

describe('structureMatches', () => {
  it('accepts preserved params, variants and tags', () => {
    expect(structureMatches('Hola {name}', 'Hello {name}')).toBe(true);
    expect(
      structureMatches('{n | one: un <em>ítem</em> | other: # ítems}', '{n | one: one <em>item</em> | other: # items}'),
    ).toBe(true);
  });

  it('rejects renamed params and missing tags', () => {
    expect(structureMatches('Hola {name}', 'Hello {nombre}')).toBe(false);
    expect(structureMatches('<em>a</em>', 'a')).toBe(false);
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
  });
});
