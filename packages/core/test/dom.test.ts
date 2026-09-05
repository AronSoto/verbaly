// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDom, inlineMessages, normalizeLink, safeAttribute, safeHref } from '../src/dom';
import { createVerbaly } from '../src/instance';
import { persistLocale } from '../src/locale';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  document.body.innerHTML = `
    <h1 data-verbaly="home.title"></h1>
    <p id="inbox" data-verbaly="inbox" data-verbaly-args='{"count":3}'></p>
  `;
  const v = createVerbaly({
    locale: 'es',
    messages: {
      es: {
        home: { title: 'Hola' },
        inbox: '{count | one: un mensaje | other: # mensajes}',
      },
      en: {
        home: { title: 'Hello' },
        inbox: '{count | one: one message | other: # messages}',
      },
    },
  });
  return v;
}

let unbind: (() => void) | undefined;

afterEach(() => {
  unbind?.();
  unbind = undefined;
  document.body.innerHTML = '';
});

describe('bindDom', () => {
  it('renders on bind', () => {
    const v = setup();
    unbind = bindDom(v);
    expect(document.querySelector('h1')?.textContent).toBe('Hola');
    expect(document.querySelector('#inbox')?.textContent).toBe('3 mensajes');
  });

  it('re-renders on locale change', () => {
    const v = setup();
    unbind = bindDom(v);
    v.setLocale('en');
    expect(document.querySelector('h1')?.textContent).toBe('Hello');
    expect(document.querySelector('#inbox')?.textContent).toBe('3 messages');
  });

  it('renders nodes added later', async () => {
    const v = setup();
    unbind = bindDom(v);
    const el = document.createElement('span');
    el.setAttribute('data-verbaly', 'home.title');
    document.body.appendChild(el);
    await tick();
    expect(el.textContent).toBe('Hola');
  });

  it('re-renders on attribute change', async () => {
    const v = setup();
    unbind = bindDom(v);
    const inbox = document.querySelector('#inbox')!;
    inbox.setAttribute('data-verbaly-args', '{"count":1}');
    await tick();
    expect(inbox.textContent).toBe('un mensaje');
  });

  it('stops after unbind', () => {
    const v = setup();
    const stop = bindDom(v);
    stop();
    v.setLocale('en');
    expect(document.querySelector('h1')?.textContent).toBe('Hola');
  });

  it('ignores invalid args JSON', () => {
    const v = setup();
    const el = document.createElement('i');
    el.setAttribute('data-verbaly', 'home.title');
    el.setAttribute('data-verbaly-args', '{oops');
    document.body.appendChild(el);
    unbind = bindDom(v);
    expect(el.textContent).toBe('Hola');
  });

  it('translates attributes', () => {
    const v = setup();
    const input = document.createElement('input');
    input.setAttribute('data-verbaly-attr', '{"placeholder":"home.title"}');
    document.body.appendChild(input);
    unbind = bindDom(v);
    expect(input.getAttribute('placeholder')).toBe('Hola');
    v.setLocale('en');
    expect(input.getAttribute('placeholder')).toBe('Hello');
  });

  it('blocks event handler attributes', () => {
    const v = setup();
    const el = document.createElement('button');
    el.setAttribute('data-verbaly-attr', '{"onclick":"home.title","title":"home.title"}');
    document.body.appendChild(el);
    unbind = bindDom(v);
    expect(el.getAttribute('onclick')).toBeNull();
    expect(el.getAttribute('title')).toBe('Hola');
  });

  it('blocks style and srcdoc attributes', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { css: 'color:red', doc: '<script>1</script>', ok: 'Hola' } },
    });
    const el = document.createElement('iframe');
    el.setAttribute('data-verbaly-attr', '{"style":"css","srcdoc":"doc","title":"ok"}');
    document.body.appendChild(el);
    unbind = bindDom(v);
    expect(el.getAttribute('style')).toBeNull();
    expect(el.getAttribute('srcdoc')).toBeNull();
    expect(el.getAttribute('title')).toBe('Hola');
  });

  it('sanitizes URL attributes: unsafe schemes never land', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { evil: 'javascript:alert(1)', ok: '/es/docs' } },
    });
    const a = document.createElement('a');
    a.setAttribute('data-verbaly-attr', '{"href":"evil","title":"ok"}');
    const img = document.createElement('img');
    img.setAttribute('data-verbaly-attr', '{"src":"evil"}');
    document.body.append(a, img);
    unbind = bindDom(v);
    expect(a.getAttribute('href')).toBeNull();
    expect(a.getAttribute('title')).toBe('/es/docs');
    expect(img.getAttribute('src')).toBeNull();
    warn.mockRestore();
  });

  it('skips non-string attr map values', () => {
    const v = setup();
    const el = document.createElement('span');
    el.setAttribute('data-verbaly-attr', '{"title":"home.title","tabindex":3}');
    document.body.appendChild(el);
    unbind = bindDom(v);
    expect(el.getAttribute('title')).toBe('Hola');
    expect(el.hasAttribute('tabindex')).toBe(false);
  });

  it('accepts document as root', async () => {
    const v = setup();
    unbind = bindDom(v, { root: document });
    expect(document.querySelector('h1')?.textContent).toBe('Hola');
    const el = document.createElement('span');
    el.setAttribute('data-verbaly', 'home.title');
    document.body.appendChild(el);
    await tick();
    expect(el.textContent).toBe('Hola');
  });

  it('safe URL attributes pass through', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { url: '/es/inicio' } } });
    const a = document.createElement('a');
    a.setAttribute('data-verbaly-attr', '{"href":"url"}');
    document.body.appendChild(a);
    unbind = bindDom(v);
    expect(a.getAttribute('href')).toBe('/es/inicio');
  });
});

