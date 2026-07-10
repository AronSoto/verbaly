// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { attachDevtools } from '../src/devtools';
import { createVerbaly } from '../src/instance';
import type { DictionaryInput } from '../src/types';

let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  detach = undefined;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

function make() {
  return createVerbaly<DictionaryInput>({
    locale: 'es',
    fallback: 'en',
    messages: { en: { a: 'A', b: 'B' }, es: { a: 'Ae' } },
  });
}

describe('attachDevtools', () => {
  it('renders a panel with ok/fallback/missing counts', () => {
    document.body.innerHTML =
      '<p data-verbaly="a"></p><p data-verbaly="b"></p><p data-verbaly="nope"></p>';
    const v = make();
    detach = attachDevtools(v, { catalogDir: 'src/i18n/locale' });
    const panel = document.querySelector('.verbaly-dt')!;
    expect(panel.querySelector('.ok')!.textContent).toBe('1 ok');
    expect(panel.querySelector('.fb')!.textContent).toBe('1 fallback');
    expect(panel.querySelector('.miss')!.textContent).toBe('1 missing');
    expect(panel.querySelector('.verbaly-dt-miss')!.textContent).toContain('src/i18n/locale/es.json');
  });

  it('re-renders on locale change', () => {
    document.body.innerHTML = '<p data-verbaly="b"></p>';
    const v = make();
    detach = attachDevtools(v);
    // 'b' only exists in en → fallback while locale is es
    expect(document.querySelector('.fb')!.textContent).toBe('1 fallback');
    v.setLocale('en');
    expect(document.querySelector('.fb')!.textContent).toBe('0 fallback');
    expect(document.querySelector('.ok')!.textContent).toBe('1 ok');
  });

  it('detaches cleanly', () => {
    document.body.innerHTML = '<p data-verbaly="a"></p>';
    const v = make();
    detach = attachDevtools(v);
    expect(document.querySelector('.verbaly-dt')).not.toBeNull();
    detach();
    detach = undefined;
    expect(document.querySelector('.verbaly-dt')).toBeNull();
    expect(document.querySelector('.verbaly-dt-tip')).toBeNull();
  });

  it('ignores its own panel writes — no mutation self-loop', async () => {
    document.body.innerHTML = '<p data-verbaly="a"></p>';
    const v = make();
    let scans = 0;
    const inspect = v.inspect.bind(v);
    v.inspect = (key) => {
      scans += 1;
      return inspect(key);
    };
    detach = attachDevtools(v);
    // drain the observer microtasks — with the loop, scans grew every tick
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const settled = scans;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(scans).toBe(settled);
  });

  it('throws without a DOM', () => {
    const doc = globalThis.document;
    // @ts-expect-error simulate SSR
    delete globalThis.document;
    try {
      expect(() => attachDevtools(make())).toThrow('requires a DOM');
    } finally {
      globalThis.document = doc;
    }
  });
});
