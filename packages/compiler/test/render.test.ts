import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { renderHtml, renderSite } from '../src/render';

const CATALOGS = {
  en: {
    'home.title': 'The build <em>gate</em>',
    'home.intro': 'Hello {name}',
    'home.count': '{n | one: # file | other: # files}',
    'home.hint': 'Search & find',
    'nav.aria': 'Main menu',
  },
  es: {
    'home.title': 'El <em>gate</em> del build',
    'home.intro': 'Hola {name}',
    'home.count': '{n | one: # archivo | other: # archivos}',
    'home.hint': 'Busca y encuentra',
    'nav.aria': 'Menú principal',
  },
};

function render(html: string, locale = 'es') {
  return renderHtml(html, { locale, catalogs: CATALOGS, sourceLocale: 'en' });
}

describe('renderHtml', () => {
  it('pre-fills text content and keeps the runtime attributes', () => {
    const { html } = render('<h1 data-verbaly="home.intro" data-verbaly-args=\'{"name":"Aron"}\'>Hello</h1>');
    expect(html).toBe(
      '<h1 data-verbaly="home.intro" data-verbaly-args=\'{"name":"Aron"}\'>Hola Aron</h1>',
    );
  });

  it('formats plurals with the real runtime', () => {
    const { html } = render('<p data-verbaly="home.count" data-verbaly-args=\'{"n":1}\'></p>');
    expect(html).toContain('>1 archivo<');
  });

  it('escapes plain text (no HTML injection from messages)', () => {
    const { html } = render('<p data-verbaly="home.title"></p>');
    expect(html).toContain('&lt;em&gt;');
    expect(html).not.toContain('<em>');
  });

  it('renders whitelisted tags for data-verbaly-rich', () => {
    const { html } = render('<p data-verbaly="home.title" data-verbaly-rich></p>');
    expect(html).toContain('El <em>gate</em> del build');
  });

  it('handles nested same-name elements', () => {
    const input = '<div data-verbaly="home.intro" data-verbaly-args=\'{"name":"A"}\'><div>old</div></div><div>after</div>';
    const { html } = render(input);
    expect(html).toBe('<div data-verbaly="home.intro" data-verbaly-args=\'{"name":"A"}\'>Hola A</div><div>after</div>');
  });

  it('translates attributes via data-verbaly-attr and blocks on*', () => {
    const input = '<nav data-verbaly-attr=\'{"aria-label":"nav.aria","onclick":"nav.aria"}\' aria-label="Main menu"></nav>';
    const { html } = render(input);
    expect(html).toContain('aria-label="Menú principal"');
    expect(html).not.toContain('onclick="Menú');
  });

  it('inserts missing attributes before the closing bracket', () => {
    const { html } = render('<input data-verbaly-attr=\'{"placeholder":"home.hint"}\'>');
    expect(html).toContain('placeholder="Busca y encuentra"');
  });

  it('sets <html lang> for the locale', () => {
    const { html } = render('<html lang="en"><body></body></html>');
    expect(html).toContain('<html lang="es">');
    const inserted = render('<html><body></body></html>');
    expect(inserted.html).toContain('<html lang="es">');
  });

  it('falls back to source when the locale entry is empty', () => {
    const catalogs = { en: { k: 'Source' }, es: { k: '' } };
    const { html } = renderHtml('<p data-verbaly="k"></p>', {
      locale: 'es',
      catalogs,
      sourceLocale: 'en',
    });
    expect(html).toContain('>Source<');
  });

  it('reports missing keys and leaves their content untouched', () => {
    const { html, missing } = render('<p data-verbaly="nope">keep</p>');
    expect(missing).toEqual(['nope']);
    expect(html).toContain('>keep<');
  });

  it('ignores markup inside scripts, styles and comments', () => {
    const input =
      '<script>const s = \'<p data-verbaly="home.intro">x</p>\';</script>' +
      '<!-- <p data-verbaly="home.intro">y</p> -->' +
      '<p data-verbaly="home.hint">z</p>';
    const { html } = render(input);
    expect(html).toContain('\'<p data-verbaly="home.intro">x</p>\'');
    expect(html).toContain('<!-- <p data-verbaly="home.intro">y</p> -->');
    expect(html).toContain('>Busca y encuentra<');
  });

  it('escapes HTML-sensitive chars from messages', () => {
    const { html } = render('<p data-verbaly="home.hint"></p>', 'en');
    expect(html).toContain('Search &amp; find');
  });

  it('decodes entity-escaped args attributes', () => {
    const { html } = render('<p data-verbaly="home.intro" data-verbaly-args="{&quot;name&quot;:&quot;A&quot;}"></p>');
    expect(html).toContain('>Hola A<');
  });
});

describe('renderSite', () => {
  it('mirrors pages per locale and fills source in place', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'docs'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify(CATALOGS.en));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify(CATALOGS.es));
    const page = '<html><body><h1 data-verbaly="home.hint">x</h1></body></html>';
    writeFileSync(join(dist, 'index.html'), page);
    writeFileSync(join(dist, 'docs', 'index.html'), page);

    const cfg = resolveConfig({ root, sourceLocale: 'en' });
    const result = await renderSite(cfg);

    expect(result.files).toBe(2);
    expect(result.locales.sort()).toEqual(['en', 'es']);
    const en = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(en).toContain('lang="en"');
    expect(en).toContain('>Search &amp; find<');
    const es = readFileSync(join(dist, 'es', 'docs', 'index.html'), 'utf8');
    expect(es).toContain('lang="es"');
    expect(es).toContain('>Busca y encuentra<');
  });

  it('is idempotent — re-running does not nest locale dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<p data-verbaly="k"></p>');

    const cfg = resolveConfig({ root, sourceLocale: 'en' });
    await renderSite(cfg);
    const again = await renderSite(cfg);
    expect(again.files).toBe(1); // dist/es/index.html excluded from the second pass
  });
});