describe('safeHref / normalizeLink', () => {
  it('blocks data: and vbscript: schemes (not just javascript:)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(safeHref('data:text/html,<script>1</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox')).toBeUndefined();
    expect(safeHref(' \tJAVASCRIPT:alert(1)')).toBeUndefined();
    expect(safeHref('https://x.dev')).toBe('https://x.dev');
    warn.mockRestore();
  });

  it('normalizeLink expands strings and applies safeHref', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeLink('/docs')).toEqual({ href: '/docs', target: undefined, rel: undefined });
    expect(normalizeLink({ href: 'https://x.dev', target: '_blank', rel: 'noopener' })).toEqual({
      href: 'https://x.dev',
      target: '_blank',
      rel: 'noopener',
    });
    expect(normalizeLink('javascript:alert(1)').href).toBeUndefined();
    warn.mockRestore();
  });

  it('safeAttribute blocks handler/style/srcdoc names and unsafe URLs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(safeAttribute('onclick', 'x')).toBeUndefined();
    expect(safeAttribute('style', 'x')).toBeUndefined();
    expect(safeAttribute('SRCDOC', 'x')).toBeUndefined();
    expect(safeAttribute('href', 'javascript:alert(1)')).toBeUndefined();
    expect(safeAttribute('href', '/docs')).toBe('/docs');
    expect(safeAttribute('title', 'hola')).toBe('hola');
    warn.mockRestore();
  });
});

function setupRich() {
  document.body.innerHTML = '';
  return createVerbaly({
    locale: 'es',
    messages: {
      es: {
        gate: 'El <em>gate</em> del build',
        nested: 'usa <strong>texto <code>plano</code></strong> aquí',
        inbox: 'tienes <strong>{count}</strong> mensajes',
        evil: 'hola <script>alert(1)</script> mundo',
        custom: 'texto <q>citado</q>',
        braces: 'usa <code>&#123;fecha:relative&#125;</code> con {n} valores',
        broke: 'una línea<br/>otra línea',
        voidChildren: 'una línea<br>colgada</br>otra',
      },
      en: {
        gate: 'The build <em>gate</em>',
      },
    },
  });
}

function richEl(key: string, args?: string): HTMLElement {
  const el = document.createElement('p');
  el.setAttribute('data-verbaly', key);
  el.setAttribute('data-verbaly-rich', '');
  if (args) el.setAttribute('data-verbaly-args', args);
  document.body.appendChild(el);
  return el;
}

// what bundle.exclude ships: the mirror pre-filled the node and no client catalog carries the key
function buildOnlyPage(): { land: () => void; instance: ReturnType<typeof createVerbaly> } {
  document.documentElement.lang = 'es';
  document.body.innerHTML =
    '<h1 data-verbaly="notes.v1.title" data-verbaly-attr=\'{"title":"notes.v1.theme"}\'' +
    ' title="Tema">Título en español</h1>';
  let land = (): void => {};
  const instance = createVerbaly({
    locale: 'es',
    fallback: 'en',
    messages: { en: { nav: { docs: 'Docs' } } },
    loaders: {
      es: () =>
        new Promise((resolve) => {
          land = () => resolve({ nav: { docs: 'Documentación' } });
        }),
    },
  });
  return { land, instance: instance as never };
}

