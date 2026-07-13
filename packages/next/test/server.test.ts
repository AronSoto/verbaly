import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = {
  cookieName: 'verbaly-locale',
  cookie: undefined as string | undefined,
  header: undefined as string | undefined,
};

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === jar.cookieName && jar.cookie !== undefined ? { value: jar.cookie } : undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => (name === 'accept-language' ? (jar.header ?? null) : null),
    }),
}));

async function load(options: { cookie?: string | false; fallback?: string } = {}) {
  vi.resetModules();
  const virtual = await import('virtual:verbaly');
  virtual.requestOptions!.cookie = options.cookie;
  virtual.requestOptions!.fallback = options.fallback;
  return import('../src/server');
}

beforeEach(() => {
  jar.cookieName = 'verbaly-locale';
  jar.cookie = undefined;
  jar.header = undefined;
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
