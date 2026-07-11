// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  negotiateLocale,
  persistLocale,
  resolveLocale,
  resolveRequestLocale,
} from '../src/locale';

const SUPPORTED = ['en', 'es', 'pt'];

function stubNavigator(languages: string[]): void {
  vi.stubGlobal('navigator', { language: languages[0], languages });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
});

describe('resolveLocale', () => {
  it('prefers a stored supported locale', () => {
    localStorage.setItem('verbaly-locale', 'pt');
    stubNavigator(['es-PE']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('pt');
  });

  it('ignores a stored unsupported locale', () => {
    localStorage.setItem('verbaly-locale', 'fr');
    stubNavigator(['es']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('es');
  });

  it('narrows a stored regional locale', () => {
    localStorage.setItem('verbaly-locale', 'es-PE');
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('es');
  });

  it('reads a custom storage key', () => {
    localStorage.setItem('my-locale', 'pt');
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED, storageKey: 'my-locale' })).toBe('pt');
  });

  it('skips storage when storageKey is false', () => {
    localStorage.setItem('verbaly-locale', 'pt');
    stubNavigator(['es']);
    expect(resolveLocale({ supported: SUPPORTED, storageKey: false })).toBe('es');
  });

  it('matches the exact navigator language', () => {
    stubNavigator(['pt', 'en']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('pt');
  });

  it('narrows BCP-47 regions', () => {
    stubNavigator(['es-PE', 'en-US']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('es');
  });

  it('narrows script subtags progressively (zh-Hant-TW → zh-Hant)', () => {
    stubNavigator(['zh-Hant-TW']);
    expect(resolveLocale({ supported: ['en', 'zh-Hant', 'zh'] })).toBe('zh-Hant');
  });

  it('walks the preference list in order', () => {
    stubNavigator(['fr-FR', 'pt-BR']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('pt');
  });

  it('falls back to the first supported locale', () => {
    stubNavigator(['fr']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('en');
  });

  it('honors an explicit fallback', () => {
    stubNavigator(['fr']);
    expect(resolveLocale({ supported: SUPPORTED, fallback: 'es' })).toBe('es');
  });

  it('is SSR-safe without navigator or storage', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('en');
  });

  it('survives blocked storage (privacy mode)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    stubNavigator(['pt']);
    try {
      expect(resolveLocale({ supported: SUPPORTED })).toBe('pt');
      expect(() => persistLocale('pt')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('negotiateLocale', () => {
  it('picks the exact supported tag', () => {
    expect(negotiateLocale('pt', SUPPORTED)).toBe('pt');
  });

  it('honors q-values over header order', () => {
    expect(negotiateLocale('es;q=0.5, pt;q=0.9', SUPPORTED)).toBe('pt');
  });

  it('keeps header order on q ties', () => {
    expect(negotiateLocale('pt, es', SUPPORTED)).toBe('pt');
  });

  it('narrows BCP-47 regions case-insensitively', () => {
    expect(negotiateLocale('es-PE,en-US;q=0.8', SUPPORTED)).toBe('es');
    expect(negotiateLocale('PT-BR', SUPPORTED)).toBe('pt');
  });

  it('narrows script subtags progressively (zh-Hant-TW → zh-Hant)', () => {
    expect(negotiateLocale('zh-Hant-TW', ['en', 'zh-Hant', 'zh'])).toBe('zh-Hant');
  });

  it('matches a regional supported entry from its header casing', () => {
    expect(negotiateLocale('es-mx', ['en', 'es-MX'])).toBe('es-MX');
  });

  it('skips unsupported tags and keeps walking', () => {
    expect(negotiateLocale('fr-FR, de;q=0.9, es;q=0.8', SUPPORTED)).toBe('es');
  });

  it('ignores q=0 entries (explicitly rejected)', () => {
    expect(negotiateLocale('es;q=0, pt;q=0.1', SUPPORTED)).toBe('pt');
  });

  it('treats a malformed q as 1', () => {
    expect(negotiateLocale('pt;q=abc, es;q=0.9', SUPPORTED)).toBe('pt');
  });

  it('ignores the wildcard', () => {
    expect(negotiateLocale('*', SUPPORTED)).toBe('en');
    expect(negotiateLocale('*;q=1, es;q=0.5', SUPPORTED)).toBe('es');
  });

  it('falls back on a missing or empty header', () => {
    expect(negotiateLocale(null, SUPPORTED)).toBe('en');
    expect(negotiateLocale(undefined, SUPPORTED)).toBe('en');
    expect(negotiateLocale('', SUPPORTED)).toBe('en');
  });

  it('honors an explicit fallback', () => {
    expect(negotiateLocale('fr', SUPPORTED, 'es')).toBe('es');
    expect(negotiateLocale(null, SUPPORTED, 'pt')).toBe('pt');
  });

  it('survives garbage input', () => {
    expect(negotiateLocale(';;;,,,q=;', SUPPORTED)).toBe('en');
    expect(negotiateLocale('es ; q = 0.9', SUPPORTED)).toBe('es');
  });
});

describe('resolveRequestLocale', () => {
  it('prefers the cookie over the header', () => {
    expect(
      resolveRequestLocale({ supported: SUPPORTED, cookie: 'pt', header: 'es' }),
    ).toBe('pt');
  });

  it('falls through to the header when the cookie does not match', () => {
    expect(
      resolveRequestLocale({ supported: SUPPORTED, cookie: 'fr', header: 'es-PE' }),
    ).toBe('es');
  });

  it('narrows a regional cookie', () => {
    expect(resolveRequestLocale({ supported: SUPPORTED, cookie: 'pt-BR' })).toBe('pt');
  });

  it('falls back when nothing matches', () => {
    expect(
      resolveRequestLocale({ supported: SUPPORTED, cookie: 'fr', header: 'de', fallback: 'es' }),
    ).toBe('es');
    expect(resolveRequestLocale({ supported: SUPPORTED })).toBe('en');
  });
});

describe('persistLocale', () => {
  it('stores the locale and syncs <html lang>', () => {
    persistLocale('es');
    expect(localStorage.getItem('verbaly-locale')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('writes to a custom storage key', () => {
    persistLocale('pt', 'my-locale');
    expect(localStorage.getItem('my-locale')).toBe('pt');
  });

  it('only syncs lang when storageKey is false', () => {
    persistLocale('es', false);
    expect(localStorage.getItem('verbaly-locale')).toBeNull();
    expect(document.documentElement.lang).toBe('es');
  });
});
