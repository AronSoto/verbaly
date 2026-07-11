// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDom, normalizeLink, safeHref } from '../src/dom';
import { createVerbaly } from '../src/instance';

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

  it('sanitizes URL attributes — unsafe schemes never land', () => {
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

describe('bindDom rich', () => {
  it('builds whitelisted elements', () => {
    const v = setupRich();
    const el = richEl('gate');
    unbind = bindDom(v);
    expect(el.innerHTML).toBe('El <em>gate</em> del build');
    expect(el.querySelector('em')?.textContent).toBe('gate');
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

  it('unknown link names still unwrap', () => {
    const v = setupLinks();
    const el = richEl('guide');
    unbind = bindDom(v); // no links at all
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('Lee la guía completa');
  });
});
