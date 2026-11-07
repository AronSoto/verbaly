import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AstroIntegration } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import verbaly, { type VerbalyAstroOptions } from '../src/index';

function makeProject(): { root: string; dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-astro-'));
  const dist = join(root, 'dist');
  mkdirSync(join(root, 'locales'), { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ greet: 'Hello' }));
  writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: 'Hola' }));
  writeFileSync(
    join(dist, 'index.html'),
    '<html><body><h1 data-verbaly="greet">Hello</h1></body></html>',
  );
  return { root, dist };
}

function fakeInjectTypes(root: string) {
  return (injected: { filename: string; content: string }): URL =>
    pathToFileURL(join(root, '.astro', 'integrations', 'verbaly', injected.filename));
}

async function runBuild(
  root: string,
  dist: string,
  options?: VerbalyAstroOptions,
  buildOutput: 'static' | 'server' = 'static',
): Promise<void> {
  const integration = verbaly(options);
  await integration.hooks['astro:config:setup']({
    config: { root: pathToFileURL(root + '/') },
    updateConfig: () => undefined,
  });
  await integration.hooks['astro:config:done']({ buildOutput, injectTypes: fakeInjectTypes(root) });
  await integration.hooks['astro:build:done']({ dir: pathToFileURL(dist + '/') });
}

