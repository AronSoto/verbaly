import { LOCALE_STORAGE_KEY, resolveRequestLocale } from 'verbaly';
import type { Verbaly } from 'verbaly';

// derived from core's localStorage key — one identity per user across channels
export const LOCALE_COOKIE: string = LOCALE_STORAGE_KEY;
const LANG_PLACEHOLDER = '%verbaly.lang%';
const YEAR = 31536000;

// structural subset of @sveltejs/kit — no runtime or type dependency on kit
interface HandleEvent {
  request: Request;
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
  /** supported locales — pass `locales` from 'virtual:verbaly' */
  locales: string[];
  /** default when nothing matches (defaults to the first locale) */
  fallback?: string;
  /** cookie read for the user's choice; `false` = Accept-Language only */
  cookie?: string | false;
}

// server hook: cookie → Accept-Language → fallback, per request.
// Sets event.locals.verbalyLocale and fills %verbaly.lang% in app.html.
export function verbalyHandle(options: VerbalyHandleOptions) {
  const { locales, cookie = LOCALE_COOKIE } = options;
  if (!Array.isArray(locales) || locales.length === 0) {
    throw new Error(
      "[verbaly] verbalyHandle needs `locales` — pass the `locales` export from 'virtual:verbaly' " +
        '(requires @verbaly/vite ≥0.16) or list them yourself: verbalyHandle({ locales: [...] })',
    );
  }
  const fallback = options.fallback ?? locales[0]!;

  return ({ event, resolve }: HandleInput): Response | Promise<Response> => {
    const resolved = resolveRequestLocale({
      supported: locales,
      cookie: cookie ? event.cookies.get(cookie) : undefined,
      header: event.request.headers.get('accept-language'),
      fallback,
    });

    event.locals.verbalyLocale = resolved;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replaceAll(LANG_PLACEHOLDER, resolved),
    });
  };
}

export interface SwitchLocaleOptions {
  /** cookie written so the next SSR request matches; `false` = don't persist */
  cookie?: string | false;
  /** cookie lifetime in seconds (default 1 year) */
  maxAge?: number;
}

// client-side switch: catalog first (no flash), then locale, then persistence
export async function switchLocale(
  instance: Pick<Verbaly, 'loadLocale' | 'setLocale'>,
  locale: string,
  options: SwitchLocaleOptions = {},
): Promise<void> {
  const { cookie = LOCALE_COOKIE, maxAge = YEAR } = options;
  await instance.loadLocale(locale);
  instance.setLocale(locale);
  if (typeof document === 'undefined') return; // SSR-safe no-op
  if (cookie) {
    document.cookie = `${cookie}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  document.documentElement.lang = locale;
}
