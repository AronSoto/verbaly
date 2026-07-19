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
  integration.hooks['astro:config:setup']({
    config: { root: pathToFileURL(root + '/') },
    updateConfig: () => undefined,
  });
  await integration.hooks['astro:config:done']({ buildOutput, injectTypes: fakeInjectTypes(root) });
  await integration.hooks['astro:build:done']({ dir: pathToFileURL(dist + '/') });
}

describe('verbaly astro integration', () => {
  it('injects a fresh @verbaly/vite plugin with the project root pinned', () => {
    let plugins: unknown[] = [];
    const integration = verbaly();
    integration.hooks['astro:config:setup']({
      config: { root: pathToFileURL(process.cwd() + '/') },
      updateConfig: (config) => {
        plugins = config.vite?.plugins as unknown[];
      },
    });
    expect(plugins).toHaveLength(1);
    expect((plugins[0] as { name: string }).name).toBe('verbaly');

    let again: unknown[] = [];
    const second = verbaly();
    second.hooks['astro:config:setup']({
      config: { root: pathToFileURL(process.cwd() + '/') },
      updateConfig: (config) => {
        again = config.vite?.plugins as unknown[];
      },
    });
    expect(again[0]).not.toBe(plugins[0]); // no shared plugin state across integrations
  });

  it('injects the generated types into Astro and keeps them out of the project root', async () => {
    const { root } = makeProject();
    let injected: { filename: string; content: string } | undefined;
    let plugins: unknown[] = [];

    const integration = verbaly();
    integration.hooks['astro:config:setup']({
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
