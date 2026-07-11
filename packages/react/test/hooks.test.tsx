// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createVerbaly } from 'verbaly';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Trans, VerbalyProvider, useLocale, useT } from '../src/index';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeInstance() {
  return createVerbaly({
    locale: 'es',
    messages: {
      es: { hello: 'Hola {name}' },
      en: { hello: 'Hello {name}' },
    },
  });
}

function Hello() {
  const t = useT();
  return <p>{t('hello', { name: 'Aron' })}</p>;
}

function Switcher() {
  const [locale, setLocale] = useLocale();
  return <button onClick={() => setLocale('en')}>{locale}</button>;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('@verbaly/react', () => {
  it('useVerbaly throws without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bare = createRoot(document.createElement('div'));
    expect(() => act(() => bare.render(<Hello />))).toThrow(/VerbalyProvider/);
    act(() => bare.unmount());
    spy.mockRestore();
  });

  it('renders translations', () => {
    const v = makeInstance();
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Hello />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hola Aron');
  });

  it('useT keeps the full t surface — t.id works', () => {
    function IdUser() {
      const t = useT();
      return <p>{t.id('hello')`Hello ${'Aron'}`}</p>;
    }
    act(() => {
      root.render(
        <VerbalyProvider instance={makeInstance()}>
          <IdUser />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hello Aron');
  });

  it('re-renders on locale change', () => {
    const v = makeInstance();
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Hello />
        </VerbalyProvider>,
      );
    });
    act(() => v.setLocale('en'));
    expect(container.textContent).toBe('Hello Aron');
  });

  it('re-renders when messages arrive', () => {
    const v = makeInstance();
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Hello />
        </VerbalyProvider>,
      );
    });
    act(() => v.setLocale('pt'));
    act(() => v.addMessages('pt', { hello: 'Olá {name}' }));
    expect(container.textContent).toBe('Olá Aron');
  });

  it('useLocale reads and sets', () => {
    const v = makeInstance();
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Switcher />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('es');
    act(() => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toBe('en');
    expect(v.locale).toBe('en');
  });
});

describe('@verbaly/react <Trans>', () => {
  it('wraps a named tag in its component', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { agree: 'Lee los <terms>términos</terms> ya' } },
    });
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans id="agree" components={{ terms: <a href="/terms" /> }} />
        </VerbalyProvider>,
      );
    });
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/terms');
    expect(a.textContent).toBe('términos');
    expect(container.textContent).toBe('Lee los términos ya');
  });

  it('interpolates params alongside tags', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { hi: 'Hola {name}, ve al <link>panel</link>' } },
    });
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans id="hi" values={{ name: 'Aron' }} components={{ link: <a href="/x" /> }} />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hola Aron, ve al panel');
    expect(container.querySelector('a')!.textContent).toBe('panel');
  });

  it('degrades unknown tags to inner text', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <b>bold</b> c' } } });
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans id="m" />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('a bold c');
    expect(container.querySelector('b')).toBeNull();
  });

  it('re-renders tags on locale change', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: 've al <l>panel</l>' }, en: { m: 'go to the <l>panel</l>' } },
    });
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans id="m" components={{ l: <a href="/p" /> }} />
        </VerbalyProvider>,
      );
    });
    act(() => v.setLocale('en'));
    expect(container.textContent).toBe('go to the panel');
    expect(container.querySelector('a')!.textContent).toBe('panel');
  });

  it('renders named links from the links prop', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: 'Lee la <docs>guía</docs> completa' } },
    });
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans id="m" links={{ docs: { href: '/docs', target: '_blank', rel: 'noopener' } }} />
        </VerbalyProvider>,
      );
    });
    const a = container.querySelector('a')!;
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
    act(() => {
      root.render(
        <VerbalyProvider instance={v}>
          <Trans
            id="m"
            components={{ x: <strong /> }}
            links={{ x: '/never', bad: 'javascript:alert(1)' }}
          />
        </VerbalyProvider>,
      );
    });
    expect(container.querySelector('strong')!.textContent).toBe('a');
    const a = container.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.textContent).toBe('b');
  });
});
