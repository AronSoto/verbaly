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

  it('degrades unknown tags to inner text', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <b>bold</b> c' } } });
    const comp = defineComponent({
      setup() {
        return () => h(Trans, { id: 'm' });
      },
    });
    const { el } = mount(comp, verbalyPlugin(v));
    expect(el.textContent).toBe('a bold c');
    expect(el.querySelector('b')).toBeNull();
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
});
