// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import { useSwitchLocale, useT, VerbalyProvider } from '../src/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Greeting() {
  const t = useT();
  return <p>{t('greeting')}</p>;
}

function Switcher() {
  const switchLocale = useSwitchLocale();
  return <button onClick={() => void switchLocale('es')}>switch</button>;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  refresh.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('@verbaly/next/client', () => {
  it('renders the source locale without serialized messages', () => {
    act(() => {
      root.render(
        <VerbalyProvider locale="en">
          <Greeting />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hello');
  });

  it('hydrates a non-source locale synchronously from serialized messages', () => {
    act(() => {
      root.render(
        <VerbalyProvider locale="es" messages={{ greeting: 'Hola', farewell: 'Chau' }}>
          <Greeting />
        </VerbalyProvider>,
      );
    });
    // no flash: the very first render is already translated
    expect(container.textContent).toBe('Hola');
  });

  it('useSwitchLocale loads the catalog, persists and refreshes the router', async () => {
    act(() => {
      root.render(
        <VerbalyProvider locale="en">
          <Greeting />
          <Switcher />
        </VerbalyProvider>,
      );
    });
    expect(container.querySelector('p')?.textContent).toBe('Hello');

    await act(async () => {
      container.querySelector('button')!.click();
      await Promise.resolve();
    });

    expect(container.querySelector('p')?.textContent).toBe('Hola');
    expect(document.cookie).toContain('verbaly-locale=es');
    expect(document.documentElement.lang).toBe('es');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows a locale change coming from the server', async () => {
    act(() => {
      root.render(
        <VerbalyProvider locale="en">
          <Greeting />
        </VerbalyProvider>,
      );
    });
    expect(container.textContent).toBe('Hello');

    await act(async () => {
      root.render(
        <VerbalyProvider locale="es" messages={{ greeting: 'Hola', farewell: 'Chau' }}>
          <Greeting />
        </VerbalyProvider>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toBe('Hola');
  });
});
