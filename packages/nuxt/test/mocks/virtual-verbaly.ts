import { createVerbaly, type Verbaly, type VerbalyOptions } from 'verbaly';

export const sourceLocale = 'en';
export const locales = ['en', 'es', 'pt'];
export const loadedLocales: string[] = [];

const TARGETS: Record<string, Record<string, string>> = {
  es: { greet: 'Hola' },
  pt: { greet: 'Olá' },
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
