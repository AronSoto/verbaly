import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindDom, createVerbaly, localePath, resolveLocale, type Verbaly } from 'verbaly';
import { clientCatalogs } from '../src/bundle';
import { loadCatalogs } from '../src/catalog';
import { generateLocaleModule, generateRuntimeModule } from '../src/codegen';
import { resolveConfig, type VerbalyConfig } from '../src/config';
import { renderSite } from '../src/render';

// end to end: build a site and walk a visitor through the mirror, because the units add up here
const CATALOGS = {
  en: { title: 'Documentation', intro: 'Read the <docs>guide</docs>' },
  es: { title: 'Documentación', intro: 'Lee la <docs>guía</docs>' },
  pt: { title: 'Documentação', intro: 'Leia o <docs>guia</docs>' },
};

const SUPPORTED = ['en', 'es', 'pt'];
const PAGE =
  '<html lang="en"><body><h1 data-verbaly="title">Documentation</h1>' +
  '<p data-verbaly="intro" data-verbaly-rich>Read the <a href="/docs">guide</a></p>' +
  '<a href="/docs">docs</a><a href="/app.js">asset</a></body></html>';

async function buildSite(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-journey-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  mkdirSync(join(root, 'dist', 'docs'), { recursive: true });
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(catalog));
  }
  writeFileSync(join(root, 'dist', 'index.html'), PAGE);
  writeFileSync(join(root, 'dist', 'docs', 'index.html'), PAGE);
  await renderSite(resolveConfig({ root, sourceLocale: 'en' }), {
    richLinks: { docs: '/docs' },
  });
  return root;
}

// a visitor arriving at a page of the mirror, with a browser that asks for something else
function visit(html: string, url: string): { pathname: string } {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.documentElement.lang = /<html lang="([^"]+)"/.exec(html)?.[1] ?? '';
  return { pathname: new URL(url, 'https://x.dev').pathname };
}

// the instance a consumer builds: source catalog inline, every other locale lazy
function instanceFor(locale: string): { instance: Verbaly; land: () => void } {
  let land = (): void => {};
  const instance = createVerbaly({
    locale,
    fallback: 'en',
    messages: { en: CATALOGS.en },
    loaders: {
      es: () => new Promise((resolve) => (land = () => resolve(CATALOGS.es))),
      pt: () => new Promise((resolve) => (land = () => resolve(CATALOGS.pt))),
    },
  });
  return { instance: instance as Verbaly, land };
}

let root: string;
const read = (...parts: string[]): string => readFileSync(join(root, 'dist', ...parts), 'utf8');

describe('a visitor walking through the mirror', () => {
  beforeEach(async () => {
    root ??= await buildSite();
    document.documentElement.lang = '';
  });

  it('is served html already in its language, with lang and dir set', () => {
    const html = read('es', 'index.html');
    expect(html).toContain('<html lang="es" dir="ltr">');
    expect(html).toContain('>Documentación<');
    // a link a message renders keeps the visitor inside, like one the author wrote
    expect(html).toContain('Lee la <a href="/es/docs">guía</a>');
  });

  it('learns its locale from the url, over a browser that asks for something else', () => {
    const page = visit(read('es', 'index.html'), 'https://x.dev/es/');
    expect(resolveLocale({ supported: SUPPORTED, fallback: 'en', path: page.pathname })).toBe('es');
  });

  it('never sees the source locale while the catalog travels', async () => {
    const page = visit(read('es', 'index.html'), 'https://x.dev/es/');
    const locale = resolveLocale({ supported: SUPPORTED, fallback: 'en', path: page.pathname });
    const { instance, land } = instanceFor(locale);
    const unbind = bindDom(instance, { richLinks: { docs: '/docs' } });
    expect(document.querySelector('h1')!.textContent).toBe('Documentación');
    void instance.loadLocale(locale);
    land();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('h1')!.textContent).toBe('Documentación');
    unbind();
  });

  it('and the runtime lands on exactly what was pre-rendered', async () => {
    const html = read('es', 'index.html');
    visit(html, 'https://x.dev/es/');
    const { instance, land } = instanceFor('es');
    void instance.loadLocale('es');
    land();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const unbind = bindDom(instance, { richLinks: { docs: '/docs' } });
    const hydrated = document.querySelector('p')!.innerHTML;
    unbind();
    expect(html).toContain(hydrated);
  });

  it('stays in the mirror when it follows a link, and assets do not move', () => {
    const html = read('es', 'index.html');
    expect(html).toContain('<a href="/es/docs">docs</a>');
    expect(html).toContain('<a href="/app.js">asset</a>');
  });

  it('finds the same page of another mirror when it switches language', () => {
    const there = localePath('pt', {
      supported: SUPPORTED,
      sourceLocale: 'en',
      path: '/es/docs',
    });
    expect(there).toBe('/pt/docs');
    expect(read('pt', 'docs', 'index.html')).toContain('>Documentação<');
  });

  it('and switching back to the source locale leaves the prefix behind', () => {
    expect(localePath('en', { supported: SUPPORTED, sourceLocale: 'en', path: '/es/docs' })).toBe(
      '/docs',
    );
    expect(read('index.html')).toContain('>Documentation<');
  });

  it('is warned when the page and the instance disagree, which is the only way to still flash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    visit(read('es', 'index.html'), 'https://x.dev/es/');
    const { instance } = instanceFor('en');
    const unbind = bindDom(instance);
    expect(warn.mock.calls[0]![0]).toContain('<html lang="es"> and this instance is in "en"');
    unbind();
    warn.mockRestore();
  });
});

const CORE_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'src',
  'index.ts',
);

