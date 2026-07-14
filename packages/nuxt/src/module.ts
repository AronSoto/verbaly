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
export interface NuxtLike {
  options: {
    rootDir: string;
    plugins: unknown[];
    build: { transpile: unknown[] };
    runtimeConfig: { public: Record<string, unknown> };
    verbaly?: VerbalyNuxtOptions;
  };
  hook(name: 'vite:extendConfig', fn: (config: ViteConfigLike) => void): void;
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

  // fresh plugin instance per Vite build: client and server builds never share state.
  // root pinned to the project dir: Nuxt's Vite root is srcDir (app/), where no verbaly.config lives
  nuxt.hook('vite:extendConfig', (config) => {
    (config.plugins ??= []).push(verbalyVite({ root: nuxt.options.rootDir, ...vite }));
  });

  nuxt.options.build.transpile.push(runtimeDir);
  // prepend: the instance must exist before app plugins and components run
  nuxt.options.plugins.unshift(join(runtimeDir, 'plugin.js'));
}

verbalyModule.meta = { name: '@verbaly/nuxt', configKey: 'verbaly' };

// same merge as the body; also the anchor Nuxt's generated nuxt.config typing infers the
// options type from (the plain call signature alone degrades the inference to Record)
verbalyModule.getOptions = async (
  inlineOptions?: Partial<VerbalyNuxtOptions>,
  nuxt?: NuxtLike,
): Promise<VerbalyNuxtOptions> => ({ ...nuxt?.options.verbaly, ...inlineOptions });

export default verbalyModule;
