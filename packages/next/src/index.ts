import type { VerbalyConfig } from '@verbaly/compiler';
import { join } from 'node:path';
import {
  GENERATED_DIR,
  generatedDir,
  writeGeneratedModules,
  type Compiler,
  type RequestOptions,
} from './codegen';
import { startWatcher } from './watch';

export type { VerbalyConfig } from '@verbaly/compiler';
export type { RequestOptions } from './codegen';

export interface NextVerbalyOptions extends VerbalyConfig {
  failOnMissing?: boolean;
  cookie?: string | false;
  fallback?: string;
}

// structural NextConfig subset — compat asserted against next's real type in tests.
// No index signatures: Next's real interfaces have none and a target index
// signature would reject them.
export interface WebpackConfigLike {
  resolve?: { alias?: Record<string, unknown>; [key: string]: unknown };
  module?: { rules?: unknown[]; [key: string]: unknown };
  plugins?: unknown[];
  [key: string]: unknown;
}

interface WebpackContextLike {
  webpack?: {
    NormalModuleReplacementPlugin: new (test: RegExp, resource: string) => unknown;
  };
}

// context param is `never` so Next's real webpack fn (specific context type) stays assignable
export type WebpackFn = (config: WebpackConfigLike, context: never) => unknown;

export interface TurbopackLike {
  resolveAlias?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

export interface NextConfigLike {
  webpack?: WebpackFn | null;
  turbopack?: TurbopackLike;
}

// constraint is `object` (not NextConfigLike) — an all-optional target would
// reject configs sharing no keys with it (TS weak-type rule)
export type NextConfigInput<C extends object> =
  | C
  | ((phase: string, context: { defaultConfig?: unknown }) => C | Promise<C>);

// next/constants values — literal to keep this module import-free of next
const DEV_PHASE = 'phase-development-server';
const BUILD_PHASE = 'phase-production-build';

const LOADER = '@verbaly/next/loader';
// compiler's SOURCE_FILE_RE (inlined: the compiler is only dynamically imported here).
// Matching happens via `condition.path` — a bare extension glob also matches Next's
// internal App Router entry and Turbopack panics reading it as a file.
const SOURCE_PATH_RE = /\.[cm]?[jt]sx?$/;

export function withVerbaly<C extends object>(
  nextConfig?: NextConfigInput<C>,
  options: NextVerbalyOptions = {},
): (phase: string, context?: { defaultConfig?: unknown }) => Promise<C> {
  const { failOnMissing, cookie, fallback, ...verbalyConfig } = options;
  const requestOptions: RequestOptions = { cookie, fallback };

  return async (phase, context = {}) => {
    const base: C =
      typeof nextConfig === 'function' ? await nextConfig(phase, context) : (nextConfig ?? ({} as C));
    const root = verbalyConfig.root ?? process.cwd();

    // production server / export: everything is bundled — no FS work, config only
    if (phase !== DEV_PHASE && phase !== BUILD_PHASE) {
      return composeConfig(base, root);
    }

    // dynamic: the compiler is ESM-only and this entry is also consumed as CJS
    const compiler: Compiler = await import('@verbaly/compiler');

    const cfg = await compiler.loadConfig(root, verbalyConfig);
    const catalogs = compiler.loadCatalogs(cfg);
    const registry = await compiler.extractProject(cfg);

    if (phase === BUILD_PHASE) {
      if (failOnMissing !== false) compiler.runBuildGate(cfg, registry);
    } else {
      const { added } = compiler.syncCatalogs(cfg, catalogs, registry);
      for (const locale of Object.keys(added)) {
        compiler.writeCatalog(cfg, locale, catalogs[locale] ?? {});
      }
      compiler.writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
      startWatcher(compiler, cfg, requestOptions);
    }

    writeGeneratedModules(compiler, cfg, catalogs, requestOptions);
    return composeConfig(base, cfg.root);
  };
}

function composeConfig<C extends object>(base: C, root: string): C {
  const runtimeModule = join(generatedDir(root), 'index.js');
  const { webpack: userWebpack, turbopack } = base as NextConfigLike;

  const rules: Record<string, unknown> = { ...turbopack?.rules };
  const verbalyRule = {
    condition: { all: [{ not: 'foreign' }, { path: SOURCE_PATH_RE }] },
    loaders: [LOADER],
  };
  const existing = rules['*'];
  rules['*'] = existing
    ? [...(Array.isArray(existing) ? existing : [existing]), verbalyRule]
    : verbalyRule;

  return {
    ...base,
    turbopack: {
      ...turbopack,
      resolveAlias: {
        ...turbopack?.resolveAlias,
        'virtual:verbaly': `./${GENERATED_DIR}/index.js`,
      },
      rules,
    },
    webpack(config: WebpackConfigLike, context: unknown) {
      // webpack 5 treats 'virtual:' as a URI scheme — resolve.alias never fires,
      // module replacement does; the alias stays as a fallback for odd setups
      const { webpack: webpackInstance } = (context ?? {}) as WebpackContextLike;
      if (webpackInstance?.NormalModuleReplacementPlugin) {
        config.plugins ??= [];
        config.plugins.push(
          new webpackInstance.NormalModuleReplacementPlugin(/^virtual:verbaly$/, runtimeModule),
        );
      }
      config.resolve ??= {};
      config.resolve.alias ??= {};
      (config.resolve.alias as Record<string, unknown>)['virtual:verbaly'] = runtimeModule;
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.push({
        test: /\.[cm]?[jt]sx?$/,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: LOADER }],
      });
      return userWebpack ? userWebpack(config, context as never) : config;
    },
  } as C;
}
