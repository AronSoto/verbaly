// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayNames } from '../src/intl';
import {
  localeDirection,
  localeFromPath,
  localeName,
  localePath,
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
  document.documentElement.removeAttribute('dir');
});

describe('localePath', () => {
  const opts = { supported: SUPPORTED, sourceLocale: 'en' };

  it('swaps one mirror prefix for another', () => {
    expect(localePath('pt', { ...opts, path: '/es/docs/start' })).toBe('/pt/docs/start');
  });

  it('enters the mirror from the source locale and leaves it again', () => {
    expect(localePath('es', { ...opts, path: '/docs' })).toBe('/es/docs');
    expect(localePath('en', { ...opts, path: '/es/docs' })).toBe('/docs');
  });

  it('keeps the trailing slash the page had, both ways', () => {
    expect(localePath('pt', { ...opts, path: '/es/' })).toBe('/pt/');
    expect(localePath('en', { ...opts, path: '/es/' })).toBe('/');
    expect(localePath('es', { ...opts, path: '/' })).toBe('/es/');
    expect(localePath('pt', { ...opts, path: '/es' })).toBe('/pt');
  });

  it('carries the query and the hash along', () => {
    expect(localePath('pt', { ...opts, path: '/es/docs?q=1#top' })).toBe('/pt/docs?q=1#top');
  });

  it('leaves a first segment that is not a locale where it is', () => {
    expect(localePath('es', { ...opts, path: '/escape/room' })).toBe('/es/escape/room');
  });

  it('never eats a page slug that merely starts like a locale', () => {
    expect(localePath('es', { ...opts, path: '/pt-and-friends' })).toBe('/es/pt-and-friends');
    expect(localePath('en', { ...opts, path: '/es/en-route-to-mars' })).toBe('/en-route-to-mars');
  });

  it('is its own inverse across a round trip', () => {
    const there = localePath('pt', { ...opts, path: '/es/docs/guide' });
    expect(localePath('es', { ...opts, path: there })).toBe('/es/docs/guide');
  });

  it('with no sourceLocale every locale gets a prefix', () => {
    expect(localePath('en', { supported: SUPPORTED, path: '/es/docs' })).toBe('/en/docs');
  });
});

describe('localeFromPath', () => {
  it('reads the prefix render wrote, narrowing a regional one', () => {
    expect(localeFromPath({ supported: SUPPORTED, path: '/es/docs/start' })).toBe('es');
    expect(localeFromPath({ supported: SUPPORTED, path: '/pt-BR/' })).toBe('pt');
  });

  it('answers undefined on the source tree instead of guessing a preference', () => {
    localStorage.setItem('verbaly-locale', 'pt');
    stubNavigator(['pt-BR']);
    expect(localeFromPath({ supported: SUPPORTED, path: '/docs/start' })).toBeUndefined();
    expect(localeFromPath({ supported: SUPPORTED, path: '/' })).toBeUndefined();
  });

  it('never mistakes a page slug that merely starts like a locale', () => {
    expect(localeFromPath({ supported: SUPPORTED, path: '/escape/room' })).toBeUndefined();
    expect(localeFromPath({ supported: SUPPORTED, path: '/pt-and-friends' })).toBeUndefined();
    expect(localeFromPath({ supported: SUPPORTED, path: '/en-route-to-mars' })).toBeUndefined();
  });

  it('still narrows a segment that is really shaped like a tag', () => {
    expect(localeFromPath({ supported: SUPPORTED, path: '/pt-BR/' })).toBe('pt');
    expect(localeFromPath({ supported: SUPPORTED, path: '/es-419/' })).toBe('es');
    expect(localeFromPath({ supported: ['en', 'zh'], path: '/zh-Hant-TW/' })).toBe('zh');
  });

  it('an exact supported code always matches, whatever its shape', () => {
    expect(localeFromPath({ supported: ['en', 'en-GB-oxendict'], path: '/en-GB-oxendict/x' })).toBe(
      'en-GB-oxendict',
    );
  });

  it('reads the real location when no path is given', () => {
    expect(localeFromPath({ supported: SUPPORTED })).toBeUndefined();
  });

  it('is the fact the docs pair with the source locale to get a total answer', () => {
    const localeOf = (path: string): string =>
      localeFromPath({ supported: SUPPORTED, path }) ?? 'en';
    expect(localeOf('/es/docs')).toBe('es');
    expect(localeOf('/docs')).toBe('en');
  });
});

