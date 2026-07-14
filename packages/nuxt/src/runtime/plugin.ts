import { defineNuxtPlugin, useHead, useRuntimeConfig, useState } from '#imports';
import { verbalyPlugin, type VerbalyPlugin } from '@verbaly/vue';
import { LOCALE_STORAGE_KEY, resolveRequestLocale } from 'verbaly';
import { createRequestInstance, locales, sourceLocale } from 'virtual:verbaly';
import { shallowRef } from 'vue';

interface VerbalyRuntimeConfig {
  cookie?: string | false;
  fallback?: string;
}

// structural subset of NuxtApp: the real one arrives at runtime
interface NuxtAppLike {
  vueApp: { use(plugin: VerbalyPlugin): unknown };
  ssrContext?: { event?: { headers?: { get(name: string): string | null } } };
}

// one cookie value out of a Cookie header / document.cookie
function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export default defineNuxtPlugin(async (nuxtApp: NuxtAppLike) => {
  if (!Array.isArray(locales) || locales.length === 0) {
    throw new Error(
      "[verbaly] no `locales` in 'virtual:verbaly': declare them in verbaly.config " +
        'or in the module options (`verbaly: { locales: [...] }` in nuxt.config)',
    );
  }
  const config = (useRuntimeConfig().public.verbaly ?? {}) as VerbalyRuntimeConfig;
  const cookieName = config.cookie === false ? false : config.cookie || LOCALE_STORAGE_KEY;
  const fallback = config.fallback ?? sourceLocale;

  // negotiated on the server, hydrated from the payload: the client renders the same locale
  const locale = useState<string>('verbaly:locale', () => {
    const headers = nuxtApp.ssrContext?.event?.headers;
    if (headers) {
      return resolveRequestLocale({
        supported: locales,
        cookie: cookieName ? readCookie(headers.get('cookie'), cookieName) : undefined,
        header: headers.get('accept-language'),
        fallback,
      });
    }
    // client-only app (ssr: false): cookie → navigator.languages → fallback
    return resolveRequestLocale({
      supported: locales,
      cookie:
        cookieName && typeof document !== 'undefined'
          ? readCookie(document.cookie, cookieName)
          : undefined,
      header:
        typeof navigator !== 'undefined'
          ? (navigator.languages?.join(',') ?? navigator.language)
          : undefined,
      fallback,
    });
  });

  // fresh instance per request, catalog awaited BEFORE render: the no-FOUC contract
  const instance = await createRequestInstance(locale.value);
  nuxtApp.vueApp.use(verbalyPlugin(instance));

  // <html lang> follows the live locale
  const lang = shallowRef(instance.locale);
  instance.subscribe(() => {
    lang.value = instance.locale;
  });
  useHead({ htmlAttrs: { lang } });
});