describe('verbaly astro integration', () => {
  it('injects no page script, since virtual:verbaly follows the ClientRouter swap itself', async () => {
    const { root } = makeProject();
    writeFileSync(
      join(root, 'verbaly.config.json'),
      JSON.stringify({ locales: ['en', 'es'], dir: 'locales', render: { inlineCatalog: true } }),
    );
    // a script from here would load the runtime on every page, the ones without client code too
    const injectScript = vi.fn();
    const setup = { config: { root: pathToFileURL(root + '/') }, updateConfig: () => undefined };
    await verbaly().hooks['astro:config:setup']({ ...setup, injectScript } as typeof setup);
    expect(injectScript).not.toHaveBeenCalled();
  });

  it("mirrors in Astro's own trailing slash, so every hreflang is an address it serves", async () => {
    const { root, dist } = makeProject();
    const page = '<html><head></head><body><h1 data-verbaly="greet">Hello</h1></body></html>';
    writeFileSync(join(dist, 'index.html'), page);
    writeFileSync(
      join(root, 'verbaly.config.json'),
      JSON.stringify({
        locales: ['en', 'es'],
        dir: 'locales',
        render: { baseUrl: 'https://x.dev' },
      }),
    );
    const integration = verbaly();
    const setup = { config: { root: pathToFileURL(root + '/') }, updateConfig: () => undefined };
    const config = { ...setup.config, trailingSlash: 'never' as const };
    await integration.hooks['astro:config:setup']({ ...setup, config });
    await integration.hooks['astro:config:done']({
      buildOutput: 'static',
      injectTypes: fakeInjectTypes(root),
    });
    await integration.hooks['astro:build:done']({ dir: pathToFileURL(dist + '/') });
    const es = readFileSync(join(dist, 'es', 'index.html'), 'utf8');
    expect(es).toContain('hreflang="es" href="https://x.dev/es"');
  });

  it('injects a fresh @verbaly/vite plugin with the project root pinned', async () => {
    let plugins: unknown[] = [];
    const integration = verbaly();
    await integration.hooks['astro:config:setup']({
      config: { root: pathToFileURL(process.cwd() + '/') },
      updateConfig: (config) => {
        plugins = config.vite?.plugins as unknown[];
      },
    });
    expect(plugins).toHaveLength(1);
    expect((plugins[0] as { name: string }).name).toBe('verbaly');

    let again: unknown[] = [];
    const second = verbaly();
    await second.hooks['astro:config:setup']({
      config: { root: pathToFileURL(process.cwd() + '/') },
      updateConfig: (config) => {
        again = config.vite?.plugins as unknown[];
      },
    });
    expect(again[0]).not.toBe(plugins[0]); // no shared plugin state across integrations
  });

  describe("Astro's i18n routing decides where the language lives in the url", () => {
    type I18n = {
      defaultLocale: string;
      locales: (string | { path: string; codes: [string, ...string[]] })[];
      routing?: 'manual' | { prefixDefaultLocale?: boolean };
    };

    // the routing verbaly/app ships, read from the module the injected plugin generates
    async function shippedRouting(
      i18n?: I18n,
      options?: VerbalyAstroOptions,
      file: Record<string, unknown> = {},
    ): Promise<string> {
      const { root } = makeProject();
      const config = { locales: ['en', 'es'], ...file };
      writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify(config));
      let plugins: unknown[] = [];
      await verbaly(options).hooks['astro:config:setup']({
        config: { root: pathToFileURL(root + '/'), ...(i18n && { i18n }) },
        updateConfig: (config) => {
          plugins = config.vite?.plugins as unknown[];
        },
      });
      const plugin = plugins[0] as {
        configResolved: (c: { root: string; command: string }) => Promise<void>;
        load: { handler: (id: string) => string | undefined };
      };
      await plugin.configResolved({ root, command: 'build' });
      const code = plugin.load.handler('\0virtual:verbaly') ?? '';
      return /export const routing = "([^"]+)";/.exec(code)?.[1] ?? '';
    }

    it('keeps the source at the root and prefixes the rest, as Astro does by default', async () => {
      const i18n: I18n = { defaultLocale: 'en', locales: ['en', 'es'], routing: {} };
      expect(await shippedRouting(i18n)).toBe('prefix-except-source');
    });

    it('prefixes every language when Astro prefixes its default one', async () => {
      const i18n: I18n = {
        defaultLocale: 'en',
        locales: ['en', 'es'],
        routing: { prefixDefaultLocale: true },
      };
      expect(await shippedRouting(i18n)).toBe('prefix-all');
    });

    it('leaves the mode alone with no i18n, with manual routing, or when the option names one', async () => {
      expect(await shippedRouting()).toBe('no-prefix');
      const manual: I18n = { defaultLocale: 'en', locales: ['en', 'es'], routing: 'manual' };
      expect(await shippedRouting(manual)).toBe('no-prefix');
      const prefixed: I18n = { defaultLocale: 'en', locales: ['en', 'es'] };
      expect(await shippedRouting(prefixed, { routing: 'prefix-all' })).toBe('prefix-all');
    });

    it('keeps a prefix mode verbaly.config names, and replaces no-prefix, which cannot hold', async () => {
      const i18n: I18n = { defaultLocale: 'en', locales: ['en', 'es'] };
      expect(await shippedRouting(i18n, {}, { routing: 'prefix-all' })).toBe('prefix-all');
      expect(await shippedRouting(i18n, {}, { routing: 'no-prefix' })).toBe('prefix-except-source');
    });

    it('says so when Astro serves another language at the root, and keeps one address', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const i18n: I18n = { defaultLocale: 'es', locales: ['en', 'es'] };
        expect(await shippedRouting(i18n)).toBe('no-prefix');
        const said = warn.mock.calls.map((call) => String(call[0])).join('\n');
        expect(said).toContain('defaultLocale "es"');
        expect(said).toContain('sourceLocale "en"');
      } finally {
        warn.mockRestore();
      }
    });

    it('follows a language written as an object whose path is one of its codes', async () => {
      const i18n: I18n = {
        defaultLocale: 'en',
        locales: ['en', { path: 'es', codes: ['es', 'es-ES'] }],
      };
      expect(await shippedRouting(i18n)).toBe('prefix-except-source');
    });

    it('says so when a language has a path of its own, which no Verbaly url can follow', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const i18n: I18n = {
          defaultLocale: 'en',
          locales: ['en', { path: 'spanish', codes: ['es'] }],
        };
        expect(await shippedRouting(i18n)).toBe('no-prefix');
        expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('/spanish');
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('injects the generated types into Astro and keeps them out of the project root', async () => {
    const { root } = makeProject();
    let injected: { filename: string; content: string } | undefined;
    let plugins: unknown[] = [];

    const integration = verbaly();
    await integration.hooks['astro:config:setup']({
      config: { root: pathToFileURL(root + '/') },
      updateConfig: (config) => {
        plugins = config.vite?.plugins as unknown[];
      },
    });
    await integration.hooks['astro:config:done']({
      buildOutput: 'static',
      injectTypes: (t) => {
        injected = t;
        return fakeInjectTypes(root)(t);
      },
    });

    expect(injected?.filename).toBe('verbaly.d.ts');
    expect(injected?.content).toContain("declare module 'virtual:verbaly'");
    expect(injected?.content).toContain('greet');

    // dev: the vite plugin refreshes Astro's copy, never a root file
    const target = fileURLToPath(fakeInjectTypes(root)(injected!));
    const plugin = plugins[0] as {
      configResolved: (c: { root: string; command: string }) => Promise<void>;
    };
    await plugin.configResolved({ root, command: 'serve' });
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
    // Astro's copy, dev's refresh and the CLI's write are one text, the project's locales included
    expect(injected?.content).toContain('export type VerbalyLocale = "en" | "es";');
    expect(readFileSync(target, 'utf8')).toBe(injected?.content);
  });

  it('mirrors the built site per locale when render is enabled', async () => {
    const { root, dist } = makeProject();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runBuild(root, dist, { render: true });
    log.mockRestore();
    const es = readFileSync(join(dist, 'es', 'index.html'), 'utf8');
    expect(es).toContain('>Hola<');
  });

  it('takes an inline render config as both the opt-in and the settings', async () => {
    const { root, dist } = makeProject();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runBuild(root, dist, { render: { clean: false } });
    log.mockRestore();
    expect(existsSync(join(dist, 'es', 'index.html'))).toBe(true);
  });

  it('treats a render section in the config file as the mirror opt-in', async () => {
    const { root, dist } = makeProject();
    writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify({ render: { clean: false } }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runBuild(root, dist);
    log.mockRestore();
    expect(existsSync(join(dist, 'es', 'index.html'))).toBe(true);
  });

  it('never mirrors without the opt-in: path-based i18n routing stays untouched', async () => {
    const { root, dist } = makeProject();
    await runBuild(root, dist);
    expect(existsSync(join(dist, 'es'))).toBe(false);
  });

  it('warns about keys it could not pre-fill during the mirror', async () => {
    const { root, dist } = makeProject();
    // a key present in no catalog: the mirror reports it, never invents it
    writeFileSync(
      join(dist, 'index.html'),
      '<html><body><p data-verbaly="ghost">?</p></body></html>',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runBuild(root, dist, { render: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 key not pre-filled: ghost'));
    log.mockRestore();
    warn.mockRestore();
  });

  it('injects types even when the source catalog is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-astro-'));
    mkdirSync(join(root, 'locales'), { recursive: true });
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: 'Hola' }));
    let injected: { content: string } | undefined;
    const integration = verbaly();
    await integration.hooks['astro:config:setup']({
      config: { root: pathToFileURL(root + '/') },
      updateConfig: () => undefined,
    });
    await integration.hooks['astro:config:done']({
      buildOutput: 'static',
      injectTypes: (t) => {
        injected = t;
        return fakeInjectTypes(root)(t);
      },
    });
    // no en.json: the generated dts still lands, just with no keys
    expect(injected?.content).toContain("declare module 'virtual:verbaly'");
  });

  it('skips render on server output and says why', async () => {
    const { root, dist } = makeProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runBuild(root, dist, { render: true }, 'server');
    expect(existsSync(join(dist, 'es'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('render skipped'));
    warn.mockRestore();
  });

  it('is assignable to AstroIntegration (type-level)', () => {
    const typed: AstroIntegration = verbaly();
    expect(typed.name).toBe('@verbaly/astro');
  });
});