describe('a site served under a base path', () => {
  const opts = { supported: SUPPORTED, sourceLocale: 'en', base: '/app' };

  it('finds the prefix that sits after the base', () => {
    expect(localeFromPath({ supported: SUPPORTED, path: '/app/es/docs', base: '/app' })).toBe('es');
    expect(
      localeFromPath({ supported: SUPPORTED, path: '/app/docs', base: '/app' }),
    ).toBeUndefined();
  });

  it('keeps the base in front of the locale it writes', () => {
    expect(localePath('es', { ...opts, path: '/app/docs' })).toBe('/app/es/docs');
    expect(localePath('pt', { ...opts, path: '/app/es/docs/' })).toBe('/app/pt/docs/');
    expect(localePath('en', { ...opts, path: '/app/es/docs' })).toBe('/app/docs');
    expect(localePath('es', { ...opts, path: '/app/' })).toBe('/app/es/');
  });

  it('reads app, /app and /app/ as the same base', () => {
    for (const base of ['app', '/app', '/app/']) {
      expect(localeFromPath({ supported: SUPPORTED, path: '/app/es/', base })).toBe('es');
      expect(localePath('es', { ...opts, base, path: '/app/docs' })).toBe('/app/es/docs');
    }
  });

  it('does not let base /app swallow a sibling path like /application', () => {
    expect(localeFromPath({ supported: SUPPORTED, path: '/application/es', base: '/app' })).toBe(
      undefined,
    );
    expect(localePath('es', { ...opts, path: '/application' })).toBe('/app/es/application');
  });

  it('reaches resolveLocale too', () => {
    localStorage.setItem('verbaly-locale', 'pt');
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/app/es/docs', base: '/app' })).toBe('es');
  });
});

