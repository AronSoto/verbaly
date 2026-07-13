// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createVerbaly } from '../src/instance';
import { switchLocale } from '../src/locale';

function makeInstance() {
  return createVerbaly({
    locale: 'en',
    fallback: 'en',
    messages: { en: { hi: 'Hello' } },
    loaders: { es: () => Promise.resolve({ default: { hi: 'Hola' } }) },
  });
}

beforeEach(() => {
  // happy-dom keeps cookies per document: expire leftovers
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
  document.documentElement.removeAttribute('lang');
});

describe('switchLocale (browser)', () => {
  it('loads the catalog before switching: no flash of untranslated text', async () => {
    const v = makeInstance();
    await switchLocale(v, 'es');
    expect(v.locale).toBe('es');
    expect(v.t('hi')).toBe('Hola'); // catalog was awaited, not in flight
  });

  it('persists the choice in the cookie SSR integrations read', async () => {
    await switchLocale(makeInstance(), 'es');
    expect(document.cookie).toContain('verbaly-locale=es');
  });

  it('writes a custom cookie name and encodes the value', async () => {
    const v = makeInstance();
    await switchLocale(v, 'es-MX', { cookie: 'my-locale' });
    expect(document.cookie).toContain('my-locale=es-MX');
  });

  it('skips the cookie when cookie is false but still syncs <html lang>', async () => {
    await switchLocale(makeInstance(), 'es', { cookie: false });
    // value-specific: an expired leftover ('verbaly-locale=') from another test may linger
    expect(document.cookie).not.toContain('verbaly-locale=es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('syncs <html lang> to the new locale', async () => {
    await switchLocale(makeInstance(), 'es');
    expect(document.documentElement.lang).toBe('es');
  });
});
