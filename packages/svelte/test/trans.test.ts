import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { createVerbaly } from 'verbaly';
import Trans from '../src/Trans.svelte';
import App from './fixtures/App.svelte';

function setup() {
  return createVerbaly({
    locale: 'en',
    fallback: 'en',
    messages: {
      en: {
        title: 'The <em>build</em> gate',
        greet: 'Hi {name}',
        nested: '<strong>very <em>deep</em></strong>',
        unsafe: 'bad <script>alert(1)</script> text',
        unknown: 'a <banana>b</banana> c',
      },
      es: { title: 'El gate del <em>build</em>' },
    },
  });
}

function render(component: unknown, props: Record<string, unknown>) {
  const target = document.createElement('div');
  const app = mount(component as never, { target, props });
  flushSync();
  return { target, app };
}

// svelte 5 leaves comment anchors in the DOM
function htmlOf(target: Element): string {
  return target.innerHTML.replace(/<!---->/g, '');
}

describe('<Trans>', () => {
  it('renders whitelisted tags as real elements', () => {
    const { target } = render(Trans, { id: 'title', instance: setup() });
    expect(htmlOf(target)).toContain('The <em>build</em> gate');
  });

  it('renders nested tags', () => {
    const { target } = render(Trans, { id: 'nested', instance: setup() });
    expect(htmlOf(target)).toContain('<strong>very <em>deep</em></strong>');
  });

  it('formats params', () => {
    const { target } = render(Trans, { id: 'greet', instance: setup(), values: { name: 'Aron' } });
    expect(target.textContent).toContain('Hi Aron');
  });

  it('unwraps non-whitelisted tags to inert text', () => {
    const { target } = render(Trans, { id: 'unsafe', instance: setup() });
    expect(target.querySelector('script')).toBeNull();
    expect(target.textContent).toContain('bad alert(1) text');
  });

  it('unwraps unknown tags', () => {
    const { target } = render(Trans, { id: 'unknown', instance: setup() });
    expect(target.querySelector('banana')).toBeNull();
    expect(target.textContent).toContain('a b c');
  });

  it('honors a custom richTags whitelist', () => {
    const { target } = render(Trans, { id: 'title', instance: setup(), richTags: ['strong'] });
    expect(target.querySelector('em')).toBeNull();
    expect(target.textContent).toContain('The build gate');
  });

  it('re-renders on locale change', () => {
    const v = setup();
    const { target } = render(Trans, { id: 'title', instance: v });
    v.setLocale('es');
    flushSync();
    expect(htmlOf(target)).toContain('El gate del <em>build</em>');
  });

  it('unsubscribes on unmount', () => {
    const v = setup();
    const { target, app } = render(Trans, { id: 'title', instance: v });
    unmount(app);
    v.setLocale('es'); // must not throw on a dead component
    flushSync();
    expect(htmlOf(target)).not.toContain('El gate');
  });

  it('falls back to the context instance from provideVerbaly', () => {
    const { target } = render(App, { id: 'title', instance: setup() });
    expect(htmlOf(target)).toContain('The <em>build</em> gate');
  });
});
