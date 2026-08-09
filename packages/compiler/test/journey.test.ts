import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindDom, createVerbaly, localePath, resolveLocale, type Verbaly } from 'verbaly';
import { resolveConfig } from '../src/config';
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
    expect(html).toContain('Lee la <a href="/docs">guía</a>');
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
