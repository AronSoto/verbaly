import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { batchFormat, buildPrompt } from '../src/providers/claude';
import {
  formatTranslateFailures,
  structureMatches,
  translateCatalogs,
  type TranslateProgress,
  type TranslateProvider,
} from '../src/translate';

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

describe('translateCatalogs: a batch that fails is a batch, not the run', () => {
  function manyMessages(count: number): Record<string, string> {
    return Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, `Message ${i}`]));
  }

  it('keeps every batch that answered when a later one never does', async () => {
    let calls = 0;
    const provider: TranslateProvider = async (request) => {
      calls += 1;
      if (calls === 4) throw new Error('529 overloaded');
      return Object.fromEntries(Object.keys(request.messages).map((k) => [k, `ES ${k}`]));
    };
    const catalogs: Catalogs = { en: manyMessages(100), es: {} };

    const result = await translateCatalogs(cfg(), catalogs, provider, {
      batchSize: 20,
      concurrency: 1,
      retries: 0,
    });

    expect(result.translated.es).toHaveLength(80);
    expect(Object.keys(catalogs.es!)).toHaveLength(80);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toContain('529 overloaded');
    expect(result.failed[0]!.keys).toHaveLength(20);
  });

  it('names every failed key so a retry asks only for what is left', async () => {
    const provider: TranslateProvider = () => Promise.reject(new Error('ECONNRESET'));
    const catalogs: Catalogs = { en: { a: 'A', b: 'B' }, es: {} };

    const result = await translateCatalogs(cfg(), catalogs, provider, {
      batchSize: 1,
      retries: 0,
    });

    expect(result.failed.flatMap((entry) => entry.keys).sort()).toEqual(['a', 'b']);
    expect(result.translated).toEqual({});
  });

  it('retries a transient failure and stops on one the api refused', async () => {
    let flaky = 0;
    const sometimes: TranslateProvider = async (request) => {
      flaky += 1;
      if (flaky === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
      return Object.fromEntries(Object.keys(request.messages).map((k) => [k, 'ok']));
    };
    const first: Catalogs = { en: { a: 'A' }, es: {} };
    const retried = await translateCatalogs(cfg(), first, sometimes, { retryDelay: 1 });
    expect(retried.translated).toEqual({ es: ['a'] });
    expect(flaky).toBe(2);

    let refused = 0;
    const unauthorized: TranslateProvider = () => {
      refused += 1;
      return Promise.reject(Object.assign(new Error('bad key'), { status: 401 }));
    };
    const second: Catalogs = { en: { a: 'A' }, es: {} };
    const stopped = await translateCatalogs(cfg(), second, unauthorized, { retryDelay: 1 });
    expect(refused).toBe(1);
    expect(stopped.failed[0]!.error).toContain('bad key');
  });

  it('runs independent batches in parallel up to the limit', async () => {
    let live = 0;
    let peak = 0;
    const slow: TranslateProvider = async (request) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return Object.fromEntries(Object.keys(request.messages).map((k) => [k, 'ok']));
    };
    const catalogs: Catalogs = { en: manyMessages(60), es: {}, pt: {}, fr: {} };

    await translateCatalogs(cfg(['en', 'es', 'pt', 'fr']), catalogs, slow, {
      batchSize: 20,
      concurrency: 3,
    });

    expect(peak).toBe(3);
    expect(Object.keys(catalogs.es!)).toHaveLength(60);
    expect(Object.keys(catalogs.fr!)).toHaveLength(60);
  });

  it('reports progress per batch, failures included', async () => {
    const seen: TranslateProgress[] = [];
    let calls = 0;
    const provider: TranslateProvider = async (request) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return Object.fromEntries(Object.keys(request.messages).map((k) => [k, 'ok']));
    };
    const catalogs: Catalogs = { en: manyMessages(4), es: {} };

    await translateCatalogs(cfg(), catalogs, provider, {
      batchSize: 2,
      concurrency: 1,
      retries: 0,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toHaveLength(2);
    expect(seen.every((entry) => entry.batches === 2)).toBe(true);
    expect(seen.filter((entry) => entry.error).map((entry) => entry.error)).toEqual(['boom']);
  });

  it('formats one line per reason and names every key it cost', () => {
    const lines = formatTranslateFailures([
      { locale: 'es', keys: ['a'], error: '529 overloaded' },
      { locale: 'es', keys: ['b', 'c'], error: '529 overloaded' },
      { locale: 'pt', keys: ['d'], error: 'ECONNRESET' },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('es: 3 messages not translated (529 overloaded): a, b, c');
    expect(lines[1]).toContain('pt: 1 message not translated (ECONNRESET): d');
  });
});

describe('translateCatalogs: project instructions and glossary', () => {
  it('sends only the glossary terms the batch contains, in the target locale', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const provider: TranslateProvider = (request) => {
      seen.push(request.glossary);
      return Promise.resolve(
        Object.fromEntries(Object.keys(request.messages).map((k) => [k, 'ok'])),
      );
    };
    const base = cfg(['en', 'es']);
    const config = {
      ...base,
      translate: {
        glossary: {
          Verbaly: 'Verbaly',
          checkout: { es: 'pago', pt: 'pagamento' },
          unused: 'never',
        },
      },
    };
    const catalogs: Catalogs = {
      en: { a: 'Welcome to Verbaly', b: 'Go to checkout' },
      es: { a: '', b: '' },
    };

    await translateCatalogs(config, catalogs, provider, { batchSize: 1, concurrency: 1 });

    expect(seen[0]).toEqual({ Verbaly: 'Verbaly' });
    expect(seen[1]).toEqual({ checkout: 'pago' });
  });

  it('rides the project instructions to the provider', async () => {
    let instructions: string | undefined;
    const provider: TranslateProvider = (request) => {
      instructions = request.instructions;
      return Promise.resolve({ a: 'ok' });
    };
    const base = cfg();
    const config = { ...base, translate: { instructions: 'Address the reader as tu.' } };
    await translateCatalogs(config, { en: { a: 'A' }, es: {} }, provider);
    expect(instructions).toBe('Address the reader as tu.');
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
