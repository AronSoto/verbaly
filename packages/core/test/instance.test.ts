import { describe, expect, it, vi } from 'vitest';
import { createVerbaly } from '../src/instance';
import type { DictionaryInput } from '../src/types';

describe('locale resolution', () => {
  it('narrows BCP-47 subtags', () => {
    const v = createVerbaly({
      locale: 'es-MX',
      messages: { es: { hello: 'Hola' } },
    });
    expect(v.t('hello')).toBe('Hola');
  });

  it('walks the fallback chain', () => {
    const v = createVerbaly({
      locale: 'pt',
      fallback: ['es', 'en'],
      messages: { en: { onlyEn: 'English only' }, es: {}, pt: {} },
    });
    expect(v.t('onlyEn')).toBe('English only');
  });

  it('recomputes the chain after setLocale', () => {
    const v = createVerbaly({
      locale: 'es-MX',
      messages: { es: { a: 'Hola' }, 'pt-BR': { a: 'Oi' }, pt: { b: 'Base' } },
    });
    expect(v.t('a')).toBe('Hola');
    v.setLocale('pt-BR');
    expect(v.t('a')).toBe('Oi');
    expect(v.t('b')).toBe('Base');
  });

  it('reports key existence', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { a: 'x' } } });
    expect(v.has('a')).toBe(true);
    expect(v.has('b')).toBe(false);
  });

  it("treats '' as untranslated: keeps falling back", () => {
    // extract scaffolds new keys as '' (check counts them as missing)
    const v = createVerbaly({
      locale: 'es',
      fallback: 'en',
      messages: { en: { a: 'Source' }, es: { a: '' } },
    });
    expect(v.t('a')).toBe('Source');
    expect(v.inspect('a')).toEqual({ from: 'en', source: 'Source' });
  });

  it("'' everywhere in the chain is a miss", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly({ locale: 'es', fallback: 'en', messages: { en: { a: '' }, es: {} } });
    expect(v.has('a')).toBe(false);
    expect(v.t('a')).toBe('a');
    warn.mockRestore();
  });

  it('lists loaded locales', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { a: 'x' }, en: { a: 'y' } } });
    expect(v.locales).toEqual(['es', 'en']);
    v.addMessages('pt', { a: 'z' });
    expect(v.locales).toEqual(['es', 'en', 'pt']);
  });
});

describe('missing keys', () => {
  it('returns the key and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly<DictionaryInput>({ locale: 'es', messages: { es: {} } });
    expect(v.t('nope')).toBe('nope');
    expect(v.t('nope')).toBe('nope');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('delegates to onMissing', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      messages: { es: {} },
      onMissing: (key) => `[${key}]`,
    });
    expect(v.t('nope')).toBe('[nope]');
  });
});

describe('observability', () => {
  it('reports hit, fallback and miss to onResolve', () => {
    const seen: Array<{ key: string; status: string; from?: string; value: string }> = [];
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      fallback: 'en',
      messages: { en: { greet: 'Hi {name}', only_en: 'Root' }, es: { greet: 'Hola {name}' } },
      onResolve: (info) => seen.push(info),
    });
    v.t('greet', { name: 'A' });
    v.t('only_en');
    v.t('nope');
    expect(seen).toEqual([
      { key: 'greet', locale: 'es', value: 'Hola A', status: 'hit', from: 'es' },
      { key: 'only_en', locale: 'es', value: 'Root', status: 'fallback', from: 'en' },
      { key: 'nope', locale: 'es', value: 'nope', status: 'miss' },
    ]);
  });

  it('onResolve sees the onMissing replacement value', () => {
    const seen: string[] = [];
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      messages: { es: {} },
      onMissing: (key) => `[${key}]`,
      onResolve: (info) => seen.push(info.value),
    });
    v.t('nope');
    expect(seen).toEqual(['[nope]']);
  });

  it('inspect returns origin locale and source text', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      fallback: 'en',
      messages: { en: { a: 'A', b: 'B' }, es: { a: 'Ae' } },
    });
    expect(v.inspect('a')).toEqual({ from: 'es', source: 'Ae' });
    expect(v.inspect('b')).toEqual({ from: 'en', source: 'B' });
    expect(v.inspect('nope')).toBeUndefined();
  });

  it('narrows script subtags progressively (zh-Hant-TW → zh-Hant → zh)', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'zh-Hant-TW',
      messages: { 'zh-Hant': { a: '繁' }, zh: { a: '简', b: '简b' } },
    });
    expect(v.inspect('a')).toEqual({ from: 'zh-Hant', source: '繁' });
    expect(v.inspect('b')).toEqual({ from: 'zh', source: '简b' });
  });
});

