import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Catalog } from './catalog';
import type { ResolvedConfig } from './config';
import { collectParams, renderParamType } from './params';

export const VIRTUAL_ID = 'virtual:verbaly';

export interface RuntimeModuleOptions {
  localeImport?: (locale: string) => string;
  extraExports?: string;
  icu?: boolean;
  relative?: boolean;
  inlineCatalog?: boolean;
}

export function generateRuntimeModule(
  cfg: ResolvedConfig,
  options: RuntimeModuleOptions = {},
): string {
  const importPath = options.localeImport ?? ((locale: string) => `${VIRTUAL_ID}/locale/${locale}`);
  const others = cfg.locales.filter((locale) => locale !== cfg.sourceLocale);
  const src = JSON.stringify(cfg.sourceLocale);
  const loaders = others
    .map((locale) => `  ${JSON.stringify(locale)}: () => import('${importPath(locale)}'),`)
    .join('\n');

  // named in the import list only when a catalog uses them, so otherwise they tree-shake out
  const icu = options.icu ? ',\n  parseIcu' : '';
  const rel = options.relative ? ',\n  relativeFormatter' : '';
  const slice = options.inlineCatalog ? ',\n  inlineMessages' : '';

  return `import {
  createVerbaly,
  localeFromPath as readPath,
  localePath as writePath,
  switchLocale as runSwitch${icu}${rel}${slice},
} from 'verbaly';
import source from '${importPath(cfg.sourceLocale)}';

export const sourceLocale = ${src};
export const locales = ${JSON.stringify(cfg.locales)};
export const routing = ${JSON.stringify(cfg.routing)};

// bound to this project: the locale set, the source and the routing mode are never passed in
export function localePath(locale, options) {
  return writePath(locale, { ...options, supported: locales, sourceLocale, routing });
}

export function localeFromPath(options) {
  return readPath({ ...options, supported: locales });
}

// identity: it exists so the compiler can see keys that live in a module instead of at a call site
export function defineKeys(keys) {
  return keys;
}

// the whole switch a language control needs, in either mode: catalog or navigation, then persistence
export function switchLocale(locale, options) {
  return runSwitch(v, locale, { supported: locales, sourceLocale, routing, ...options });
}

const localeLoaders = {
${loaders}
};

// raw catalog access: SSR integrations serialize it across the client boundary
export async function loadMessages(locale) {
  if (locale === ${src}) return source;
  const loader = localeLoaders[locale];
  return loader ? (await loader()).default : {};
}

${
    options.inlineCatalog
      ? '// the slice `verbaly render` inlined here: enough for what this page shows, so nothing is fetched' +
        '\nfunction pageSlice() {' +
        '\n  const locale = readPath({ supported: locales });' +
        '\n  if (!locale || locale === sourceLocale) return undefined;' +
        '\n  const messages = inlineMessages();' +
        '\n  return messages ? { locale, messages } : undefined;' +
        '\n}\n\n'
      : ''
  }// per-request/per-instance factory (SSR): the singleton below is browser/SPA-only
export function createInstance(options) {${
    options.inlineCatalog ? '\n  const page = pageSlice();' : ''
  }
  return createVerbaly({
    locale: ${options.inlineCatalog ? `page ? page.locale : ${src}` : src},
    fallback: ${src},
    messages: ${
      options.inlineCatalog
        ? `page ? { [${src}]: source, [page.locale]: page.messages } : { [${src}]: source }`
        : `{ [${src}]: source }`
    },
    loaders: localeLoaders,${options.inlineCatalog ? '\n    partial: page ? [page.locale] : undefined,' : ''}${options.icu ? '\n    icu: parseIcu,' : ''}
    ...options,${
      options.relative
        ? '\n    // merged, not spread over: passing your own formatters must not drop this one' +
          '\n    formatters: { relative: relativeFormatter, ...options?.formatters },'
        : ''
    }
  });
}

// the no-FOUC contract in one call: fresh instance + catalog awaited before render
export async function createRequestInstance(locale) {
  const instance = createInstance({ locale });
  await instance.loadLocale(locale);
  return instance;
}

const v = createInstance();

export const verbaly = v;
export const t = v.t;

export function getLocale() {
  return v.locale;
}

export function subscribe(listener) {
  return v.subscribe(listener);
}

export async function setLocale(locale) {
  await v.loadLocale(locale);
  v.setLocale(locale);
}
${options.extraExports ?? ''}`;
}

export function generateLocaleModule(catalog: Catalog): string {
  return `export default ${JSON.stringify(catalog)};\n`;
}

export function generateDts(catalog: Catalog): string {
  const lines: string[] = [];
  for (const [key, message] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
    const params = collectParams(message);
    if (params.size === 0) {
      lines.push(`    ${JSON.stringify(key)}: never;`);
    } else {
      const fields = [...params.entries()]
        .map(([name, types]) => `${JSON.stringify(name)}: ${renderParamType(types)}`)
        .join('; ');
      lines.push(`    ${JSON.stringify(key)}: { ${fields} };`);
    }
  }

  return `// generated by verbaly: do not edit
declare module 'virtual:verbaly' {
  export interface VerbalyMessages {
${lines.join('\n')}
  }
  export type VerbalyKey = keyof VerbalyMessages & string;

  export type VerbalyKeyTree = VerbalyKey | { readonly [name: string]: VerbalyKeyTree };
  export function defineKeys<const T extends VerbalyKeyTree>(keys: T): T;

  export const verbaly: import('verbaly').Verbaly<VerbalyKey>;

  export const sourceLocale: string;
  export const locales: string[];
  export const routing: import('verbaly').Routing;
  export function localePath(
    locale: string,
    options?: { path?: string; base?: string },
  ): string;
  export function localeFromPath(options?: {
    path?: string;
    base?: string;
  }): string | undefined;
  export function loadMessages(locale: string): Promise<Record<string, string>>;
  export function createInstance(
    options?: import('verbaly').VerbalyOptions<VerbalyKey>,
  ): import('verbaly').Verbaly<VerbalyKey>;
  export function createRequestInstance(
    locale: string,
  ): Promise<import('verbaly').Verbaly<VerbalyKey>>;

  export function t<K extends VerbalyKey>(
    key: K,
    ...args: [VerbalyMessages[K]] extends [never] ? [] : [VerbalyMessages[K]]
  ): string;
  export function t(strings: TemplateStringsArray, ...values: unknown[]): string;
  export namespace t {
    export function id(
      key: string,
    ): (strings: TemplateStringsArray, ...values: unknown[]) => string;
  }

  export function setLocale(locale: string): Promise<void>;
  export function switchLocale(
    locale: string,
    options?: Omit<
      import('verbaly').SwitchLocaleOptions,
      'routing' | 'supported' | 'sourceLocale'
    >,
  ): Promise<void>;
  export function getLocale(): string;
  export function subscribe(listener: () => void): () => void;
}

declare module 'virtual:verbaly/locale/*' {
  const messages: Record<string, string>;
  export default messages;
}
`;
}

// unchanged writes are skipped: a rewritten verbaly.d.ts churns the consumer's TS server
export function writeDts(cfg: ResolvedConfig, catalog: Catalog, file?: string): void {
  file ??= join(cfg.root, 'verbaly.d.ts');
  const content = generateDts(catalog);
  try {
    if (readFileSync(file, 'utf8') === content) return;
  } catch {
    // new file
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
