import { cookies, headers } from 'next/headers';
import * as React from 'react';
import {
  alternateLinks,
  localeFromPath,
  LOCALE_STORAGE_KEY,
  resolveRequestLocale,
  warnOnce,
  type AlternateLink,
  type TFunction,
  type Verbaly,
} from 'verbaly';
import {
  createRequestInstance,
  loadMessages,
  locales,
  requestOptions,
  routing,
  sourceLocale,
} from 'virtual:verbaly';

interface RequestState {
  locale: string;
  instance: Verbaly;
}

// React.cache = per-request dedupe in RSC; identity fallback keeps plain-node tests runnable
const perRequest: <T extends (...args: never[]) => unknown>(fn: T) => T =
  (React as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

interface LocaleHolder {
  locale?: string;
}

const scopedHolder = perRequest((): LocaleHolder => ({}));
const moduleHolder: LocaleHolder = {};

// React.cache only holds inside a request, and outside one there is a single request to hold for
function holder(): LocaleHolder {
  const scoped = scopedHolder();
  return scoped === scopedHolder() ? scoped : moduleHolder;
}

// call it from the layout with the [locale] segment: reading headers() kills static rendering
export function setRequestLocale(locale: string): void {
  holder().locale = locale;
}

// a route segment is a url segment, so it narrows like one: a slug must never become a locale
function declaredLocale(): string | undefined {
  const raw = holder().locale;
  if (raw === undefined) return undefined;
  const match = localeFromPath({ supported: locales, path: `/${raw}` });
  if (match) return match;
  warnOnce(`setRequestLocale was given a locale the project does not have, so it was ignored`);
  return undefined;
}

// only reached when no segment declared it: this read is what opts a route out of static
async function negotiate(): Promise<string> {
  const cookieName = requestOptions?.cookie ?? LOCALE_STORAGE_KEY;
  const headerStore = await headers();
  const cookieValue = cookieName === false ? undefined : (await cookies()).get(cookieName)?.value;
  return resolveRequestLocale({
    supported: locales,
    routing,
    cookie: cookieValue,
    header: headerStore.get('accept-language'),
    fallback: requestOptions?.fallback ?? sourceLocale,
  });
}

const getRequestState = perRequest(async (): Promise<RequestState> => {
  const locale = declaredLocale() ?? (await negotiate());
  return { locale, instance: await createRequestInstance(locale) };
});

export interface AlternatesOptions {
  path: string;
  baseUrl?: string;
}

// the hreflang set for generateMetadata, in the shape Next's alternates field takes
export function getAlternates(options: AlternatesOptions): {
  canonical?: string;
  languages: Record<string, string>;
} {
  const links: AlternateLink[] = alternateLinks({
    supported: locales,
    sourceLocale,
    routing,
    path: options.path,
    baseUrl: options.baseUrl,
  });
  const languages: Record<string, string> = {};
  for (const link of links) languages[link.hreflang] = link.href;
  const self = localeFromPath({ supported: locales, path: options.path }) ?? sourceLocale;
  return { canonical: languages[self], languages };
}

// request-scoped instance: never the virtual:verbaly singleton (locale would leak between requests)
export async function getVerbaly(): Promise<Verbaly> {
  return (await getRequestState()).instance;
}

export async function getT(): Promise<TFunction> {
  return (await getRequestState()).instance.t;
}

export async function getRequestLocale(): Promise<string> {
  return (await getRequestState()).locale;
}

export interface VerbalyProviderProps {
  locale: string;
  messages?: Record<string, string>;
}

// messages omitted for the source locale: it already ships inline in the client bundle
export async function getVerbalyProps(): Promise<VerbalyProviderProps> {
  const { locale } = await getRequestState();
  if (locale === sourceLocale) return { locale };
  return { locale, messages: await loadMessages(locale) };
}
