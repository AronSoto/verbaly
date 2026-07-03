// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createVerbaly } from 'verbaly';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VerbalyProvider, useLocale, useT } from '../src/index';

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
