import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RichLink, Routing, TrailingSlash } from 'verbaly';
import { stripBom } from '../util/text';
import { defaultTypesPath, detectHost, type Host } from './host';
import { warnOnce } from '../util/warn';
import type { TranslateProvider } from '../exchange/translate';

// a term maps to how it must come out: one rendering for every locale, or one per locale
export type GlossaryEntry = string | Record<string, string>;

// the extensions extract reads, shared by the default include and every pattern we suggest
export const SOURCE_EXTENSIONS = '{js,jsx,ts,tsx,mjs,mts,svelte,vue,astro}';
// the files a build hands to the transform: every extension above, and cjs and cts besides
export const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/;

// what verbaly pseudo writes by default, so discovery never takes it for a real language
export const PSEUDO_LOCALE = 'en-XA';

export interface TranslateConfig {
  provider?: 'claude' | TranslateProvider;
  model?: string;
  batchSize?: number;
  concurrency?: number;
  retries?: number;
  instructions?: string;
  glossary?: Record<string, GlossaryEntry>;
}

export interface RedirectConfig {
  on?: 'root' | 'all';
  storageKey?: string | false;
}

export interface BundleConfig {
  exclude?: string[];
}

export interface RenderConfig {
  links?: Record<string, RichLink>;
  exclude?: string[];
  site?: string;
  attribute?: string;
  base?: string;
  baseUrl?: string;
  hreflang?: boolean;
  sitemap?: boolean | string;
  redirect?: boolean | RedirectConfig;
  clean?: boolean;
  inlineCatalog?: boolean;
}

export interface VerbalyConfig {
  root?: string;
  dir?: string;
  sourceLocale?: string;
  locales?: string[];
  routing?: Routing;
  icu?: boolean;
  relative?: boolean;
  include?: string[];
  exclude?: string[];
  dts?: string | false;
  translate?: TranslateConfig;
  render?: RenderConfig;
  bundle?: BundleConfig;
  trailingSlash?: TrailingSlash;
}

export interface ResolvedConfig {
  root: string;
  dir: string;
  sourceLocale: string;
  locales: string[];
  localesDeclared: boolean;
  routing: Routing;
  icu: boolean | undefined;
  relative: boolean | undefined;
  include: string[];
  exclude: string[];
  dts: string | false;
  translate: TranslateConfig;
  render: RenderConfig;
  bundle: BundleConfig;
  host: Host | undefined;
  trailingSlash: TrailingSlash | undefined;
}

export function resolveConfig(config: VerbalyConfig = {}): ResolvedConfig {
  const root = resolve(config.root ?? process.cwd());
  const dir = resolve(root, config.dir ?? 'locales');
  const sourceLocale = config.sourceLocale ?? 'en';
  const host = detectHost(root)?.name;

  const localesDeclared = config.locales !== undefined;
  // a json or js config has no types to stop it: "es" is the list of one it means, not its letters
  const written: unknown = config.locales;
  const listed = typeof written === 'string' ? [written] : (config.locales ?? []);
  const locales = new Set<string>([sourceLocale, ...listed]);
  // a declared list is the list: discovery is for a project that never wrote one down
  if (!localesDeclared && existsSync(dir)) {
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
    localesDeclared,
    // the mode follows the surface: render is what builds a url tree per locale, so it is the tell
    routing: config.routing ?? (config.render ? 'prefix-except-source' : 'no-prefix'),
    // the catalogs decide on their own; these only force it for messages that land after the build
    icu: config.icu,
    relative: config.relative,
    locales: [...locales],
    include: config.include ?? [`{src,app}/**/*.${SOURCE_EXTENSIONS}`],
    exclude: config.exclude ?? ['**/node_modules/**', '**/dist/**'],
    // decided once here, so every writer and doctor look in the same place
    dts:
      typeof config.dts === 'string'
        ? resolve(root, config.dts)
        : config.dts === false
          ? false
          : defaultTypesPath(root, host),
    translate: config.translate ?? {},
    render: config.render ?? {},
    bundle: config.bundle ?? {},
    host,
    trailingSlash: config.trailingSlash,
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
  const name = findConfigFile(root);
  if (!name) return {};
  const path = join(root, name);
  if (name.endsWith('.json')) return readJsonConfig(path);
  if (name.endsWith('ts')) return loadTsConfig(path);
  // Node caches a module by url: without the mtime, a long-lived process keeps the old config
  const url = `${pathToFileURL(path).href}?mtime=${statSync(path).mtimeMs}`;
  // a CommonJS config is cached by file name, which no query reaches: the real one, or as given
  const cache = createRequire(import.meta.url).cache;
  delete cache[realpathSync(path)];
  // the name as given is the key under --preserve-symlinks
  delete cache[resolve(path)];
  const mod = (await import(url)) as { default?: VerbalyConfig };
  return mod.default ?? {};
}

// same BOM rule as a catalog, and a parse error that names the file it came from
function readJsonConfig(path: string): VerbalyConfig {
  const content = readFileSync(path, 'utf8');
  const body = stripBom(content);
  try {
    return JSON.parse(body) as VerbalyConfig;
  } catch (error) {
    throw new Error(`[verbaly] ${path} is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

// jiti reads TypeScript and extensionless imports like a bundler, and installs no build script
async function loadTsConfig(path: string): Promise<VerbalyConfig> {
  const { createJiti } = await import('jiti');
  // no caches: nothing is written to disk, and a dev server reads an edited config and its imports
  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: false,
    interopDefault: false,
  });
  const mod = await jiti.import<VerbalyConfig & { default?: VerbalyConfig; __esModule?: true }>(
    path,
  );
  // an ES module without a default export holds no config; module.exports is the config itself
  return mod.__esModule ? (mod.default ?? {}) : mod;
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
  from: { plugin?: boolean } = {},
): Promise<ResolvedConfig> {
  const fileConfig = await loadConfigFile(root);
  if (from.plugin) warnPluginOnly(root, fileConfig, overrides);
  return resolveConfig({ ...fileConfig, ...definedOnly(overrides), root });
}

// what verbaly check and extract read: set only in a plugin, the build and the CLI disagree
const READ_BY_CLI = ['sourceLocale', 'locales', 'dir', 'include', 'exclude'] as const;

// per project root, the options only the plugin sets: what the build report points check at
const pluginOnly = new Map<string, string>();

// '' when the build and verbaly check read the same options, else the names that differ
export function pluginOnlyOptions(root: string): string {
  return pluginOnly.get(root) ?? '';
}

function warnPluginOnly(root: string, file: VerbalyConfig, overrides: VerbalyConfig): void {
  // resolved on both sides: a default or a path written another way is what the CLI reads too
  const cli = resolveConfig({ ...file, root });
  const build = resolveConfig({ ...file, ...definedOnly(overrides), root });
  const keys = READ_BY_CLI.filter(
    (key) =>
      overrides[key] !== undefined && JSON.stringify(cli[key]) !== JSON.stringify(build[key]),
  );
  if (keys.length === 0) {
    pluginOnly.delete(cli.root);
    return;
  }
  const names = keys.length > 1 ? `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}` : keys[0]!;
  pluginOnly.set(cli.root, names);
  const [verb, pronoun] = keys.length > 1 ? ['are', 'them'] : ['is', 'it'];
  warnOnce(
    `${names} ${verb} set in the plugin options, which \`verbaly check\` and \`verbaly extract\` ` +
      `never read: move ${pronoun} to verbaly.config so the command line checks what the build ships`,
    `plugin-only:${root}`,
  );
}

function definedOnly(config: VerbalyConfig): VerbalyConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as VerbalyConfig;
}
