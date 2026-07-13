import { cookies, headers } from 'next/headers';
import * as React from 'react';
import {
  LOCALE_STORAGE_KEY,
  resolveRequestLocale,
  type TFunction,
  type Verbaly,
} from 'verbaly';
import {
  createRequestInstance,
  loadMessages,
  locales,
  requestOptions,
  sourceLocale,
} from 'virtual:verbaly';

interface RequestState {
  locale: string;
  instance: Verbaly;
}

// React.cache = per-request dedupe in RSC; identity fallback keeps plain-node tests runnable
const perRequest: <T extends () => Promise<RequestState>>(fn: T) => T =
  (React as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

const getRequestState = perRequest(async (): Promise<RequestState> => {
  const cookieName = requestOptions?.cookie ?? LOCALE_STORAGE_KEY;
  const headerStore = await headers();
  const cookieValue =
    cookieName === false ? undefined : (await cookies()).get(cookieName)?.value;
  const locale = resolveRequestLocale({
    supported: locales,
    cookie: cookieValue,
    header: headerStore.get('accept-language'),
    fallback: requestOptions?.fallback ?? sourceLocale,
  });
  return { locale, instance: await createRequestInstance(locale) };
});

// request-scoped instance — never the virtual:verbaly singleton (locale would leak between requests)
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

// serializable props for <VerbalyProvider> — messages omitted when locale is the
// source locale (it ships inline in the client bundle already)
export async function getVerbalyProps(): Promise<VerbalyProviderProps> {
  const { locale } = await getRequestState();
  if (locale === sourceLocale) return { locale };
  return { locale, messages: await loadMessages(locale) };
}