describe('resolveLocale from the url', () => {
  it('takes the mirror prefix over storage and the browser: that page is already translated', () => {
    localStorage.setItem('verbaly-locale', 'pt');
    stubNavigator(['en-US']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/es/docs/start' })).toBe('es');
  });

  it('narrows a regional prefix to the supported locale', () => {
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/pt-BR/' })).toBe('pt');
  });

  it('ignores a first segment that is not a locale', () => {
    stubNavigator(['pt']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/escape/room' })).toBe('pt');
  });

  it('does not read a page slug as a mirror prefix', () => {
    stubNavigator(['pt']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/es-la-guia' })).toBe('pt');
  });

  it('falls through on the source-locale root, where there is no prefix', () => {
    localStorage.setItem('verbaly-locale', 'es');
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED, path: '/' })).toBe('es');
  });

  it('can be switched off for a site whose routes are not mirrors', () => {
    stubNavigator(['pt']);
    expect(resolveLocale({ supported: SUPPORTED, path: false })).toBe('pt');
  });

  it('reads the real location when no path is given', () => {
    stubNavigator(['en']);
    expect(resolveLocale({ supported: SUPPORTED })).toBe('en');
  });
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

  it('uses navigator.language when languages is missing', () => {
    vi.stubGlobal('navigator', { language: 'pt' });
    expect(resolveLocale({ supported: SUPPORTED })).toBe('pt');
  });

  it('an empty supported list falls back to en', () => {
    stubNavigator(['es']);
    expect(resolveLocale({ supported: [] })).toBe('en');
    expect(negotiateLocale('es', [])).toBe('en');
    expect(resolveRequestLocale({ supported: [] })).toBe('en');
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
    expect(resolveRequestLocale({ supported: SUPPORTED, cookie: 'pt', header: 'es' })).toBe('pt');
  });

  it('falls through to the header when the cookie does not match', () => {
    expect(resolveRequestLocale({ supported: SUPPORTED, cookie: 'fr', header: 'es-PE' })).toBe(
      'es',
    );
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

describe('localeDirection', () => {
  it('detects rtl languages', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('he')).toBe('rtl');
    expect(localeDirection('fa-IR')).toBe('rtl');
    expect(localeDirection('ur')).toBe('rtl');
  });

  it('detects ltr languages', () => {
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('es-419')).toBe('ltr');
    expect(localeDirection('zh-Hant-TW')).toBe('ltr');
    expect(localeDirection('ja')).toBe('ltr');
  });

  it('honors an explicit script over the language default', () => {
    expect(localeDirection('az-Arab')).toBe('rtl');
    expect(localeDirection('az')).toBe('ltr');
  });

  it('never throws on malformed tags', () => {
    expect(localeDirection('not a locale!')).toBe('ltr');
    expect(localeDirection('')).toBe('ltr');
    expect(localeDirection('AR')).toBe('rtl');
    expect(localeDirection('ar-!!')).toBe('rtl');
  });
});

describe('localeDirection without Intl textInfo (Firefox)', () => {
  const original = Object.getOwnPropertyDescriptor(Intl, 'Locale')!;
  const RealLocale = Intl.Locale;

  // emulates engines whose Intl.Locale lacks getTextInfo/textInfo
  function installFakeLocale(overrides: PropertyDescriptorMap = {}): void {
    class Fake extends RealLocale {}
    Object.defineProperties(Fake.prototype, {
      textInfo: { get: () => undefined, configurable: true },
      getTextInfo: { value: undefined, configurable: true },
      ...overrides,
    });
    Object.defineProperty(Intl, 'Locale', {
      value: Fake,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(Intl, 'Locale', original);
  });

  it('falls back to the script subtag, maximizing when absent', () => {
    installFakeLocale();
    expect(localeDirection('az-Arab')).toBe('rtl');
    expect(localeDirection('ar')).toBe('rtl'); // no script: via maximize()
    expect(localeDirection('en')).toBe('ltr');
  });

  it('falls back to the language subtag when no script resolves', () => {
    installFakeLocale({
      script: { get: () => undefined, configurable: true },
      maximize: { value: () => ({ script: undefined }), configurable: true },
    });
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
  });
});

describe('localeName', () => {
  it('returns the endonym by default', () => {
    expect(localeName('es')).toBe('español');
    expect(localeName('en')).toBe('English');
  });

  it('translates the name into another locale', () => {
    expect(localeName('de', 'en')).toBe('German');
    expect(localeName('en', 'es')).toBe('inglés');
  });

  it('handles regional tags', () => {
    expect(localeName('pt-BR')).toContain('português');
  });

  it('falls back to the tag itself on garbage', () => {
    expect(localeName('???')).toBe('???');
    expect(localeName('es', '???')).toBe('es');
  });

  it('falls back to the tag when DisplayNames returns undefined', () => {
    // Intl allows of() to return undefined (fallback: none engines)
    const spy = vi.spyOn(displayNames('en'), 'of').mockReturnValue(undefined);
    expect(localeName('zz', 'en')).toBe('zz');
    spy.mockRestore();
  });
});

describe('persistLocale', () => {
  it('stores the locale and syncs <html lang>', () => {
    persistLocale('es');
    expect(localStorage.getItem('verbaly-locale')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('syncs <html dir> with the locale direction', () => {
    persistLocale('ar');
    expect(document.documentElement.dir).toBe('rtl');
    persistLocale('es');
    expect(document.documentElement.dir).toBe('ltr');
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
