// runs in the default node environment: no document/navigator/localStorage (SSR/Node)
import { describe, expect, it } from 'vitest';
import { bindDom } from '../src/dom';
import { attachDevtools } from '../src/devtools';
import { createVerbaly } from '../src/instance';
import {
  localeFromPath,
  localePath,
  negotiateLocale,
  persistLocale,
  resolveLocale,
  switchLocale,
} from '../src/locale';
import type { DictionaryInput } from '../src/types';

describe('server-side (Node)', () => {
  it('has no DOM (document): the browser discriminator', () => {
    // Node 21+ exposes a global navigator, so document is the reliable "is browser" guard
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });

  it('createVerbaly + t work per request without a DOM', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      fallback: 'en',
      messages: {
        en: { items: '{n | one: # item | other: # items}' },
        es: { items: '{n | one: # artículo | other: # artículos}' },
      },
    });
    expect(v.t('items', { n: 2 })).toBe('2 artículos');
    // a second, independent request-scoped instance
    const en = createVerbaly<DictionaryInput>({ locale: 'en', messages: { en: { items: 'x' } } });
    expect(en.locale).toBe('en');
    expect(v.locale).toBe('es'); // instances don't share state
  });

  it('defaults locale to en when navigator is absent', () => {
    expect(createVerbaly().locale).toBe('en');
  });

  it('resolveLocale falls back without navigator/storage', () => {
    expect(resolveLocale({ supported: ['en', 'es'], fallback: 'en' })).toBe('en');
  });

  it('reads no url on a server, and still maps a path it is handed', () => {
    // there is no page here to take a prefix from, but the mapping itself is pure
    expect(resolveLocale({ supported: ['en', 'es'], fallback: 'en', path: '/es/x' })).toBe('es');
    expect(localePath('es', { supported: ['en', 'es'], sourceLocale: 'en', path: '/x' })).toBe(
      '/es/x',
    );
    expect(localeFromPath({ supported: ['en', 'es'], path: '/es/x' })).toBe('es');
    expect(localeFromPath({ supported: ['en', 'es'] })).toBeUndefined();
    expect(() => localePath('es', { supported: ['en', 'es'] })).not.toThrow();
  });

  it('persistLocale is a no-op (no throw) without document', () => {
    expect(() => persistLocale('es')).not.toThrow();
  });

  it('negotiateLocale resolves a request locale without a DOM', () => {
    // the SSR entry point: Accept-Language → supported locale, per request
    expect(negotiateLocale('es-PE,en;q=0.8', ['en', 'es', 'pt'])).toBe('es');
    expect(negotiateLocale(null, ['en', 'es'], 'en')).toBe('en');
  });

  it('DOM-only APIs throw a clear error server-side', () => {
    expect(() => bindDom(createVerbaly())).toThrow('requires a DOM');
    expect(() => attachDevtools(createVerbaly())).toThrow('requires a DOM');
  });

  it('switchLocale is SSR-safe without a DOM: loads then sets, no throw', async () => {
    const calls: string[] = [];
    const instance = {
      loadLocale: (locale: string) => {
        calls.push(`load:${locale}`);
        return Promise.resolve();
      },
      setLocale: (locale: string) => {
        calls.push(`set:${locale}`);
      },
    };
    await expect(switchLocale(instance, 'es')).resolves.toBeUndefined();
    expect(calls).toEqual(['load:es', 'set:es']); // catalog first: the no-flash order
  });
});
