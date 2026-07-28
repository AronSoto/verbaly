import type { NuxtModule } from '@nuxt/schema';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import verbalyModule, { type VerbalyNuxtOptions } from '../src/module';

interface ViteConfigCapture {
  plugins?: unknown[];
}
interface Hooks {
  'vite:extendConfig': (config: ViteConfigCapture) => void;
  'prepare:types': (options: { references: Array<{ path: string }> }) => Promise<void>;
}

function makeNuxt(configOptions?: VerbalyNuxtOptions, rootDir = '/srv/app') {
  const hooks: Partial<Hooks> = {};
  const nuxt = {
    options: {
      rootDir,
      buildDir: join(rootDir, '.nuxt'),
      plugins: ['app-plugin.ts'] as unknown[],
      build: { transpile: [] as unknown[] },
      runtimeConfig: { public: {} as Record<string, unknown> },
      ...(configOptions ? { verbaly: configOptions } : {}),
    },
    hook(name: keyof Hooks, fn: Hooks[keyof Hooks]) {
      hooks[name] = fn as never;
    },
  };
  return { nuxt, hooks };
}

const tempDirs: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'verbaly-nuxt-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
    const extend = hooks['vite:extendConfig']!;

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

  it('getOptions merges configKey options with inline overrides', async () => {
    const { nuxt } = makeNuxt({ cookie: 'from-config', fallback: 'pt' });
    expect(await verbalyModule.getOptions({ cookie: 'inline' }, nuxt)).toEqual({
      cookie: 'inline',
      fallback: 'pt',
    });
    // no args at all: an empty options object, never a throw on the optional chains
    expect(await verbalyModule.getOptions()).toEqual({});
  });

  it('writes the dts into the .nuxt slot and registers the type reference', async () => {
    const root = tempRoot();
    const { nuxt, hooks } = makeNuxt(undefined, root);
    verbalyModule(undefined, nuxt);
    const references: Array<{ path: string }> = [];
    await hooks['prepare:types']!({ references });

    const file = join(root, '.nuxt', 'verbaly.d.ts');
    expect(references).toEqual([{ path: file }]);
    expect(readFileSync(file, 'utf8')).toContain('verbaly');
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false); // never in the project root
  });

  it('an explicit dts option wins over the slot', async () => {
    const root = tempRoot();
    const { nuxt, hooks } = makeNuxt(undefined, root);
    verbalyModule({ dts: 'types/i18n.d.ts' }, nuxt);
    const references: Array<{ path: string }> = [];
    await hooks['prepare:types']!({ references });

    const file = join(root, 'types', 'i18n.d.ts');
    expect(references).toEqual([{ path: file }]);
    expect(existsSync(file)).toBe(true);
  });

  it('dts: false turns the types slot off', async () => {
    const root = tempRoot();
    const { nuxt, hooks } = makeNuxt(undefined, root);
    verbalyModule({ dts: false }, nuxt);
    const references: Array<{ path: string }> = [];
    await hooks['prepare:types']!({ references });

    expect(references).toHaveLength(0);
    expect(existsSync(join(root, '.nuxt', 'verbaly.d.ts'))).toBe(false);
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
