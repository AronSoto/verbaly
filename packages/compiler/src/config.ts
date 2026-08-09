import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RichLink } from 'verbaly';
import { PSEUDO_LOCALE } from './pseudo';
import type { TranslateProvider } from './translate';

export interface TranslateConfig {
  provider?: 'claude' | TranslateProvider;
  model?: string;
  batchSize?: number;
}

export interface RedirectConfig {
  on?: 'root' | 'all';
  storageKey?: string | false;
}

export interface RenderConfig {
  links?: Record<string, RichLink>;
  site?: string;
  attribute?: string;
  base?: string;
  baseUrl?: string;
  hreflang?: boolean;
  sitemap?: boolean | string;
  redirect?: boolean | RedirectConfig;
  clean?: boolean;
}

export interface VerbalyConfig {
  root?: string;
  dir?: string;
  sourceLocale?: string;
  locales?: string[];
  include?: string[];
  exclude?: string[];
  dts?: string | false;
  translate?: TranslateConfig;
  render?: RenderConfig;
}

export interface ResolvedConfig {
  root: string;
  dir: string;
  sourceLocale: string;
  locales: string[];
  include: string[];
  exclude: string[];
  dts: string | false | undefined;
  translate: TranslateConfig;
  render: RenderConfig;
}

export function resolveConfig(config: VerbalyConfig = {}): ResolvedConfig {
  const root = resolve(config.root ?? process.cwd());
  const dir = resolve(root, config.dir ?? 'locales');
  const sourceLocale = config.sourceLocale ?? 'en';

  const locales = new Set<string>([sourceLocale, ...(config.locales ?? [])]);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json') && !file.startsWith('.') && file !== `${PSEUDO_LOCALE}.json`) {
        locales.add(file.slice(0, -5));
      }
    }
  }

  return {
    root,
    dir,
    sourceLocale,
    locales: [...locales],
    include: config.include ?? ['{src,app}/**/*.{js,jsx,ts,tsx,mjs,mts,svelte,vue,astro}'],
    exclude: config.exclude ?? ['**/node_modules/**', '**/dist/**'],
    dts: typeof config.dts === 'string' ? resolve(root, config.dts) : config.dts,
    translate: config.translate ?? {},
    render: config.render ?? {},
  };
}

const CONFIG_FILES = [
  'verbaly.config.js',
  'verbaly.config.mjs',
  'verbaly.config.ts',
  'verbaly.config.mts',
  'verbaly.config.json',
];

export function findConfigFile(root: string): string | undefined {
  return CONFIG_FILES.find((name) => existsSync(join(root, name)));
}

export async function loadConfigFile(root: string): Promise<VerbalyConfig> {
  for (const name of ['verbaly.config.js', 'verbaly.config.mjs']) {
    const path = join(root, name);
    if (existsSync(path)) {
      const mod = (await import(pathToFileURL(path).href)) as { default?: VerbalyConfig };
      return mod.default ?? {};
    }
  }
  for (const name of ['verbaly.config.ts', 'verbaly.config.mts']) {
    const path = join(root, name);
    if (existsSync(path)) return loadTsConfig(path);
  }
  const jsonPath = join(root, 'verbaly.config.json');
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, 'utf8')) as VerbalyConfig;
  }
  return {};
}

async function loadTsConfig(path: string): Promise<VerbalyConfig> {
  try {
    const { bundleRequire } = await import('bundle-require');
    const { mod } = await bundleRequire<{ default?: VerbalyConfig }>({ filepath: path });
    return mod.default ?? {};
  } catch (error) {
    if (isModuleNotFound(error, 'esbuild')) {
      throw new Error(`[verbaly] ${path} needs esbuild: install it with pnpm add -D esbuild`, {
        cause: error,
      });
    }
    throw error;
  }
}

export function isModuleNotFound(error: unknown, name: string): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes(name)
  );
}

// non-source locales a command may write to (optional CLI override, always config-bounded)
export function targetLocales(cfg: ResolvedConfig, override?: string[]): string[] {
  return (override ?? cfg.locales).filter(
    (locale) => locale !== cfg.sourceLocale && cfg.locales.includes(locale),
  );
}

// file config + inline overrides
export async function loadConfig(
  root: string,
  overrides: VerbalyConfig = {},
): Promise<ResolvedConfig> {
  const fileConfig = await loadConfigFile(root);
  return resolveConfig({ ...fileConfig, ...definedOnly(overrides), root });
}

function definedOnly(config: VerbalyConfig): VerbalyConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as VerbalyConfig;
}
