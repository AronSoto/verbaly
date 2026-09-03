import {
  LOCALE_STORAGE_KEY,
  localeDirection,
  resolveRequestLocale,
  stripLocalePath,
  type Routing,
} from 'verbaly';

// derived from core's localStorage key: one identity per user across channels
export const LOCALE_COOKIE: string = LOCALE_STORAGE_KEY;
const LANG_PLACEHOLDER = '%verbaly.lang%';
const DIR_PLACEHOLDER = '%verbaly.dir%';

// structural subset of @sveltejs/kit: no runtime or type dependency on kit
interface HandleEvent {
  request: Request;
  url: URL;
  cookies: { get(name: string): string | undefined };
  locals: { verbalyLocale?: string };
}
interface ResolveOptions {
  transformPageChunk?(input: { html: string; done: boolean }): string | undefined;
}
interface HandleInput {
  event: HandleEvent;
  resolve(event: HandleEvent, opts?: ResolveOptions): Response | Promise<Response>;
}

export interface VerbalyHandleOptions {
  locales: string[];
  fallback?: string;
  cookie?: string | false;
  routing?: Routing;
  base?: string;
}

// server hook: sets event.locals.verbalyLocale and fills %verbaly.lang% / %verbaly.dir%
export function verbalyHandle(options: VerbalyHandleOptions) {
  const { locales, cookie = LOCALE_COOKIE } = options;
  if (!Array.isArray(locales) || locales.length === 0) {
    throw new Error(
      "[verbaly] verbalyHandle needs `locales`: pass the `locales` export from 'virtual:verbaly' " +
        '(requires @verbaly/vite ≥0.16) or list them yourself: verbalyHandle({ locales: [...] })',
    );
  }
  const fallback = options.fallback ?? locales[0]!;

  return ({ event, resolve }: HandleInput): Response | Promise<Response> => {
    const resolved = resolveRequestLocale({
      supported: locales,
      path: event.url.pathname,
      routing: options.routing,
      base: options.base,
      cookie: cookie ? event.cookies.get(cookie) : undefined,
      header: event.request.headers.get('accept-language'),
      fallback,
    });

    event.locals.verbalyLocale = resolved;
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html
          .replaceAll(LANG_PLACEHOLDER, resolved)
          .replaceAll(DIR_PLACEHOLDER, localeDirection(resolved)),
    });
  };
}

export interface VerbalyRerouteOptions {
  locales: string[];
  base?: string;
}

// universal hook (hooks.ts, never hooks.server.ts): /es/docs routes as /docs, one route tree
export function verbalyReroute(options: VerbalyRerouteOptions) {
  const { locales } = options;
  if (!Array.isArray(locales) || locales.length === 0) {
    throw new Error(
      "[verbaly] verbalyReroute needs `locales`: pass the `locales` export from 'virtual:verbaly'",
    );
  }
  return ({ url }: { url: URL }): string =>
    stripLocalePath({ supported: locales, path: url.pathname, base: options.base });
}

// switchLocale moved to core in 0.18.0 (shared with @verbaly/nuxt): same API, re-exported
export { switchLocale } from 'verbaly';
export type { SwitchLocaleOptions } from 'verbaly';
