import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
    const { html } = render(
      '<h1 data-verbaly="home.intro" data-verbaly-args=\'{"name":"Aron"}\'>Hello</h1>',
    );
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
    const input =
      '<div data-verbaly="home.intro" data-verbaly-args=\'{"name":"A"}\'><div>old</div></div><div>after</div>';
    const { html } = render(input);
    expect(html).toBe(
      '<div data-verbaly="home.intro" data-verbaly-args=\'{"name":"A"}\'>Hola A</div><div>after</div>',
    );
  });

  it('translates attributes via data-verbaly-attr and blocks on*', () => {
    const input =
      '<nav data-verbaly-attr=\'{"aria-label":"nav.aria","onclick":"nav.aria"}\' aria-label="Main menu"></nav>';
    const { html } = render(input);
    expect(html).toContain('aria-label="Menú principal"');
    expect(html).not.toContain('onclick="Menú');
  });

  it('blocks style and srcdoc via data-verbaly-attr', () => {
    const input =
      '<div data-verbaly-attr=\'{"style":"nav.aria","srcdoc":"nav.aria","title":"nav.aria"}\'></div>';
    const { html } = render(input);
    expect(html).toContain('title="Menú principal"');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('srcdoc=');
  });

  it('sanitizes URL attributes via data-verbaly-attr (mirror of bindDom)', () => {
    const catalogs = { en: { evil: 'javascript:alert(1)', ok: '/en/docs' } };
    const { html } = renderHtml(
      '<a data-verbaly-attr=\'{"href":"evil","title":"ok"}\'></a><img data-verbaly-attr=\'{"src":"ok"}\'>',
      { locale: 'en', catalogs },
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('title="/en/docs"');
    expect(html).toContain('src="/en/docs"');
  });

  it('pre-renders numeric entities as literal braces (round-trip with the runtime)', () => {
    const catalogs = { en: { m: 'Use <code>&#123;when:relative&#125;</code> for {name}' } };
    const { html } = renderHtml(
      '<p data-verbaly="m" data-verbaly-rich data-verbaly-args=\'{"name":"Aron"}\'></p>',
      {
        locale: 'en',
        catalogs,
      },
    );
    expect(html).toContain('<code>{when:relative}</code>');
    expect(html).toContain('for Aron');
  });

  it('inserts missing attributes before the closing bracket', () => {
    const { html } = render('<input data-verbaly-attr=\'{"placeholder":"home.hint"}\'>');
    expect(html).toContain('placeholder="Busca y encuentra"');
  });

  it('sets <html lang> and <html dir> for the locale', () => {
    const { html } = render('<html lang="en"><body></body></html>');
    expect(html).toContain('<html lang="es" dir="ltr">');
    const inserted = render('<html><body></body></html>');
    expect(inserted.html).toContain('<html lang="es" dir="ltr">');
  });

  it('mirrors an rtl locale with dir="rtl"', () => {
    const result = renderHtml('<html lang="en" dir="ltr"><body></body></html>', {
      locale: 'ar',
      catalogs: { en: {}, ar: {} },
    });
    expect(result.html).toContain('<html lang="ar" dir="rtl">');
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
    const { html } = render(
      '<p data-verbaly="home.intro" data-verbaly-args="{&quot;name&quot;:&quot;A&quot;}"></p>',
    );
    expect(html).toContain('>Hola A<');
  });

  it('renders named links from richLinks', () => {
    const catalogs = { en: { guide: 'Read the <docs>guide</docs> now' } };
    const { html } = renderHtml('<p data-verbaly="guide" data-verbaly-rich></p>', {
      locale: 'en',
      catalogs,
      richLinks: { docs: { href: '/docs', target: '_blank', rel: 'noopener' } },
    });
    expect(html).toContain('<a href="/docs" target="_blank" rel="noopener">guide</a>');
  });

  it('merges per-element data-verbaly-links over globals', () => {
    const catalogs = { en: { m: '<docs>a</docs> <repo>b</repo>' } };
    const input =
      '<p data-verbaly="m" data-verbaly-rich data-verbaly-links=\'{"repo":"https://gh.io/x"}\'></p>';
    const { html } = renderHtml(input, {
      locale: 'en',
      catalogs,
      richLinks: { docs: '/docs' },
    });
    expect(html).toContain('<a href="/docs">a</a>');
    expect(html).toContain('<a href="https://gh.io/x">b</a>');
  });

  it('blocks unsafe hrefs and escapes attribute values', () => {
    const catalogs = { en: { m: '<bad>x</bad> <q>y</q>' } };
    const { html } = renderHtml('<p data-verbaly="m" data-verbaly-rich></p>', {
      locale: 'en',
      catalogs,
      richLinks: { bad: 'javascript:alert(1)', q: '/a?b="c"&d=1' },
    });
    expect(html).toContain('<a>x</a>');
    expect(html).toContain('<a href="/a?b=&quot;c&quot;&amp;d=1">y</a>');
  });

  it('without a links map named tags still unwrap', () => {
    const catalogs = { en: { m: 'go to <docs>docs</docs>' } };
    const { html } = renderHtml('<p data-verbaly="m" data-verbaly-rich></p>', {
      locale: 'en',
      catalogs,
    });
    expect(html).toContain('>go to docs<');
    expect(html).not.toContain('<a');
  });

  it('reports a missing key referenced only by data-verbaly-attr', () => {
    const { html, missing } = render(
      '<input data-verbaly-attr=\'{"placeholder":"nope"}\' placeholder="x">',
    );
    expect(missing).toEqual(['nope']);
    expect(html).toContain('placeholder="x"');
  });

  it('skips non-string values in a data-verbaly-attr map', () => {
    const { html } = render('<div data-verbaly-attr=\'{"title":123,"aria-label":"nav.aria"}\'></div>');
    expect(html).toContain('aria-label="Menú principal"');
    expect(html).not.toContain('title="123"');
  });

  it('warns and ignores an invalid args JSON blob', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { html } = render('<p data-verbaly="home.intro" data-verbaly-args="{not json}"></p>');
      // args unparsed: the {name} placeholder stays literal, no crash
      expect(html).toContain('Hola {name}');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid args JSON'));
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves an unclosed element untouched (no closing tag found)', () => {
    const { html } = render('<div data-verbaly="home.hint"><span>keep');
    // findClose returns null: content is not rewritten
    expect(html).toContain('<span>keep');
    expect(html).not.toContain('Busca y encuentra');
  });

  it('ignores a same-name closing tag that lives inside a comment', () => {
    const input = '<div data-verbaly="home.hint"><!-- </div> --></div><div>after</div>';
    const { html } = render(input);
    expect(html).toContain('>Busca y encuentra<');
    expect(html).toContain('<div>after</div>');
  });

  it('counts a nested self-closing same-name tag as no depth change', () => {
    const catalogs = { en: { k: 'Text' } };
    const { html } = renderHtml('<div data-verbaly="k"><div/></div><div>tail</div>', {
      locale: 'en',
      catalogs,
    });
    expect(html).toContain('>Text<');
    expect(html).toContain('<div>tail</div>');
  });

  it('merges per-element links when there is no global map', () => {
    const catalogs = { en: { m: 'see <repo>repo</repo>' } };
    const { html } = renderHtml(
      '<p data-verbaly="m" data-verbaly-rich data-verbaly-links=\'{"repo":"https://gh.io/x"}\'></p>',
      { locale: 'en', catalogs },
    );
    expect(html).toContain('<a href="https://gh.io/x">repo</a>');
  });

  it('injects hreflang alternates into <head>', () => {
    const { html } = renderHtml('<html><head><title>x</title></head><body></body></html>', {
      locale: 'es',
      catalogs: CATALOGS,
      alternates: [
        { hreflang: 'en', href: 'https://x.dev/' },
        { hreflang: 'es', href: 'https://x.dev/es/' },
        { hreflang: 'x-default', href: 'https://x.dev/' },
      ],
    });
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://x.dev/">');
    expect(html).toContain('<link rel="alternate" hreflang="es" href="https://x.dev/es/">');
    expect(html).toContain('hreflang="x-default"');
    expect(html.indexOf('verbaly:hreflang')).toBeLessThan(html.indexOf('</head>'));
  });

  it('re-injecting alternates is idempotent (markers)', () => {
    const alternates = [{ hreflang: 'en', href: 'https://x.dev/' }];
    const once = renderHtml('<html><head></head><body></body></html>', {
      locale: 'en',
      catalogs: CATALOGS,
      alternates,
    }).html;
    const twice = renderHtml(once, { locale: 'en', catalogs: CATALOGS, alternates }).html;
    expect(twice).toBe(once);
    expect(twice.match(/<!--verbaly:hreflang-->/g)).toHaveLength(1);
  });

  it('falls back to source for empty entries in nested catalogs', () => {
    // regression: the old '' cleanup only saw top-level entries
    const catalogs = { en: { home: { end: 'text.' } }, es: { home: { end: '' } } };
    const { html, missing } = renderHtml('<p data-verbaly="home.end">text.</p>', {
      locale: 'es',
      catalogs,
      sourceLocale: 'en',
    });
    expect(html).toContain('>text.<');
    expect(missing).toEqual([]);
  });

  const SEO_PAGE =
    '<html><head>' +
    '<link rel="canonical" href="https://x.dev/docs/">' +
    '<meta property="og:url" content="https://x.dev/docs/">' +
    '<link rel="canonical" href="https://elsewhere.dev/">' +
    '</head><body></body></html>';
  const SEO_ALTERNATES = [
    { hreflang: 'en', href: 'https://x.dev/docs/' },
    { hreflang: 'es', href: 'https://x.dev/es/docs/' },
    { hreflang: 'x-default', href: 'https://x.dev/docs/' },
  ];

  it('rewrites canonical and og:url to the locale URL', () => {
    const { html } = renderHtml(SEO_PAGE, {
      locale: 'es',
      catalogs: CATALOGS,
      alternates: SEO_ALTERNATES,
    });
    expect(html).toContain('<link rel="canonical" href="https://x.dev/es/docs/">');
    expect(html).toContain('<meta property="og:url" content="https://x.dev/es/docs/">');
    // a canonical pointing elsewhere is not ours to touch
    expect(html).toContain('<link rel="canonical" href="https://elsewhere.dev/">');
  });

  it('leaves canonical alone on the source-locale pass and re-runs', () => {
    const en = renderHtml(SEO_PAGE, {
      locale: 'en',
      catalogs: CATALOGS,
      alternates: SEO_ALTERNATES,
    }).html;
    expect(en).toContain('<link rel="canonical" href="https://x.dev/docs/">');
    const es = renderHtml(SEO_PAGE, {
      locale: 'es',
      catalogs: CATALOGS,
      alternates: SEO_ALTERNATES,
    }).html;
    const again = renderHtml(es, {
      locale: 'es',
      catalogs: CATALOGS,
      alternates: SEO_ALTERNATES,
    }).html;
    expect(again).toBe(es);
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

  it('is idempotent: re-running does not nest locale dirs', async () => {
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

  it('takes global links from config render.links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ m: 'see <docs>docs</docs>' }));
    writeFileSync(join(dist, 'index.html'), '<p data-verbaly="m" data-verbaly-rich></p>');

    const cfg = resolveConfig({ root, sourceLocale: 'en', render: { links: { docs: '/docs' } } });
    await renderSite(cfg);
    const out = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(out).toContain('<a href="/docs">docs</a>');
  });

  it('emits reciprocal hreflang alternates with directory URLs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'docs'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    const page = '<html><head></head><body><p data-verbaly="k"></p></body></html>';
    writeFileSync(join(dist, 'index.html'), page);
    writeFileSync(join(dist, 'docs', 'index.html'), page);

    const cfg = resolveConfig({
      root,
      sourceLocale: 'en',
      render: { baseUrl: 'https://verb.dev/' },
    });
    await renderSite(cfg);

    const enDocs = readFileSync(join(dist, 'docs', 'index.html'), 'utf8');
    expect(enDocs).toContain('hreflang="en" href="https://verb.dev/docs/"');
    expect(enDocs).toContain('hreflang="es" href="https://verb.dev/es/docs/"');
    expect(enDocs).toContain('hreflang="x-default" href="https://verb.dev/docs/"');
    const esDocs = readFileSync(join(dist, 'es', 'docs', 'index.html'), 'utf8');
    expect(esDocs).toContain('hreflang="es" href="https://verb.dev/es/docs/"');
    const enRoot = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(enRoot).toContain('hreflang="en" href="https://verb.dev/"');
  });

  it('writes an i18n sitemap when enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<html><head></head><body></body></html>');

    const cfg = resolveConfig({
      root,
      sourceLocale: 'en',
      render: { baseUrl: 'https://verb.dev', sitemap: true },
    });
    await renderSite(cfg);
    const xml = readFileSync(join(dist, 'sitemap-i18n.xml'), 'utf8');
    expect(xml).toContain('<loc>https://verb.dev/</loc>');
    expect(xml).toContain('<loc>https://verb.dev/es/</loc>');
    expect(xml).toContain('xhtml:link rel="alternate" hreflang="es"');
    expect(xml).toContain('hreflang="x-default"'); // valid as an alternate link
    expect((xml.match(/<loc>/g) ?? []).length).toBe(2); // one <url> per locale, not x-default
  });

  it('dedupes a missing key seen on several pages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'about'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    const page = '<html><head></head><body><p data-verbaly="ghost"></p></body></html>';
    writeFileSync(join(dist, 'index.html'), page);
    writeFileSync(join(dist, 'about', 'index.html'), page);

    const cfg = resolveConfig({ root, sourceLocale: 'en', render: { baseUrl: 'https://verb.dev' } });
    const result = await renderSite(cfg);
    // same missing key on both pages, listed once per locale
    expect(result.missing.es).toEqual(['ghost']);
  });

  it('clean removes stale locale pages before mirroring', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'es'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<p data-verbaly="k"></p>');
    const stale = join(dist, 'es', 'old.html');
    writeFileSync(stale, 'stale');

    const cfg = resolveConfig({ root, sourceLocale: 'en', render: { clean: true } });
    await renderSite(cfg);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(dist, 'es', 'index.html'))).toBe(true);
  });
});
