import type { PluginOptions } from '@verbaly/compiler';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  GENERATED_DIR,
  generatedDir,
  syncAndWrite,
  writeGeneratedModules,
  type Compiler,
  type RequestOptions,
} from './codegen';
import type { LoaderOptions } from './loader';
import { startWatcher } from './watch';

export type { VerbalyConfig } from '@verbaly/compiler';
export type { RequestOptions } from './codegen';

export interface NextVerbalyOptions extends PluginOptions {
  cookie?: string | false;
  fallback?: string;
}

// structural NextConfig subset (compat asserted in tests): no index signatures, Next has none
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

// metadata is `never` for the same reason as the webpack context: Next's own type stays assignable
export interface CompilerLike {
  runAfterProductionCompile?: (metadata: never) => Promise<void>;
}

export interface NextConfigLike {
  webpack?: WebpackFn | null;
  turbopack?: TurbopackLike;
  compiler?: CompilerLike;
}

// constraint is object, not NextConfigLike: an all-optional target rejects by weak-type
export type NextConfigInput<C extends object> =
  C | ((phase: string, context: { defaultConfig?: unknown }) => C | Promise<C>);

// next/constants values: literal to keep this module import-free of next
const DEV_PHASE = 'phase-development-server';
const BUILD_PHASE = 'phase-production-build';
// next experimental-analyze compiles the app as well, so it needs the generated modules on disk
const ANALYZE_PHASE = 'phase-analyze';

const LOADER = '@verbaly/next/loader';
// matched via condition.path: a bare extension glob also hits Next's App Router entry
const SOURCE_PATH_RE = /\.[cm]?[jt]sx?$/;

export function withVerbaly<C extends object>(
  nextConfig?: NextConfigInput<C>,
  options: NextVerbalyOptions = {},
): (phase: string, context?: { defaultConfig?: unknown }) => Promise<C> {
  const { failOnMissing, cookie, fallback, ...verbalyConfig } = options;
  const requestOptions: RequestOptions = { cookie, fallback };

  return async (phase, context = {}) => {
    const base: C =
      typeof nextConfig === 'function'
        ? await nextConfig(phase, context)
        : (nextConfig ?? ({} as C));
    const root = verbalyConfig.root ?? process.cwd();

    // production server / export: everything is bundled, so no FS work, config only
    if (phase !== DEV_PHASE && phase !== BUILD_PHASE && phase !== ANALYZE_PHASE) {
      return composeConfig(base, root);
    }

    // dynamic: the compiler is ESM-only and this entry is also consumed as CJS
    const compiler: Compiler = await import('@verbaly/compiler');

    const cfg = await compiler.loadConfig(root, verbalyConfig);
    const catalogs = compiler.loadCatalogs(cfg);
    const registry = await compiler.extractProject(cfg);
    let gate: (() => void) | undefined;

    if (phase === DEV_PHASE) {
      const texts = await syncAndWrite(compiler, cfg, catalogs, registry, requestOptions);
      startWatcher(compiler, cfg, requestOptions, texts);
    } else {
      // the code's text ships, as it does in dev: a catalog edit of a text it owns never wins
      compiler.syncCatalogs(cfg, catalogs, registry);
      writeGeneratedModules(compiler, cfg, catalogs, requestOptions);
      if (phase === BUILD_PHASE) {
        const runGate = (): void => compiler.runBuildGate(cfg, registry, failOnMissing);
        // typegen loads this config in the build phase too, and only a real build runs the hook
        if (hasAfterCompileHook(cfg.root)) gate = runGate;
        else runGate();
      }
    }

    // the loader rewrites exactly what extract reads: a file outside include keeps its t`…`
    const scope: LoaderOptions = { root: cfg.root, include: cfg.include, exclude: cfg.exclude };
    return composeConfig(base, cfg.root, scope, gate);
  };
}

const HOOK_FILE = 'next/dist/build/after-production-compile.js';

// next build calls compiler.runAfterProductionCompile since 15.4; NODE_PATH may name another next
function hasAfterCompileHook(root: string): boolean {
  for (let dir = root; ; dir = dirname(dir)) {
    const next = join(dir, 'node_modules', 'next');
    if (existsSync(join(next, 'package.json')))
      return existsSync(join(dir, 'node_modules', HOOK_FILE));
    if (dirname(dir) === dir) break;
  }
  // Yarn PnP has no node_modules, and its resolver finds the project's own next, never NODE_PATH's
  if (!process.versions.pnp) return false;
  try {
    createRequire(join(root, 'package.json')).resolve(HOOK_FILE);
    return true;
  } catch {
    return false;
  }
}

function composeConfig<C extends object>(
  base: C,
  root: string,
  scope?: LoaderOptions,
  gate?: () => void,
): C {
  const runtimeModule = join(generatedDir(root), 'index.js');
  const { webpack: userWebpack, turbopack, compiler: userCompiler } = base as NextConfigLike;
  const loader = scope ? { loader: LOADER, options: scope } : LOADER;

  const rules: Record<string, unknown> = { ...turbopack?.rules };
  const verbalyRule = {
    condition: { all: [{ not: 'foreign' }, { path: SOURCE_PATH_RE }] },
    loaders: [loader],
  };
  const existing = rules['*'];
  rules['*'] = existing
    ? [...(Array.isArray(existing) ? existing : [existing]), verbalyRule]
    : verbalyRule;

  return {
    ...base,
    ...(gate && {
      compiler: {
        ...userCompiler,
        // after the compile, so next typegen, which loads this config too, never meets the gate
        async runAfterProductionCompile(metadata: never) {
          await userCompiler?.runAfterProductionCompile?.(metadata);
          try {
            gate();
          } catch (error) {
            // Next prints a failed hook twice: the report goes out once, and the throw stays short
            console.error((error as Error).message);
            // eslint-disable-next-line preserve-caught-error -- a cause would print the report again
            throw new Error('[verbaly] build blocked, the reason is printed above');
          }
        },
      },
    }),
    turbopack: {
      ...turbopack,
      resolveAlias: {
        ...turbopack?.resolveAlias,
        'virtual:verbaly': `./${GENERATED_DIR}/index.js`,
      },
      rules,
    },
    webpack(config: WebpackConfigLike, context: unknown) {
      // webpack 5 parses 'virtual:' as a URI scheme, so resolve.alias never fires
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
        test: SOURCE_PATH_RE,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [typeof loader === 'string' ? { loader } : loader],
      });
      return userWebpack ? userWebpack(config, context as never) : config;
    },
  } as C;
}