describe('reactivity', () => {
  it('notifies on locale change', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(v.locale).toBe('en');
  });

  it('bumps version on every change', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    expect(v.version).toBe(0);
    v.setLocale('en');
    v.addMessages('pt', { a: 'A' });
    expect(v.version).toBe(2);
  });

  it('skips notify when locale unchanged', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.setLocale('es');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on addMessages and merges', () => {
    const v = createVerbaly<DictionaryInput>({ locale: 'pt', messages: { pt: { a: 'A' } } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.addMessages('pt', { b: 'B' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(v.t('a')).toBe('A');
    expect(v.t('b')).toBe('B');
  });

  it('unsubscribes', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    const unsub = v.subscribe(listener);
    unsub();
    v.setLocale('en');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('nested messages', () => {
  it('flattens dotted keys', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { home: { title: 'Inicio', nav: { back: 'Volver' } } } },
    });
    expect(v.t('home.title')).toBe('Inicio');
    expect(v.t('home.nav.back')).toBe('Volver');
  });
});

describe('tagged template', () => {
  it('interpolates source text', () => {
    const v = createVerbaly({ locale: 'en', messages: { en: {} } });
    const name = 'Aron';
    const count = 1234.5;
    expect(v.t`Hello ${name}, ${count} points`).toBe('Hello Aron, 1,234.5 points');
  });

  it('t.id formats the inline source', () => {
    const v = createVerbaly({ locale: 'en', messages: { en: {} } });
    const name = 'Aron';
    expect(v.t.id('home.greet')`Hello ${name}`).toBe('Hello Aron');
  });
});

