import { loadCatalogs, loadConfig, writeDts } from '@verbaly/compiler';
import verbalyVite, { type ViteVerbalyOptions } from '@verbaly/vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type { ViteVerbalyOptions } from '@verbaly/vite';

export interface VerbalyNuxtOptions extends ViteVerbalyOptions {
  cookie?: string | false;
  fallback?: string;
}

// structural subset of Nuxt: no runtime or type dependency on nuxt/@nuxt/kit
interface ViteConfigLike {
  plugins?: unknown[];
}
interface PrepareTypesLike {
  references: Array<{ path: string } | { types: string }>;
}
export interface NuxtLike {
  options: {
    rootDir: string;
    buildDir: string;
    plugins: unknown[];
    build: { transpile: unknown[] };
    runtimeConfig: { public: Record<string, unknown> };
    verbaly?: VerbalyNuxtOptions;
  };
  hook(name: 'vite:extendConfig', fn: (config: ViteConfigLike) => void): void;
  hook(name: 'prepare:types', fn: (options: PrepareTypesLike) => Promise<void>): void;
}

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), 'runtime');

// plain-function Nuxt module: configKey `verbaly`, inline options win
function verbalyModule(inlineOptions: VerbalyNuxtOptions | undefined, nuxt: NuxtLike): void {
  const { cookie, fallback, ...vite } = { ...nuxt.options.verbaly, ...inlineOptions };

  // negotiation options ride runtimeConfig to the runtime plugin
  nuxt.options.runtimeConfig.public.verbaly = {
    ...(cookie !== undefined && { cookie }),
    ...(fallback !== undefined && { fallback }),
  };

  // types go to Nuxt's own slot (.nuxt/), set before the hooks fire so dev keeps it fresh
  vite.dts ??= join(nuxt.options.buildDir, 'verbaly.d.ts');

  // fresh plugin per Vite build (client and server must not share state), root pinned to rootDir
  nuxt.hook('vite:extendConfig', (config) => {
    (config.plugins ??= []).push(verbalyVite({ root: nuxt.options.rootDir, ...vite }));
  });

  // the file must exist when the reference lands in .nuxt/nuxt.d.ts or TS reports it missing
  nuxt.hook('prepare:types', async ({ references }) => {
    const cfg = await loadConfig(nuxt.options.rootDir, vite);
    if (cfg.dts === false) return;
    const file = cfg.dts ?? join(cfg.root, 'verbaly.d.ts');
    writeDts(cfg, loadCatalogs(cfg)[cfg.sourceLocale] ?? {}, file);
    references.push({ path: file });
  });

  nuxt.options.build.transpile.push(runtimeDir);
  // prepend: the instance must exist before app plugins and components run
  nuxt.options.plugins.unshift(join(runtimeDir, 'plugin.js'));
}

verbalyModule.meta = { name: '@verbaly/nuxt', configKey: 'verbaly' };

// getOptions is the anchor Nuxt's config typing infers from: the call signature alone degrades it
verbalyModule.getOptions = async (
  inlineOptions?: Partial<VerbalyNuxtOptions>,
  nuxt?: NuxtLike,
): Promise<VerbalyNuxtOptions> => ({ ...nuxt?.options.verbaly, ...inlineOptions });

export default verbalyModule;
