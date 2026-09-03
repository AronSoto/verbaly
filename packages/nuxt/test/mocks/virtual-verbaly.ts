import { createVerbaly, type Routing, type Verbaly, type VerbalyOptions } from 'verbaly';

export const sourceLocale = 'en';
export const locales = ['en', 'es', 'pt', 'ar'];
export const loadedLocales: string[] = [];

// live binding: the plugin reads it per call, so a test can pick the mode it is exercising
export let routing: Routing = 'no-prefix';

export function setRouting(next: Routing): void {
  routing = next;
}

const TARGETS: Record<string, Record<string, string>> = {
  es: { greet: 'Hola' },
  pt: { greet: 'Olá' },
  ar: { greet: 'مرحبا' },
};

export function createInstance(options: VerbalyOptions = {}): Verbaly {
  return createVerbaly({
    locale: sourceLocale,
    fallback: sourceLocale,
    messages: { en: { greet: 'Hello' } },
    loaders: {
      es: () => {
        loadedLocales.push('es');
        return Promise.resolve(TARGETS['es']!);
      },
      pt: () => {
        loadedLocales.push('pt');
        return Promise.resolve(TARGETS['pt']!);
      },
      ar: () => {
        loadedLocales.push('ar');
        return Promise.resolve(TARGETS['ar']!);
      },
    },
    ...options,
  });
}

// the no-FOUC contract in one call, exactly like the generated module
export async function createRequestInstance(locale: string): Promise<Verbaly> {
  const instance = createInstance({ locale });
  await instance.loadLocale(locale);
  return instance;
}