describe('lazy loaders', () => {
  it('loadLocale applies the catalog', async () => {
    const v = createVerbaly({
      locale: 'en',
      messages: { en: { a: 'A' } },
      loaders: { es: () => Promise.resolve({ a: 'La A' }) },
    });
    await v.loadLocale('es');
    v.setLocale('es');
    expect(v.t('a')).toBe('La A');
  });

  it('unwraps module default exports', async () => {
    const v = createVerbaly({
      locale: 'en',
      messages: { en: {} },
      loaders: { es: () => Promise.resolve({ default: { a: 'La A' } }) },
    });
    await v.loadLocale('es');
    v.setLocale('es');
    expect(v.t('a')).toBe('La A');
  });

  it('narrows BCP-47 to the loadable subtag', async () => {
    const v = createVerbaly({
      locale: 'en',
      messages: { en: {} },
      loaders: { es: () => Promise.resolve({ a: 'La A' }) },
    });
    await v.loadLocale('es-MX');
    v.setLocale('es-MX');
    expect(v.t('a')).toBe('La A');
  });

  it('dedupes in-flight loads', async () => {
    const loader = vi.fn(() => Promise.resolve({ a: 'La A' }));
    const v = createVerbaly({ locale: 'en', messages: { en: {} }, loaders: { es: loader } });
    await Promise.all([v.loadLocale('es'), v.loadLocale('es'), v.loadLocale('es-MX')]);
    await v.loadLocale('es');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('setLocale auto-loads the pending catalog', async () => {
    let resolve!: (tree: Record<string, string>) => void;
    const v = createVerbaly({
      locale: 'en',
      fallback: 'en',
      messages: { en: { a: 'A' } },
      loaders: { es: () => new Promise((r) => (resolve = r)) },
    });
    const listener = vi.fn();
    v.subscribe(listener);
    v.setLocale('es');
    expect(v.t('a')).toBe('A'); // fallback while loading
    resolve({ a: 'La A' });
    await Promise.resolve();
    expect(v.t('a')).toBe('La A');
    expect(listener).toHaveBeenCalledTimes(2); // locale change + catalog arrival
  });

  it('being born in a locale loads it, the same way setLocale does', async () => {
    let resolve!: (tree: Record<string, string>) => void;
    const loader = vi.fn(() => new Promise<Record<string, string>>((r) => (resolve = r)));
    const v = createVerbaly({
      locale: 'es',
      fallback: 'en',
      messages: { en: { a: 'A' } },
      loaders: { es: loader },
    });
    const listener = vi.fn();
    v.subscribe(listener);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(v.t('a')).toBe('A'); // fallback while it flies
    resolve({ a: 'La A' });
    await Promise.resolve();
    expect(v.t('a')).toBe('La A');
    expect(listener).toHaveBeenCalledTimes(1); // the catalog arriving, no locale change
  });

  it('an awaited loadLocale on the same locale rides the load construction started', async () => {
    const loader = vi.fn(() => Promise.resolve({ a: 'La A' }));
    const v = createVerbaly({ locale: 'es', messages: { en: {} }, loaders: { es: loader } });
    await v.loadLocale('es'); // what createRequestInstance does
    expect(loader).toHaveBeenCalledTimes(1);
    expect(v.t('a')).toBe('La A');
  });

  it('setLocale right after construction does not load twice', async () => {
    const loader = vi.fn(() => Promise.resolve({ a: 'La A' }));
    const v = createVerbaly({ locale: 'es', messages: { en: {} }, loaders: { es: loader } });
    v.setLocale('es');
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('a locale with no loader asks for nothing, which is the source locale case', () => {
    const loader = vi.fn(() => Promise.resolve({}));
    createVerbaly({ locale: 'en', messages: { en: { a: 'A' } }, loaders: { es: loader } });
    expect(loader).not.toHaveBeenCalled();
  });

  // pt, not es: warnOnce dedupes on the text, and the retry test below owns the es one
  it('a loader that fails at construction warns instead of rejecting into nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly({
      locale: 'pt',
      fallback: 'en',
      messages: { en: { a: 'A' } },
      loaders: { pt: () => Promise.reject(new Error('net')) },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(v.t('a')).toBe('A');
    warn.mockRestore();
  });

  it('lists loader locales before loading', () => {
    const v = createVerbaly({
      locale: 'en',
      messages: { en: {} },
      loaders: { es: () => Promise.resolve({}), pt: () => Promise.resolve({}) },
    });
    expect(v.locales).toEqual(['en', 'es', 'pt']);
  });

  it('failed loads reject, warn once via setLocale, and can retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const v = createVerbaly({
      locale: 'en',
      messages: { en: {} },
      loaders: {
        es: () => (fail ? Promise.reject(new Error('net')) : Promise.resolve({ a: 'La A' })),
      },
    });
    await expect(v.loadLocale('es')).rejects.toThrow('net');
    v.setLocale('es');
    v.setLocale('es');
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    fail = false;
    await v.loadLocale('es');
    expect(v.t('a')).toBe('La A');
    warn.mockRestore();
  });
});

describe('detectLocale', () => {
  it('defaults to en without a DOM, even if navigator exists (Node 21+)', () => {
    vi.stubGlobal('navigator', { language: 'es-PE' }); // present, but no document
    const v = createVerbaly({ messages: { en: { a: 'x' } } });
    expect(v.locale).toBe('en');
    vi.unstubAllGlobals();
  });

  it('picks navigator.language in a browser (document present)', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { language: 'es-PE' });
    expect(createVerbaly({ messages: {} }).locale).toBe('es-PE');
    vi.stubGlobal('navigator', { language: '' });
    expect(createVerbaly({ messages: {} }).locale).toBe('en');
    vi.unstubAllGlobals();
  });
});
