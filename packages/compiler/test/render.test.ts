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

  it('closes no void tag: </br> would parse as a second <br> and hydration would drop it', () => {
    const { html } = renderHtml('<p data-verbaly="m" data-verbaly-rich></p>', {
      locale: 'es',
      catalogs: { es: { m: 'una línea<br/>otra' } },
    });
    expect(html).toContain('una línea<br>otra');
    expect(html).not.toContain('</br>');
  });

  it('drops what a message nests inside a void tag, exactly like bindDom', () => {
    const { html } = renderHtml('<p data-verbaly="m" data-verbaly-rich></p>', {
      locale: 'es',
      catalogs: { es: { m: 'una<br>colgada</br>otra' } },
    });
    expect(html).toContain('una<br>otra');
  });

  it('keeps a link inside the mirror when it points at a page the mirror holds', () => {
    const mirror = { prefix: '/es', pages: new Set(['/docs', '/']) };
    const { html } = renderHtml(
      '<a href="/docs">d</a><a href="/docs/">s</a><a href="/docs?q=1#s">q</a>',
      { locale: 'es', catalogs: CATALOGS, mirror },
    );
    expect(html).toBe(
      '<a href="/es/docs">d</a><a href="/es/docs/">s</a><a href="/es/docs?q=1#s">q</a>',
    );
  });

  it('leaves alone anything that is not a page of this mirror', () => {
    const mirror = { prefix: '/es', pages: new Set(['/docs']) };
    const input =
      '<a href="/assets/app.js">a</a><a href="https://x.dev/docs">e</a><a href="//x.dev/docs">p</a>' +
      '<a href="#top">h</a><a href="mailto:a@b.c">m</a><a href="/llms.txt">t</a><a href="docs">r</a>';
    expect(renderHtml(input, { locale: 'es', catalogs: CATALOGS, mirror }).html).toBe(input);
  });

  it('sends a mirrored redirect page to the mirrored target', () => {
    const mirror = { prefix: '/pt', pages: new Set(['/docs/start']) };
    const { html } = renderHtml('<meta http-equiv="refresh" content="0;url=/docs/start">', {
      locale: 'pt',
      catalogs: CATALOGS,
      mirror,
    });
    expect(html).toContain('content="0;url=/pt/docs/start"');
  });

  it('never edits inside content it just replaced, even when the message brings its own link', () => {
    const mirror = { prefix: '/es', pages: new Set(['/docs']) };
    const catalogs = { es: { m: 'lee la <docs>guía</docs>' } };
    // caught on the real docs site: the scanner met the <a> the message had just written
    const { html } = renderHtml(
      '<p data-verbaly="m" data-verbaly-rich><a href="/docs">old</a></p><a href="/docs">nav</a>',
      { locale: 'es', catalogs, richLinks: { docs: '/docs' }, mirror },
    );
    expect(html).toContain('<p data-verbaly="m" data-verbaly-rich>lee la <a href="/docs">guía</a>');
    expect(html).toContain('<a href="/es/docs">nav</a>');
  });

  it('rewrites nothing without a mirror: the source locale keeps its own links', () => {
    const input = '<a href="/docs">d</a>';
    expect(renderHtml(input, { locale: 'es', catalogs: CATALOGS }).html).toBe(input);
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
    const { html } = render(
      '<div data-verbaly-attr=\'{"title":123,"aria-label":"nav.aria"}\'></div>',
    );
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

describe('a site served under a base path', () => {
  const pages = new Set(['/docs', '/']);

  it('rewrites a link that carries the base, keeping the base in front', () => {
    const mirror = { prefix: '/es', base: '/app', pages };
    const html = '<a href="/app/docs">d</a>';
    expect(renderHtml(html, { locale: 'es', catalogs: CATALOGS, mirror }).html).toBe(
      '<a href="/app/es/docs">d</a>',
    );
  });

  it('leaves a link that does not live under the base alone', () => {
    const mirror = { prefix: '/es', base: '/app', pages };
    const html = '<a href="/docs">d</a><a href="/application/docs">o</a>';
    expect(renderHtml(html, { locale: 'es', catalogs: CATALOGS, mirror }).html).toBe(html);
  });

  it('does not double up a link that already points inside the mirror', () => {
    const mirror = { prefix: '/es', base: '/app', pages };
    const html = '<a href="/app/es/docs">d</a>';
    expect(renderHtml(html, { locale: 'es', catalogs: CATALOGS, mirror }).html).toBe(html);
  });

  it('reaches renderSite through render.base', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'docs'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<html><body><a href="/app/docs">d</a></body></html>');
    writeFileSync(join(dist, 'docs', 'index.html'), '<html><body>docs</body></html>');

    const cfg = resolveConfig({ root, sourceLocale: 'en', render: { base: '/app' } });
    await renderSite(cfg);

    expect(readFileSync(join(dist, 'es', 'index.html'), 'utf8')).toContain('href="/app/es/docs"');
  });
});

describe('render.redirect', () => {
  function root(page: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    mkdirSync(join(dir, 'locales'), { recursive: true });
    mkdirSync(join(dir, 'dist', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(dir, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dir, 'dist', 'index.html'), page);
    writeFileSync(join(dir, 'dist', 'docs', 'index.html'), page);
    return dir;
  }

  const PAGE = '<html><head><title>x</title></head><body>y</body></html>';

  it('is off unless asked for', async () => {
    const dir = root(PAGE);
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en' }));
    expect(readFileSync(join(dir, 'dist', 'index.html'), 'utf8')).not.toContain('verbaly:redirect');
  });

  it('lands on the root of the source tree only, and never inside a mirror', async () => {
    const dir = root(PAGE);
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en', render: { redirect: true } }));
    const read = (...parts: string[]): string => readFileSync(join(dir, 'dist', ...parts), 'utf8');

    expect(read('index.html')).toContain('verbaly:redirect');
    // a mirror page is the destination: routing away from it is the loop
    expect(read('es', 'index.html')).not.toContain('verbaly:redirect');
    // a crawler must reach a deep page without being sent elsewhere
    expect(read('docs', 'index.html')).not.toContain('verbaly:redirect');
  });

  it('on: all covers every page of the source tree', async () => {
    const dir = root(PAGE);
    const render = { redirect: { on: 'all' as const } };
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en', render }));
    expect(readFileSync(join(dir, 'dist', 'docs', 'index.html'), 'utf8')).toContain(
      'verbaly:redirect',
    );
  });

  it('runs before anything can paint: first thing inside <head>', async () => {
    const dir = root(PAGE);
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en', render: { redirect: true } }));
    expect(readFileSync(join(dir, 'dist', 'index.html'), 'utf8')).toContain(
      '<head><!--verbaly:redirect-->',
    );
  });

  it('carries the locales, the source and the storage key it will read', async () => {
    const dir = root(PAGE);
    const render = { redirect: { storageKey: 'v-locale' } };
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en', render }));
    const html = readFileSync(join(dir, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('S=["en","es"]');
    expect(html).toContain('D="en"');
    expect(html).toContain('K="v-locale"');
  });

  it('defaults the storage key to the one persistLocale writes, and false turns storage off', async () => {
    const withDefault = root(PAGE);
    await renderSite(
      resolveConfig({ root: withDefault, sourceLocale: 'en', render: { redirect: true } }),
    );
    expect(readFileSync(join(withDefault, 'dist', 'index.html'), 'utf8')).toContain(
      'K="verbaly-locale"',
    );

    const off = root(PAGE);
    const render = { redirect: { storageKey: false as const } };
    await renderSite(resolveConfig({ root: off, sourceLocale: 'en', render }));
    expect(readFileSync(join(off, 'dist', 'index.html'), 'utf8')).toContain('K=null');
  });

  it('stays idempotent: a second run writes the same script once', async () => {
    const dir = root(PAGE);
    const cfg = resolveConfig({ root: dir, sourceLocale: 'en', render: { redirect: true } });
    await renderSite(cfg);
    const once = readFileSync(join(dir, 'dist', 'index.html'), 'utf8');
    await renderSite(cfg);
    expect(readFileSync(join(dir, 'dist', 'index.html'), 'utf8')).toBe(once);
    expect(once.match(/verbaly:redirect-->/g)).toHaveLength(2);
  });

  it('a page with no head is left alone instead of guessing where to put it', async () => {
    const dir = root('<body>y</body>');
    await renderSite(resolveConfig({ root: dir, sourceLocale: 'en', render: { redirect: true } }));
    expect(readFileSync(join(dir, 'dist', 'index.html'), 'utf8')).not.toContain('verbaly:redirect');
  });
});

describe('what the redirect script does when it runs', () => {
  const OPEN = '<!--verbaly:redirect--><script>';

  function scriptFor(options: Partial<Parameters<typeof renderHtml>[1]['redirect']> = {}): string {
    const { html } = renderHtml('<html><head></head><body></body></html>', {
      locale: 'en',
      catalogs: CATALOGS,
      redirect: { locales: ['en', 'es', 'pt'], sourceLocale: 'en', ...options },
    });
    return html.slice(html.indexOf(OPEN) + OPEN.length, html.indexOf('</script>'));
  }

  interface Visit {
    path: string;
    search?: string;
    hash?: string;
    stored?: string | null;
    languages?: string[];
    blockStorage?: boolean;
  }

  // globals are shadowed as parameters, so the script runs exactly as shipped with no DOM at all
  function visit(script: string, page: Visit): string | undefined {
    let target: string | undefined;
    const location = {
      pathname: page.path,
      search: page.search ?? '',
      hash: page.hash ?? '',
      replace: (url: string) => {
        target = url;
      },
    };
    const localStorage = {
      getItem: (): string | null => {
        if (page.blockStorage) throw new Error('blocked');
        return page.stored ?? null;
      },
    };
    const languages = page.languages ?? ['en'];
    const navigator = { languages, language: languages[0] };
    new Function('location', 'localStorage', 'navigator', script)(
      location,
      localStorage,
      navigator,
    );
    return target;
  }

  const script = scriptFor();

  it('sends a visitor whose browser asks for a mirror', () => {
    expect(visit(script, { path: '/', languages: ['es-PE', 'en'] })).toBe('/es/');
    expect(visit(script, { path: '/docs', languages: ['pt-BR'] })).toBe('/pt/docs');
  });

  it('leaves a visitor whose language is the source tree they already have', () => {
    expect(visit(script, { path: '/', languages: ['en-US'] })).toBeUndefined();
    expect(visit(script, { path: '/', languages: ['de', 'fr'] })).toBeUndefined();
  });

  it('never fires inside a mirror, which is what makes a loop impossible', () => {
    expect(visit(script, { path: '/es/', languages: ['pt'] })).toBeUndefined();
    expect(visit(script, { path: '/pt/docs', languages: ['es'] })).toBeUndefined();
  });

  it('a saved choice beats the browser, including the choice to stay in the source', () => {
    expect(visit(script, { path: '/', stored: 'pt', languages: ['es'] })).toBe('/pt/');
    expect(visit(script, { path: '/', stored: 'en', languages: ['es'] })).toBeUndefined();
    expect(visit(script, { path: '/', stored: 'fr', languages: ['es'] })).toBe('/es/');
  });

  it('carries the query and the hash to the mirror', () => {
    expect(visit(script, { path: '/docs', search: '?q=1', hash: '#top', languages: ['es'] })).toBe(
      '/es/docs?q=1#top',
    );
  });

  it('reads a page slug as a page, not as the mirror it is standing in', () => {
    expect(visit(script, { path: '/es-la-guia', languages: ['es'] })).toBe('/es/es-la-guia');
  });

  it('survives blocked storage and falls through to the browser', () => {
    expect(visit(script, { path: '/', blockStorage: true, languages: ['pt'] })).toBe('/pt/');
  });

  it('with storage off it never reads a saved choice', () => {
    const noStorage = scriptFor({ storageKey: false });
    expect(visit(noStorage, { path: '/', stored: 'pt', languages: ['es'] })).toBe('/es/');
  });

  it('under a base path it stays inside the base, and outside it does nothing', () => {
    const based = scriptFor({ base: '/app' });
    expect(visit(based, { path: '/app/', languages: ['es'] })).toBe('/app/es/');
    expect(visit(based, { path: '/app', languages: ['es'] })).toBe('/app/es/');
    expect(visit(based, { path: '/app/es/', languages: ['pt'] })).toBeUndefined();
    expect(visit(based, { path: '/application', languages: ['es'] })).toBeUndefined();
    expect(visit(based, { path: '/elsewhere', languages: ['es'] })).toBeUndefined();
  });
});

describe('renderSite: the head is half the page a search result shows', () => {
  function site(page: string): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-head-'));
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify(CATALOGS.en));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify(CATALOGS.es));
    writeFileSync(join(root, 'dist', 'index.html'), page);
    return root;
  }

  it('names the pages whose title never varies', async () => {
    const root = site(
      '<html><head><title>Search and find</title></head>' +
        '<body><h1 data-verbaly="home.hint">x</h1></body></html>',
    );
    const result = await renderSite(resolveConfig({ root, sourceLocale: 'en' }));
    expect(result.untranslatedHead).toEqual(['index.html']);
  });

  it('says nothing when the title carries a key, and fills it', async () => {
    const root = site(
      '<html><head><title data-verbaly="home.hint">Search and find</title></head>' +
        '<body><h1 data-verbaly="home.hint">x</h1></body></html>',
    );
    const result = await renderSite(resolveConfig({ root, sourceLocale: 'en' }));
    expect(result.untranslatedHead).toEqual([]);
    const es = readFileSync(join(root, 'dist', 'es', 'index.html'), 'utf8');
    expect(es).toContain('<title data-verbaly="home.hint">Busca y encuentra</title>');
  });

  it('fills a meta description through the attribute path, guards included', async () => {
    const root = site(
      '<html><head><title data-verbaly="home.hint">x</title>' +
        `<meta name="description" content="x" data-verbaly-attr='{"content":"home.hint"}'>` +
        '</head><body></body></html>',
    );
    await renderSite(resolveConfig({ root, sourceLocale: 'en' }));
    const es = readFileSync(join(root, 'dist', 'es', 'index.html'), 'utf8');
    expect(es).toContain('content="Busca y encuentra"');
  });

  it('never flags a redirect stub: it is no search result', async () => {
    const root = site(
      '<html><head><meta http-equiv="refresh" content="0;url=/docs/init/what-is">' +
        '<title>Redirecting</title></head><body></body></html>',
    );
    const result = await renderSite(resolveConfig({ root, sourceLocale: 'en' }));
    expect(result.untranslatedHead).toEqual([]);
  });

  it('stays quiet with one locale: there is no second title to disagree with', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-head-'));
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify(CATALOGS.en));
    writeFileSync(join(root, 'dist', 'index.html'), '<html><head><title>x</title></head></html>');
    const result = await renderSite(resolveConfig({ root, sourceLocale: 'en', locales: ['en'] }));
    expect(result.untranslatedHead).toEqual([]);
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

  it('keeps the mirror navigable: its links point at its own pages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'docs'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify(CATALOGS.en));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify(CATALOGS.es));
    const home = '<html><body><a href="/docs">d</a><a href="/style.css">s</a></body></html>';
    writeFileSync(join(dist, 'index.html'), home);
    writeFileSync(join(dist, 'docs', 'index.html'), '<html><body>docs</body></html>');

    await renderSite(resolveConfig({ root, sourceLocale: 'en' }));

    const es = readFileSync(join(dist, 'es', 'index.html'), 'utf8');
    expect(es).toContain('href="/es/docs"');
    expect(es).toContain('href="/style.css"');
    // the source locale is the site itself, it was never a mirror
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toContain('href="/docs"');
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

  it('lists only pages a crawler should index, and still mirrors the rest', async () => {
    // 21 of our own 81 urls were redirect stubs and 404s, listed as if they were results
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'docs'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<html><head></head><body></body></html>');
    writeFileSync(
      join(dist, '404.html'),
      '<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>',
    );
    writeFileSync(
      join(dist, 'docs', 'index.html'),
      '<html><head><meta http-equiv="refresh" content="0;url=/docs/start"></head><body></body></html>',
    );

    const cfg = resolveConfig({
      root,
      sourceLocale: 'en',
      render: { baseUrl: 'https://verb.dev', sitemap: true },
    });
    await renderSite(cfg);
    const xml = readFileSync(join(dist, 'sitemap-i18n.xml'), 'utf8');
    expect((xml.match(/<loc>/g) ?? []).length).toBe(2); // the home, in two locales
    expect(xml).not.toContain('404');
    expect(xml).not.toContain('/docs');
    // both still travel to the mirror: a visitor reaching /es/docs must get the redirect
    expect(existsSync(join(dist, 'es', '404.html'))).toBe(true);
    expect(existsSync(join(dist, 'es', 'docs', 'index.html'))).toBe(true);
  });

  it('takes an explicit exclude for a page that is indexable and still not ours to list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-render-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(dist, 'internal'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ k: 'Hi' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ k: 'Hola' }));
    writeFileSync(join(dist, 'index.html'), '<html><head></head><body></body></html>');
    writeFileSync(join(dist, 'internal', 'index.html'), '<html><head></head><body></body></html>');

    const cfg = resolveConfig({
      root,
      sourceLocale: 'en',
      render: { baseUrl: 'https://verb.dev', sitemap: true, exclude: ['internal/**'] },
    });
    await renderSite(cfg);
    const xml = readFileSync(join(dist, 'sitemap-i18n.xml'), 'utf8');
    expect(xml).not.toContain('/internal');
    expect((xml.match(/<loc>/g) ?? []).length).toBe(2);
    expect(existsSync(join(dist, 'es', 'internal', 'index.html'))).toBe(true);
  });

  it('writes the sitemap under a custom filename when sitemap is a string', async () => {
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
      render: { baseUrl: 'https://verb.dev', sitemap: 'custom.xml' },
    });
    await renderSite(cfg);
    expect(existsSync(join(dist, 'sitemap-i18n.xml'))).toBe(false);
    const xml = readFileSync(join(dist, 'custom.xml'), 'utf8');
    expect(xml).toContain('<loc>https://verb.dev/</loc>');
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

    const cfg = resolveConfig({
      root,
      sourceLocale: 'en',
      render: { baseUrl: 'https://verb.dev' },
    });
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
