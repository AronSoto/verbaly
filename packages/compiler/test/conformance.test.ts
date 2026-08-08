import { describe, expect, it } from 'vitest';
import { bindDom, createVerbaly, type RichLink } from 'verbaly';
import { renderHtml } from '../src/render';

// render == runtime is the whole point of the feature: any divergence IS the FOUC it exists to kill
const MESSAGES: Record<string, string> = {
  plain: 'Hola mundo',
  rich: 'El <em>gate</em> del build',
  nested: 'usa <strong>texto <code>plano</code></strong> aquí',
  params: 'tienes <strong>{count}</strong> mensajes',
  br: 'una línea<br/>otra línea',
  brChildren: 'una<br>colgada</br>otra',
  wbr: 'súper<wbr/>largo',
  unknown: 'texto <q>citado</q> aquí',
  entity: 'usa <code>&#123;fecha&#125;</code> hoy',
  link: 'lee la <docs>guía</docs>',
  escaped: 'Search & find <not-a-tag>',
};

const LINKS: Record<string, RichLink> = { docs: { href: '/docs', rel: 'noopener' } };
const ARGS = '{"count":3}';

function hydrated(key: string): string {
  const v = createVerbaly({ locale: 'es', messages: { es: MESSAGES } });
  document.body.innerHTML = `<p data-verbaly="${key}" data-verbaly-rich data-verbaly-args='${ARGS}'></p>`;
  const unbind = bindDom(v, { richLinks: LINKS });
  const html = document.querySelector('p')!.innerHTML;
  unbind();
  return html;
}

// the shipped markup itself, not a re-parse: happy-dom forgives </br>, a real browser does not
function prerendered(key: string): string {
  const { html } = renderHtml(
    `<p data-verbaly="${key}" data-verbaly-rich data-verbaly-args='${ARGS}'></p>`,
    { locale: 'es', catalogs: { es: MESSAGES }, richLinks: LINKS },
  );
  return html.slice(html.indexOf('>') + 1, html.lastIndexOf('</p>'));
}

describe('render == runtime', () => {
  for (const key of Object.keys(MESSAGES)) {
    it(`agrees on "${key}"`, () => {
      expect(prerendered(key)).toBe(hydrated(key));
    });
  }
});
