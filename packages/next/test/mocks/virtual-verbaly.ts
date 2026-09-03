import { createVerbaly, type Routing, type Verbaly, type VerbalyOptions } from 'verbaly';

export const sourceLocale = 'en';
export const locales = ['en', 'es'];

// mutable so tests can vary the module options
export const requestOptions: { cookie?: string | false; fallback?: string } = {};

// live binding: the server reads it per call, so a test can pick the mode it is exercising
export let routing: Routing = 'no-prefix';

export function setRouting(next: Routing): void {
  routing = next;
}

const en = { greeting: 'Hello', farewell: 'Bye' };
const es = { greeting: 'Hola', farewell: 'Chau' };
const catalogs: Record<string, Record<string, string>> = { en, es };

export async function loadMessages(locale: string): Promise<Record<string, string>> {
  return catalogs[locale] ?? {};
}

export function createInstance(options?: VerbalyOptions): Verbaly {
  return createVerbaly({
    locale: sourceLocale,
    fallback: sourceLocale,
    messages: { en },
    loaders: { es: () => Promise.resolve({ default: es }) },
    ...options,
  });
}

export async function createRequestInstance(locale: string): Promise<Verbaly> {
  const instance = createInstance({ locale });
  await instance.loadLocale(locale);
  return instance;
}
