import type { NuxtModule } from '@nuxt/schema';
import { describe, expect, it } from 'vitest';
import verbalyModule, { type VerbalyNuxtOptions } from '../src/module';

interface ViteConfigCapture {
  plugins?: unknown[];
}

function makeNuxt(configOptions?: VerbalyNuxtOptions) {
  const hooks = new Map<string, (config: ViteConfigCapture) => void>();
  const nuxt = {
    options: {
      rootDir: '/srv/app',
      plugins: ['app-plugin.ts'] as unknown[],
      build: { transpile: [] as unknown[] },
      runtimeConfig: { public: {} as Record<string, unknown> },
      ...(configOptions ? { verbaly: configOptions } : {}),
    },
    hook(name: 'vite:extendConfig', fn: (config: ViteConfigCapture) => void) {
      hooks.set(name, fn);
    },
  };
  return { nuxt, hooks };
}

const slashes = (value: unknown): string => String(value).replaceAll('\\', '/');

describe('verbalyModule', () => {
  it('prepends the runtime plugin: the instance must exist before app code', () => {
    const { nuxt } = makeNuxt();
    verbalyModule(undefined, nuxt);
    expect(slashes(nuxt.options.plugins[0])).toMatch(/runtime\/plugin\.js$/);
    expect(nuxt.options.plugins[1]).toBe('app-plugin.ts');
  });

  it('transpiles the runtime directory', () => {
    const { nuxt } = makeNuxt();
    verbalyModule(undefined, nuxt);
    expect(nuxt.options.build.transpile.map(slashes)).toContainEqual(
      expect.stringMatching(/runtime$/),
    );
  });

  it('adds a fresh @verbaly/vite instance per Vite build', () => {
    const { nuxt, hooks } = makeNuxt();
    verbalyModule(undefined, nuxt);
    const extend = hooks.get('vite:extendConfig')!;

    const client: ViteConfigCapture = {};
    const server: ViteConfigCapture = { plugins: [] };
    extend(client);
    extend(server);

    const clientPlugin = client.plugins?.[0] as { name: string };
    const serverPlugin = server.plugins?.[0] as { name: string };
    expect(clientPlugin.name).toBe('verbaly');
    expect(serverPlugin.name).toBe('verbaly');
    expect(clientPlugin).not.toBe(serverPlugin); // no shared state across builds
  });

  it('merges configKey options with inline options: inline wins', () => {
    const { nuxt } = makeNuxt({ cookie: 'from-config', fallback: 'pt' });
    verbalyModule({ cookie: 'inline' }, nuxt);
    expect(nuxt.options.runtimeConfig.public.verbaly).toEqual({
      cookie: 'inline',
      fallback: 'pt',
    });
  });

  it('keeps compiler options out of runtimeConfig: only negotiation rides it', () => {
    const { nuxt } = makeNuxt();
    verbalyModule({ locales: ['en', 'es'], cookie: false }, nuxt);
    expect(nuxt.options.runtimeConfig.public.verbaly).toEqual({ cookie: false });
  });

  it('is assignable to Nuxt NuxtModule (type-level)', () => {
    const typed: NuxtModule<VerbalyNuxtOptions> = verbalyModule;
    expect(typeof typed).toBe('function');
  });

  it('lets Nuxt infer the configKey options for nuxt.config typing (type-level)', () => {
    // mirrors the conditional Nuxt emits in .nuxt/types/modules.d.ts (schemaNodeTemplate);
    // the defaults arg must be `any`: the constraint references the still-uninferred O
    type Inferred =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof verbalyModule extends NuxtModule<infer O, any, boolean>
        ? Partial<O>
        : Record<string, unknown>;
    const ok: Inferred = { cookie: false, fallback: 'en', locales: ['en', 'es'] };
    // @ts-expect-error a typo must be rejected: if this compiles, inference degraded to Record
    const typo: Inferred = { cokie: false };
    expect([ok, typo]).toBeDefined();
  });
});