// what verbaly render ships: html already in the target locale, waiting for its catalog
function mirrorPage(lang = 'es'): { land: () => void; instance: ReturnType<typeof createVerbaly> } {
  document.documentElement.lang = lang;
  document.body.innerHTML = '<h1 data-verbaly="title" title="Hola">Hola mundo</h1>';
  let land = (): void => {};
  const instance = createVerbaly({
    locale: 'es',
    fallback: 'en',
    messages: { en: { title: 'Hello world' } },
    loaders: {
      es: () =>
        new Promise((resolve) => {
          land = () => resolve({ title: 'Hola mundo' });
        }),
    },
  });
  return { land, instance: instance as never };
}

describe('bindDom over a pre-rendered page', () => {
  afterEach(() => {
    document.documentElement.lang = '';
  });

  it('does not repaint server html with a fallback while the catalog is still loading', () => {
    const page = mirrorPage();
    unbind = bindDom(page.instance);
    expect(document.querySelector('h1')!.textContent).toBe('Hola mundo');
  });

  it('paints an empty element anyway: there is nothing to protect there', () => {
    const page = mirrorPage();
    document.body.innerHTML = '<h1 data-verbaly="title"></h1>';
    unbind = bindDom(page.instance);
    expect(document.querySelector('h1')!.textContent).toBe('Hello world');
  });

  it('leaves a pre-rendered attribute alone too', () => {
    const page = mirrorPage();
    document.body.innerHTML =
      '<h1 data-verbaly-attr=\'{"title":"title"}\' title="Hola mundo"></h1>';
    unbind = bindDom(page.instance);
    expect(document.querySelector('h1')!.getAttribute('title')).toBe('Hola mundo');
  });

  it('repaints once the catalog lands', async () => {
    const page = mirrorPage();
    unbind = bindDom(page.instance);
    void page.instance.loadLocale('es');
    page.land();
    await tick();
    expect(document.querySelector('h1')!.textContent).toBe('Hola mundo');
  });

  it('stops trusting the dom after the first pass: a stale value loses to a real fallback', () => {
    document.documentElement.lang = 'es';
    document.body.innerHTML = '<h1 data-verbaly="title">Hola mundo</h1>';
    const v = createVerbaly({
      locale: 'es',
      fallback: 'en',
      messages: { en: { title: 'Hello world' }, es: { title: 'Hola mundo' } },
    });
    unbind = bindDom(v);
    expect(document.querySelector('h1')!.textContent).toBe('Hola mundo');
    v.setLocale('fr'); // no fr catalog: the en fallback must win over the stale spanish
    expect(document.querySelector('h1')!.textContent).toBe('Hello world');
  });

  it('re-arms on every bind, so a view transition swapping in new server html is protected too', () => {
    const page = mirrorPage();
    unbind = bindDom(page.instance);
    unbind();
    document.body.innerHTML = '<h1 data-verbaly="title">Otra página</h1>';
    unbind = bindDom(page.instance);
    expect(document.querySelector('h1')!.textContent).toBe('Otra página');
  });

  it('keeps text no catalog can resolve, and the catalog landing does not change that', async () => {
    const page = buildOnlyPage();
    unbind = bindDom(page.instance);
    expect(document.querySelector('h1')!.textContent).toBe('Título en español');
    page.land();
    await tick();
    expect(document.querySelector('h1')!.textContent).toBe('Título en español');
  });

  it('keeps an attribute no catalog can resolve, through the same landing', async () => {
    const page = buildOnlyPage();
    unbind = bindDom(page.instance);
    page.land();
    await tick();
    expect(document.querySelector('h1')!.getAttribute('title')).toBe('Tema');
  });

  it('names the key whose text it kept', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<h1 data-verbaly="notes.v2.title">Título</h1>';
    const v = createVerbaly({ locale: 'es', messages: { es: { nav: { docs: 'Docs' } } } });
    unbind = bindDom(v);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notes.v2.title'));
    warn.mockRestore();
  });

  it('samples that report once per bind: a build-only group is hundreds of keys, not a bug', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = Array.from(
      { length: 40 },
      (_, i) => `<p data-verbaly="notes.v4.k${i}">Texto ${i}</p>`,
    ).join('');
    const v = createVerbaly({ locale: 'es', messages: { es: { nav: { docs: 'Docs' } } } });
    unbind = bindDom(v);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('p')[39]!.textContent).toBe('Texto 39');
    warn.mockRestore();
  });

  it('fills an empty element with the raw key anyway: there is nothing to protect there', () => {
    document.body.innerHTML = '<h1 data-verbaly="notes.v3.title"></h1>';
    const v = createVerbaly({ locale: 'es', messages: { es: { nav: { docs: 'Docs' } } } });
    unbind = bindDom(v);
    expect(document.querySelector('h1')!.textContent).toBe('notes.v3.title');
  });

  it('warns when the page language and the instance disagree, naming both', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.documentElement.lang = 'es';
    document.body.innerHTML = '<h1 data-verbaly="title">Hola mundo</h1>';
    const v = createVerbaly({ locale: 'en', messages: { en: { title: 'Hello world' } } });
    unbind = bindDom(v);
    expect(warn.mock.calls[0]![0]).toContain('<html lang="es"> and this instance is in "en"');
    // both url strategies get a remedy: the old text only knew about the one with a prefix
    expect(warn.mock.calls[0]![0]).toContain('localeFromPath');
    expect(warn.mock.calls[0]![0]).toContain('persistLocale');
    warn.mockRestore();
  });

  it('a site with no locale in the url can silence it by syncing lang first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.documentElement.lang = 'en';
    document.body.innerHTML = '<h1 data-verbaly="title">Hello</h1>';
    const v = createVerbaly({ locale: 'pt', messages: { pt: { title: 'Ola' } } });
    persistLocale('pt', false); // the remedy the warning now names
    unbind = bindDom(v);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stays quiet when the page language only differs by region', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.documentElement.lang = 'es-419';
    document.body.innerHTML = '<h1 data-verbaly="title">Hola</h1>';
    const v = createVerbaly({ locale: 'es', messages: { es: { title: 'Hola' } } });
    unbind = bindDom(v);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('bindDom rich', () => {
  it('builds whitelisted elements', () => {
    const v = setupRich();
    const el = richEl('gate');
    unbind = bindDom(v);
    expect(el.innerHTML).toBe('El <em>gate</em> del build');
    expect(el.querySelector('em')?.textContent).toBe('gate');
  });

  it('gives a void tag no children: the html renderer has to match this exactly', () => {
    const v = setupRich();
    const el = richEl('broke');
    unbind = bindDom(v);
    expect(el.querySelectorAll('br')).toHaveLength(1);
    expect(el.innerHTML).toBe('una línea<br>otra línea');
  });

  it('drops what a message nests inside a void tag instead of hiding it in the dom', () => {
    const v = setupRich();
    const el = richEl('voidChildren');
    unbind = bindDom(v);
    expect(el.querySelector('br')?.childNodes).toHaveLength(0);
    expect(el.textContent).toBe('una líneaotra');
  });

  it('renders nested tags', () => {
    const v = setupRich();
    const el = richEl('nested');
    unbind = bindDom(v);
    expect(el.querySelector('strong code')?.textContent).toBe('plano');
    expect(el.textContent).toBe('usa texto plano aquí');
  });

  it('formats params inside tags', () => {
    const v = setupRich();
    const el = richEl('inbox', '{"count":3}');
    unbind = bindDom(v);
    expect(el.querySelector('strong')?.textContent).toBe('3');
  });

  it('re-renders on locale change', () => {
    const v = setupRich();
    const el = richEl('gate');
    unbind = bindDom(v);
    v.setLocale('en');
    expect(el.innerHTML).toBe('The build <em>gate</em>');
    expect(el.querySelectorAll('em')).toHaveLength(1);
  });

  it('unwraps non-whitelisted tags as inert text', () => {
    const v = setupRich();
    const el = richEl('evil');
    unbind = bindDom(v);
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe('hola alert(1) mundo');
  });

  it('accepts a custom whitelist', () => {
    const v = setupRich();
    const el = richEl('custom');
    unbind = bindDom(v, { richTags: ['q'] });
    expect(el.querySelector('q')?.textContent).toBe('citado');
  });

  it('numeric entities render literal braces without touching real params', () => {
    const v = setupRich();
    const el = richEl('braces', '{"n":2}');
    unbind = bindDom(v);
    expect(el.querySelector('code')?.textContent).toBe('{fecha:relative}');
    expect(el.textContent).toBe('usa {fecha:relative} con 2 valores');
  });

  it('without the rich attribute tags stay literal', () => {
    const v = setupRich();
    const el = document.createElement('p');
    el.setAttribute('data-verbaly', 'gate');
    document.body.appendChild(el);
    unbind = bindDom(v);
    expect(el.textContent).toBe('El <em>gate</em> del build');
    expect(el.querySelector('em')).toBeNull();
  });
});

function setupLinks() {
  document.body.innerHTML = '';
  return createVerbaly({
    locale: 'es',
    messages: {
      es: {
        guide: 'Lee la <docs>guía</docs> completa',
        both: 'Ve a <docs><em>docs</em></docs> o al <repo>repo</repo>',
        evil: 'clic <bad>aquí</bad>',
      },
      en: {
        guide: 'Read the full <docs>guide</docs>',
      },
    },
  });
}

describe('bindDom rich links', () => {
  it('renders named links from richLinks', () => {
    const v = setupLinks();
    const el = richEl('guide');
    unbind = bindDom(v, { richLinks: { docs: '/docs' } });
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/docs');
    expect(a?.textContent).toBe('guía');
    expect(el.textContent).toBe('Lee la guía completa');
  });

  it('supports object form with target and rel', () => {
    const v = setupLinks();
    const el = richEl('guide');
    unbind = bindDom(v, {
      richLinks: { docs: { href: 'https://x.dev', target: '_blank', rel: 'noopener' } },
    });
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://x.dev');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
  });

  it('reads per-element data-verbaly-links and merges over globals', () => {
    const v = setupLinks();
    const el = richEl('both');
    el.setAttribute('data-verbaly-links', '{"repo":"https://github.com/x"}');
    unbind = bindDom(v, { richLinks: { docs: '/docs' } });
    const anchors = el.querySelectorAll('a');
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getAttribute('href')).toBe('/docs');
    expect(anchors[0]?.querySelector('em')?.textContent).toBe('docs');
    expect(anchors[1]?.getAttribute('href')).toBe('https://github.com/x');
  });

  it('re-renders links on locale change', () => {
    const v = setupLinks();
    const el = richEl('guide');
    unbind = bindDom(v, { richLinks: { docs: '/docs' } });
    v.setLocale('en');
    expect(el.textContent).toBe('Read the full guide');
    expect(el.querySelectorAll('a')).toHaveLength(1);
  });

  it('blocks javascript: hrefs', () => {
    const v = setupLinks();
    const el = richEl('evil');
    unbind = bindDom(v, { richLinks: { bad: 'javascript:alert(1)' } });
    const a = el.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('clic aquí');
  });

  it('per-element links work without global richLinks', () => {
    const v = setupLinks();
    const el = richEl('guide');
    el.setAttribute('data-verbaly-links', '{"docs":"/guia"}');
    unbind = bindDom(v);
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/guia');
  });

  it('invalid links JSON falls back to global richLinks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = setupLinks();
    const el = richEl('guide');
    el.setAttribute('data-verbaly-links', '{oops');
    unbind = bindDom(v, { richLinks: { docs: '/docs' } });
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/docs');
    warn.mockRestore();
  });

  it('unknown link names still unwrap', () => {
    const v = setupLinks();
    const el = richEl('guide');
    unbind = bindDom(v); // no links at all
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('Lee la guía completa');
  });
});

