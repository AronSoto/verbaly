// react resolves to preact/compat here: the aliases and the environment come from the config
import { createRoot, type Root } from 'react-dom/client';
import { createVerbaly } from 'verbaly';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Trans, VerbalyProvider, useLocale, useT } from '../src/index';

function makeInstance() {
  return createVerbaly({
    locale: 'es',
    messages: { es: { hello: 'Hola {name}' }, en: { hello: 'Hello {name}' } },
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

describe('@verbaly/react under preact/compat', () => {
  it('really is preact: the alias resolved, so this file proves something', async () => {
    const [compat, preact] = await Promise.all([import('react'), import('preact')]);
    // compat re-exports preact's Fragment; under real react these are different objects
    expect(compat.Fragment).toBe(preact.Fragment);
  });

  it('renders translations through the provider', () => {
    act(() => {
      root.render(
        <VerbalyProvider instance={makeInstance()}>
          <Hello />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hola Aron');
  });

  it('re-renders on locale change (useSyncExternalStore is compat-backed)', () => {
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

  it('re-renders when a catalog arrives', () => {
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

  it('useLocale reads and sets from an event handler', () => {
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

  it('Trans clones a component for a named tag', () => {
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

  it('Trans renders whitelisted tags, void tags and named links', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { m: 'a <b>bold</b><br></br> ve a la <docs>guía</docs>' } },
    });
    act(() => {
      root.render(<Trans id="m" instance={v} links={{ docs: '/docs' }} />);
    });
    expect(container.querySelector('b')!.textContent).toBe('bold');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/docs');
  });

  it('Trans degrades an unknown tag to inert text', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { m: 'a <banana>b</banana> c' } } });
    act(() => {
      root.render(<Trans id="m" instance={v} />);
    });
    expect(container.textContent).toBe('a b c');
    expect(container.querySelector('banana')).toBeNull();
  });

  it('server-renders the same markup', async () => {
    const { renderToString } = await import('react-dom/server');
    const markup = renderToString(
      <VerbalyProvider instance={makeInstance()}>
        <Hello />
      </VerbalyProvider>,
    );
    expect(markup).toContain('Hola Aron');
  });
});
