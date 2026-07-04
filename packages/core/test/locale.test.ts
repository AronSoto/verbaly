// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistLocale, resolveLocale } from '../src/locale';

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
