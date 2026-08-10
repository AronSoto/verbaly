// @vitest-environment happy-dom
import { createVerbaly } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, type Component, type VNodeChild } from 'vue';
import { Trans, useLocale, useT, verbalyPlugin } from '../src/index';

function makeInstance() {
  return createVerbaly({
    locale: 'es',
    messages: {
      es: { hello: 'Hola {name}' },
      en: { hello: 'Hello {name}' },
    },
  });
}

function mount(component: Component, plugin?: ReturnType<typeof verbalyPlugin>) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(component);
  const errors: unknown[] = [];
  app.config.errorHandler = (error) => {
    errors.push(error);
  };
  if (plugin) app.use(plugin);
  app.mount(el);
  return { el, app, errors };
}

const Hello = defineComponent({
  setup() {
    const t = useT();
    return () => h('p', t('hello', { name: 'Aron' }));
  },
});

const Switcher = defineComponent({
  setup() {
    const locale = useLocale();
    return () =>
      h(
        'button',
        {
          onClick: () => {
            locale.value = 'en';
          },
        },
        locale.value,
      );
  },
});

describe('@verbaly/vue', () => {
  it('renders translations', () => {
    const v = makeInstance();
    const { el } = mount(Hello, verbalyPlugin(v));
    expect(el.textContent).toBe('Hola Aron');
  });

  it('useT keeps the full t surface: t.id works', () => {
    const IdUser = defineComponent({
      setup() {
        const t = useT();
        return () => h('p', t.id('hello')`Hello ${'Aron'}`);
      },
    });
    const { el } = mount(IdUser, verbalyPlugin(makeInstance()));
    expect(el.textContent).toBe('Hello Aron');
  });

  it('updates on locale change', async () => {
    const v = makeInstance();
    const { el } = mount(Hello, verbalyPlugin(v));
    v.setLocale('en');
    await nextTick();
    expect(el.textContent).toBe('Hello Aron');
  });

  it('updates when messages arrive', async () => {
    const v = makeInstance();
    const { el } = mount(Hello, verbalyPlugin(v));
    v.setLocale('pt');
    v.addMessages('pt', { hello: 'Olá {name}' });
    await nextTick();
    expect(el.textContent).toBe('Olá Aron');
  });

  // a lazy initial catalog landing after mount is the normal path since 0.37.0, not a rare one
  it('re-renders when the catalog of the initial locale lands after mount', async () => {
    let resolve!: (tree: Record<string, string>) => void;
    const v = createVerbaly({
      locale: 'es',
      fallback: 'en',
      messages: { en: { hello: 'Hello {name}' } },
      loaders: { es: () => new Promise((r) => (resolve = r)) },
    });
    const { el } = mount(Hello, verbalyPlugin(v));
    expect(el.textContent).toBe('Hello Aron');
    resolve({ hello: 'Hola {name}' });
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    expect(el.textContent).toBe('Hola Aron');
  });

  it('useLocale reads and sets', async () => {
    const v = makeInstance();
    const { el } = mount(Switcher, verbalyPlugin(v));
    expect(el.textContent).toBe('es');
    el.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(el.textContent).toBe('en');
    expect(v.locale).toBe('en');
  });

  it('cleans up on unmount', () => {
    const v = makeInstance();
    const { app } = mount(Hello, verbalyPlugin(v));
    app.unmount();
    expect(() => v.setLocale('en')).not.toThrow();
  });

  it('fails clearly without the plugin', () => {
    const { errors } = mount(Hello);
    expect(String(errors[0])).toContain('verbalyPlugin');
  });
});

describe('@verbaly/vue <Trans>', () => {
  it('wraps a named tag via its render function', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { agree: 'Lee los <terms>términos</terms> ya' } },
    });
    const comp = defineComponent({
      setup() {
        return () =>
          h(Trans, {
            id: 'agree',
            components: { terms: (c: VNodeChild[]) => h('a', { href: '/terms' }, c) },
          });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/terms');
    expect(a.textContent).toBe('términos');
    expect(el.textContent).toBe('Lee los términos ya');
  });

  it('interpolates params alongside tags', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { hi: 'Hola {name}, ve al <link>panel</link>' } },
    });
    const comp = defineComponent({
      setup() {
        return () =>
          h(Trans, {
            id: 'hi',
            values: { name: 'Aron' },
            components: { link: (c: VNodeChild[]) => h('a', { href: '/x' }, c) },
          });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.textContent).toBe('Hola Aron, ve al panel');
    expect(el.querySelector('a')!.textContent).toBe('panel');
  });

  it('renders whitelisted tags as real elements', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <b>bold</b> c' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm' });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.textContent).toBe('a bold c');
    expect(el.querySelector('b')!.textContent).toBe('bold');
  });

  it('renders a void tag with no children, like the other three surfaces', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'line<br>hung</br>break' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm' });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.querySelectorAll('br')).toHaveLength(1);
    expect(el.querySelector('br')!.childNodes).toHaveLength(0);
    expect(el.textContent).toBe('linebreak');
  });

  it('degrades unknown tags to inner text', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <banana>b</banana> c' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm' });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.textContent).toBe('a b c');
    expect(el.querySelector('banana')).toBeNull();
  });

  it('honors a custom richTags whitelist', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <b>bold</b> c' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm', richTags: ['em'] });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.textContent).toBe('a bold c');
    expect(el.querySelector('b')).toBeNull();
  });

  it('renders from an instance prop without the plugin', async () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'hola <em>mundo</em>' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm', instance: v });
      },
    });
    const { el, errors } = mount(comp);
    expect(errors).toHaveLength(0);
    expect(el.querySelector('em')!.textContent).toBe('mundo');
    v.addMessages('es', { m: 'chau <em>mundo</em>' });
    await nextTick();
    expect(el.textContent).toBe('chau mundo');
  });

  it('re-renders tags on locale change', async () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: 've al <l>panel</l>' }, en: { m: 'go to the <l>panel</l>' } },
    });
    const comp = defineComponent({
      setup() {
        return () =>
          h(Trans, { id: 'm', components: { l: (c: VNodeChild[]) => h('a', { href: '/p' }, c) } });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    v.setLocale('en');
    await nextTick();
    expect(el.textContent).toBe('go to the panel');
    expect(el.querySelector('a')!.textContent).toBe('panel');
  });

  it('renders named links from the links prop', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: 'Lee la <docs>guía</docs> completa' } },
    });
    const comp = defineComponent({
      setup() {
        return () =>
          h(Trans, {
            id: 'm',
            links: { docs: { href: '/docs', target: '_blank', rel: 'noopener' } },
          });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/docs');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.textContent).toBe('guía');
  });

  it('components win over links and unsafe hrefs are blocked', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: '<x>a</x> y <bad>b</bad>' } },
    });
    const comp = defineComponent({
      setup() {
        return () =>
          h(Trans, {
            id: 'm',
            components: { x: (c: VNodeChild[]) => h('strong', c) },
            links: { x: '/never', bad: 'javascript:alert(1)' },
          });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.querySelector('strong')!.textContent).toBe('a');
    const a = el.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.textContent).toBe('b');
  });
});
