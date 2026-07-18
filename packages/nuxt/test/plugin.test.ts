// default node environment: the SSR surface (no DOM)
import { beforeEach, describe, expect, it } from 'vitest';
import type { Verbaly } from 'verbaly';
import plugin from '../src/runtime/plugin';
import { headInputs, resetNuxtMock, seedState } from './mocks/imports';
import { loadedLocales } from './mocks/virtual-verbaly';

const runPlugin = plugin as unknown as (nuxtApp: unknown) => Promise<void>;

function makeNuxtApp(headers?: Record<string, string>) {
  const provided: unknown[] = [];
  const vueApp = {
    use(p: { install(app: never): void }) {
      p.install({ provide: (_key: unknown, value: unknown) => provided.push(value) } as never);
      return vueApp;
    },
  };
  return {
    provided,
    nuxtApp: {
      vueApp,
      ...(headers ? { ssrContext: { event: { headers: new Headers(headers) } } } : {}),
    },
  };
}

async function run(headers?: Record<string, string>): Promise<Verbaly> {
  const { nuxtApp, provided } = makeNuxtApp(headers);
  await runPlugin(nuxtApp);
  return provided[0] as Verbaly;
}

beforeEach(() => {
  resetNuxtMock();
  loadedLocales.length = 0;
});

describe('runtime plugin (server)', () => {
  it('negotiates the locale from Accept-Language', async () => {
    const instance = await run({ 'accept-language': 'es-PE,en;q=0.8' });
    expect(instance.locale).toBe('es');
    expect(instance.t('greet')).toBe('Hola'); // catalog awaited before install: no flash
  });

  it('prefers the cookie over the header', async () => {
    const instance = await run({ cookie: 'verbaly-locale=pt', 'accept-language': 'es' });
    expect(instance.locale).toBe('pt');
    expect(instance.t('greet')).toBe('Olá');
  });

  it('narrows a regional cookie value', async () => {
    const instance = await run({ cookie: 'verbaly-locale=es-PE' });
    expect(instance.locale).toBe('es');
  });

  it('ignores an unsupported cookie and falls back to the header', async () => {
    const instance = await run({ cookie: 'verbaly-locale=fr', 'accept-language': 'pt-BR' });
    expect(instance.locale).toBe('pt');
  });

  it('falls back to the source locale when nothing matches', async () => {
    const instance = await run({ 'accept-language': 'fr' });
    expect(instance.locale).toBe('en');
    expect(loadedLocales).toEqual([]); // source catalog is inline: nothing to load
  });

  it('skips the cookie when the module sets cookie: false', async () => {
    resetNuxtMock({ verbaly: { cookie: false } });
    const instance = await run({ cookie: 'verbaly-locale=pt', 'accept-language': 'es' });
    expect(instance.locale).toBe('es');
  });

  it('reads a custom cookie name', async () => {
    resetNuxtMock({ verbaly: { cookie: 'my-locale' } });
    const instance = await run({ cookie: 'verbaly-locale=es; my-locale=pt' });
    expect(instance.locale).toBe('pt');
  });

  it('honors a custom fallback', async () => {
    resetNuxtMock({ verbaly: { fallback: 'pt' } });
    const instance = await run({ 'accept-language': 'fr' });
    expect(instance.locale).toBe('pt');
  });

  it('hydration: reuses the payload locale without re-negotiating', async () => {
    // no ssrContext (client): the state seeded from the payload must win untouched
    seedState('verbaly:locale', 'es');
    const instance = await run();
    expect(instance.locale).toBe('es');
    expect(instance.t('greet')).toBe('Hola');
  });

  it('sets <html lang> and keeps it in sync with the live locale', async () => {
    const instance = await run({ 'accept-language': 'es' });
    const head = headInputs[0] as { htmlAttrs: { lang: { value: string } } };
    expect(head.htmlAttrs.lang.value).toBe('es');

    await instance.loadLocale('pt');
    instance.setLocale('pt');
    expect(head.htmlAttrs.lang.value).toBe('pt');
  });

  it('sets <html dir> and keeps it in sync with the live locale', async () => {
    const instance = await run({ 'accept-language': 'es' });
    const head = headInputs[0] as { htmlAttrs: { dir: { value: string } } };
    expect(head.htmlAttrs.dir.value).toBe('ltr');

    await instance.loadLocale('ar');
    instance.setLocale('ar');
    expect(head.htmlAttrs.dir.value).toBe('rtl');
  });

  it('gives every request its own instance: no locale leaking', async () => {
    const first = await run({ 'accept-language': 'pt' });
    resetNuxtMock(); // next request: fresh nuxt app state
    const second = await run({ 'accept-language': 'es' });
    expect(first).not.toBe(second);
    expect(first.locale).toBe('pt'); // untouched by the second request
    expect(second.locale).toBe('es');
  });
});
