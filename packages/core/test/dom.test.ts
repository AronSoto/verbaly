// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bindDom } from '../src/dom';
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
});
