import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Routing } from 'verbaly';

const jar = {
  cookieName: 'verbaly-locale',
  cookie: undefined as string | undefined,
  header: undefined as string | undefined,
  reads: 0,
};

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === jar.cookieName && jar.cookie !== undefined ? { value: jar.cookie } : undefined,
    }),
  headers: () => {
    // counted because reading it is exactly what opts a Next route out of static rendering
    jar.reads += 1;
    return Promise.resolve({
      get: (name: string) => (name === 'accept-language' ? (jar.header ?? null) : null),
    });
  },
}));

// the mock by its own path, not through the alias: same module instance, and its real types
async function load(
  options: { cookie?: string | false; fallback?: string; routing?: Routing } = {},
) {
  vi.resetModules();
  const virtual = await import('./mocks/virtual-verbaly');
  virtual.requestOptions.cookie = options.cookie;
  virtual.requestOptions.fallback = options.fallback;
  virtual.setRouting(options.routing ?? 'no-prefix');
  return import('../src/server');
}

beforeEach(() => {
  jar.cookieName = 'verbaly-locale';
  jar.cookie = undefined;
  jar.header = undefined;
  jar.reads = 0;
});

describe('@verbaly/next/server', () => {
  it('negotiates from Accept-Language', async () => {
    jar.header = 'es-MX;q=0.9, en;q=0.5';
    const server = await load();
    expect(await server.getRequestLocale()).toBe('es');
    const t = await server.getT();
    expect(t('greeting')).toBe('Hola');
  });

  it('cookie beats header', async () => {
    jar.cookie = 'es';
    jar.header = 'en';
    const server = await load();
    expect(await server.getRequestLocale()).toBe('es');
  });

  it('falls back to the source locale', async () => {
    const server = await load();
    expect(await server.getRequestLocale()).toBe('en');
  });

  it('honors a custom cookie name', async () => {
    jar.cookieName = 'lang';
    jar.cookie = 'es';
    const server = await load({ cookie: 'lang' });
    expect(await server.getRequestLocale()).toBe('es');
  });

  it('cookie: false ignores the cookie', async () => {
    jar.cookie = 'es';
    const server = await load({ cookie: false });
    expect(await server.getRequestLocale()).toBe('en');
  });

  it('honors the fallback option', async () => {
    const server = await load({ fallback: 'es' });
    expect(await server.getRequestLocale()).toBe('es');
  });

  it('getVerbaly returns a request-scoped instance with the catalog loaded', async () => {
    jar.header = 'es';
    const server = await load();
    const instance = await server.getVerbaly();
    expect(instance.locale).toBe('es');
    expect(instance.t('farewell')).toBe('Chau');
  });

  it('getVerbalyProps omits messages for the source locale', async () => {
    const server = await load();
    expect(await server.getVerbalyProps()).toEqual({ locale: 'en' });
  });

  it('getVerbalyProps serializes the negotiated catalog', async () => {
    jar.header = 'es';
    const server = await load();
    expect(await server.getVerbalyProps()).toEqual({
      locale: 'es',
      messages: { greeting: 'Hola', farewell: 'Chau' },
    });
  });
});

describe('setRequestLocale', () => {
  it('takes the [locale] segment over the cookie and the header', async () => {
    jar.cookie = 'en';
    jar.header = 'en-US';
    const server = await load();
    server.setRequestLocale('es');
    expect(await server.getRequestLocale()).toBe('es');
    const t = await server.getT();
    expect(t('greeting')).toBe('Hola');
  });

  it('never reads headers, which is what keeps the route statically rendered', async () => {
    const server = await load();
    server.setRequestLocale('es');
    await server.getT();
    expect(jar.reads).toBe(0);
  });

  it('still negotiates when no segment declared a locale', async () => {
    jar.header = 'es';
    const server = await load();
    expect(await server.getRequestLocale()).toBe('es');
    expect(jar.reads).toBe(1);
  });

  it('narrows a regional segment the way a url segment narrows', async () => {
    const server = await load();
    server.setRequestLocale('es-419');
    expect(await server.getRequestLocale()).toBe('es');
  });

  it('warns and negotiates when the segment is not one of the locales', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.header = 'es';
    const server = await load();
    server.setRequestLocale('fr');
    expect(await server.getRequestLocale()).toBe('es');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('setRequestLocale'));
    warn.mockRestore();
  });
});

describe('getAlternates', () => {
  it('gives the hreflang set and the canonical for the page', async () => {
    const server = await load({ routing: 'prefix-except-source' });
    expect(server.getAlternates({ path: '/es/docs', baseUrl: 'https://x.dev' })).toEqual({
      canonical: 'https://x.dev/es/docs',
      languages: {
        en: 'https://x.dev/docs',
        es: 'https://x.dev/es/docs',
        'x-default': 'https://x.dev/docs',
      },
    });
  });

  it('points the canonical at the source tree for an unprefixed path', async () => {
    const server = await load({ routing: 'prefix-except-source' });
    const { canonical } = server.getAlternates({ path: '/docs', baseUrl: 'https://x.dev' });
    expect(canonical).toBe('https://x.dev/docs');
  });

  it('writes nothing under no-prefix, where one url answers every language', async () => {
    const server = await load();
    expect(server.getAlternates({ path: '/docs' })).toEqual({
      canonical: undefined,
      languages: {},
    });
  });
});
