// @vitest-environment happy-dom
import { createVerbaly } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, type Component } from 'vue';
import { useLocale, useT, verbalyPlugin } from '../src/index';

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