describe('bindDom and the head', () => {
  it('names the head it cannot reach instead of leaving the title in the source language', () => {
    document.head.innerHTML = '<title data-verbaly="greet">Hello</title>';
    document.body.innerHTML = '<p data-verbaly="greet">Hello</p>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly({ locale: 'es', messages: { es: { greet: 'Hola' } } });

    const stop = bindDom(v);

    expect(document.body.textContent).toBe('Hola');
    expect(document.title).toBe('Hello');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('{ root: document }'));
    stop();
    warn.mockRestore();
    document.head.innerHTML = '';
  });

  it('reaches the title when the root says so', () => {
    document.head.innerHTML = '<title data-verbaly="bye">Bye</title>';
    document.body.innerHTML = '<p data-verbaly="bye">Bye</p>';
    const v = createVerbaly({ locale: 'es', messages: { es: { bye: 'Chau' } } });

    const stop = bindDom(v, { root: document });

    expect(document.title).toBe('Chau');
    expect(document.body.textContent).toBe('Chau');
    stop();
    document.head.innerHTML = '';
  });
});

describe('inlineMessages', () => {
  it('reads the slice the mirror inlined in the page', () => {
    document.body.innerHTML =
      '<script data-verbaly-catalog type="application/json">{"a":"La A"}</script>';
    expect(inlineMessages(document)).toEqual({ a: 'La A' });
  });

  it('answers undefined on a page that carries none', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(inlineMessages(document)).toBeUndefined();
  });

  // one test for both breakages because they share one message, and warnOnce fires a message once
  it('never crashes on a broken blob, and says so instead of degrading quietly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    document.body.innerHTML = '<script data-verbaly-catalog>{ not json</script>';
    expect(inlineMessages(document)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a usable object'));

    document.body.innerHTML = '<script data-verbaly-catalog>["a","b"]</script>';
    expect(inlineMessages(document)).toBeUndefined();
    warn.mockRestore();
  });
});
