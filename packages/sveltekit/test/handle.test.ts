// default node environment: the server-side surface (no DOM)
import type { Handle } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { switchLocale, verbalyHandle, LOCALE_COOKIE } from '../src/index';

const LOCALES = ['en', 'es', 'pt'];

interface MockEvent {
  request: Request;
  cookies: { get(name: string): string | undefined };
  locals: { verbalyLocale?: string };
}

function makeEvent(
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
): MockEvent {
  return {
    request: new Request('http://localhost/', { headers }),
    cookies: { get: (name) => cookies[name] },
    locals: {},
  };
}

interface ResolveCapture {
  transformPageChunk?(input: { html: string; done: boolean }): string | undefined;
}

async function run(
  handle: ReturnType<typeof verbalyHandle>,
  event: MockEvent,
): Promise<{ opts: ResolveCapture | undefined; response: Response }> {
  let opts: ResolveCapture | undefined;
  const response = await handle({
    event,
    resolve: (_event, resolveOpts) => {
      opts = resolveOpts;
      return new Response('ok');
    },
  });
  return { opts, response };
}

describe('verbalyHandle', () => {
  it('negotiates the locale from Accept-Language', async () => {
    const event = makeEvent({ 'accept-language': 'es-PE,en;q=0.8' });
    await run(verbalyHandle({ locales: LOCALES }), event);
    expect(event.locals.verbalyLocale).toBe('es');
  });

  it('prefers the cookie over the header', async () => {
    const event = makeEvent({ 'accept-language': 'en' }, { [LOCALE_COOKIE]: 'pt' });
    await run(verbalyHandle({ locales: LOCALES }), event);
    expect(event.locals.verbalyLocale).toBe('pt');
  });

  it('narrows a regional cookie value', async () => {
    const event = makeEvent({}, { [LOCALE_COOKIE]: 'es-PE' });
    await run(verbalyHandle({ locales: LOCALES }), event);
    expect(event.locals.verbalyLocale).toBe('es');
  });

  it('ignores an unsupported cookie and falls back to the header', async () => {
    const event = makeEvent({ 'accept-language': 'pt-BR' }, { [LOCALE_COOKIE]: 'fr' });
    await run(verbalyHandle({ locales: LOCALES }), event);
    expect(event.locals.verbalyLocale).toBe('pt');
  });

  it('skips the cookie when cookie is false', async () => {
    const event = makeEvent({ 'accept-language': 'es' }, { [LOCALE_COOKIE]: 'pt' });
    await run(verbalyHandle({ locales: LOCALES, cookie: false }), event);
    expect(event.locals.verbalyLocale).toBe('es');
  });

  it('reads a custom cookie name', async () => {
    const event = makeEvent({}, { 'my-locale': 'pt' });
    await run(verbalyHandle({ locales: LOCALES, cookie: 'my-locale' }), event);
    expect(event.locals.verbalyLocale).toBe('pt');
  });

  it('falls back when nothing matches', async () => {
    const event = makeEvent({ 'accept-language': 'fr' });
    await run(verbalyHandle({ locales: LOCALES, fallback: 'es' }), event);
    expect(event.locals.verbalyLocale).toBe('es');

    const bare = makeEvent();
    await run(verbalyHandle({ locales: LOCALES }), bare);
    expect(bare.locals.verbalyLocale).toBe('en');
  });

  it('fills every %verbaly.lang% occurrence in the page', async () => {
    const event = makeEvent({ 'accept-language': 'es' });
    const { opts } = await run(verbalyHandle({ locales: LOCALES }), event);
    const html = '<html lang="%verbaly.lang%"><body data-lang="%verbaly.lang%">';
    expect(opts?.transformPageChunk?.({ html, done: true })).toBe(
      '<html lang="es"><body data-lang="es">',
    );
  });

  it('passes the resolved response through', async () => {
    const { response } = await run(verbalyHandle({ locales: LOCALES }), makeEvent());
    expect(await response.text()).toBe('ok');
  });

  it('throws an actionable error without locales (old virtual module)', () => {
    // an outdated @verbaly/vite exports no `locales`: the import arrives undefined
    expect(() => verbalyHandle({ locales: undefined as unknown as string[] })).toThrow(
      'virtual:verbaly',
    );
    expect(() => verbalyHandle({ locales: [] })).toThrow('@verbaly/vite');
  });

  it('is assignable to @sveltejs/kit Handle (type-level)', () => {
    const handle: Handle = verbalyHandle({ locales: LOCALES });
    expect(typeof handle).toBe('function');
  });
});

describe('switchLocale (server-side)', () => {
  it('is SSR-safe without a DOM: loads then sets, no throw', async () => {
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
    expect(calls).toEqual(['load:es', 'set:es']);
  });
});