const sites: string[] = [];
afterAll(() => {
  for (const site of sites) rmSync(site, { recursive: true, force: true });
});

// an Astro site with the ClientRouter: one virtual:verbaly per page tree, a binding that lives on
interface VirtualModule {
  verbaly: Verbaly;
  setLocale(locale: string): Promise<void>;
}

const CHANGELOG = {
  en: { title: 'Documentation', 'rel.v1': 'First release' },
  es: { title: 'Documentación', 'rel.v1': 'Primera versión' },
};
const CHANGELOG_PAGE =
  '<html lang="en"><head><title>Changelog</title></head><body>' +
  '<h1 data-verbaly="title">Documentation</h1>' +
  '<p data-verbaly="rel.v1">First release</p></body></html>';

async function astroSite(
  config: VerbalyConfig = {},
): Promise<{ read: typeof read; mod: VirtualModule }> {
  const site = mkdtempSync(join(tmpdir(), 'verbaly-swap-'));
  sites.push(site);
  // the host is read from the project, as every command reads it: no option names it
  writeFileSync(join(site, 'package.json'), JSON.stringify({ dependencies: { astro: '^7.3.0' } }));
  mkdirSync(join(site, 'locales'));
  mkdirSync(join(site, 'dist'));
  for (const [locale, catalog] of Object.entries(CHANGELOG)) {
    writeFileSync(join(site, 'locales', `${locale}.json`), JSON.stringify(catalog));
  }
  writeFileSync(join(site, 'dist', 'index.html'), CHANGELOG_PAGE);
  const cfg = resolveConfig({
    root: site,
    sourceLocale: 'en',
    routing: 'prefix-except-source',
    ...config,
  });
  await renderSite(cfg);

  // what the vite plugin serves as virtual:verbaly, with its locale modules as files
  const client = clientCatalogs(cfg, loadCatalogs(cfg));
  const out = join(site, 'module');
  mkdirSync(out);
  for (const locale of cfg.locales) {
    writeFileSync(join(out, `${locale}.js`), generateLocaleModule(client[locale] ?? {}));
  }
  const code = generateRuntimeModule(cfg, {
    localeImport: (locale) => `./${locale}.js`,
    inlineCatalog: cfg.render.inlineCatalog === true,
  });
  writeFileSync(join(out, 'index.js'), code);
  // bundled as a browser gets it, lazy locales included, and run in this document
  const bundle = await build({
    entryPoints: [join(out, 'index.js')],
    bundle: true,
    format: 'iife',
    globalName: 'virtualVerbaly',
    platform: 'browser',
    write: false,
    alias: { verbaly: CORE_SRC },
  });
  const run = new Function(`${bundle.outputFiles[0]!.text}\nreturn virtualVerbaly;`);
  return {
    read: (...parts) => readFileSync(join(site, 'dist', ...parts), 'utf8'),
    mod: run() as VirtualModule,
  };
}

// the ClientRouter: before-swap with the next document, then the body changes under the binding
function swap(html: string, url: string): void {
  const incoming = new DOMParser().parseFromString(html, 'text/html');
  const event = Object.assign(new Event('astro:before-swap'), {
    to: new URL(url, 'https://x.dev'),
    newDocument: incoming,
  });
  document.dispatchEvent(event);
  document.documentElement.lang = incoming.documentElement.lang;
  document.body.replaceWith(document.adoptNode(incoming.body));
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const shown = (selector: string): string => document.querySelector(selector)!.textContent ?? '';

describe('a visitor whose client router swaps the page under a live binding', () => {
  it('leaves a translated page for the source one and reads it in the source language', async () => {
    const { read, mod } = await astroSite();
    visit(read('es', 'index.html'), 'https://x.dev/es/');
    await mod.setLocale('es');
    const unbind = bindDom(mod.verbaly, { root: document });
    expect(shown('h1')).toBe('Documentación');

    swap(read('index.html'), '/');
    await settle();
    expect(mod.verbaly.locale).toBe('en');
    expect(shown('h1')).toBe('Documentation');
    unbind();
  });

  it('leaves the source page for a translated one before that catalog has landed', async () => {
    const { read, mod } = await astroSite();
    visit(read('index.html'), 'https://x.dev/');
    await mod.setLocale('en');
    const unbind = bindDom(mod.verbaly, { root: document });

    swap(read('es', 'index.html'), '/es/');
    // the mirror already wrote it in Spanish, and the source catalog must not paint over it
    expect(shown('h1')).toBe('Documentación');
    await settle();
    await settle();
    expect(mod.verbaly.locale).toBe('es');
    expect(shown('h1')).toBe('Documentación');
    expect(shown('p')).toBe('Primera versión');
    unbind();
  });

  it('keeps a group the client never gets in the language of the page it lands on', async () => {
    // verbaly-web's /changelog: the release notes are build-only, each page carries its own slice
    const { read, mod } = await astroSite({
      render: { inlineCatalog: true },
      bundle: { exclude: ['rel'] },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    visit(read('es', 'index.html'), 'https://x.dev/es/');
    await mod.setLocale('es');
    const unbind = bindDom(mod.verbaly, { root: document });

    swap(read('index.html'), '/');
    await settle();
    expect(shown('h1')).toBe('Documentation');
    expect(shown('p')).toBe('First release');

    swap(read('es', 'index.html'), '/es/');
    await settle();
    expect(shown('p')).toBe('Primera versión');
    // the page's own slice was adopted, so code on it reads the group the client never got
    expect(mod.verbaly.t('rel.v1')).toBe('Primera versión');
    unbind();
    warn.mockRestore();
  });
});
