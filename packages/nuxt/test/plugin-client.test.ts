// @vitest-environment happy-dom
// client-only app (ssr: false): no ssrContext, no payload — the plugin resolves in the browser
import { beforeEach, describe, expect, it } from 'vitest';
import type { Verbaly } from 'verbaly';
import plugin from '../src/runtime/plugin';
import { resetNuxtMock } from './mocks/imports';

const runPlugin = plugin as unknown as (nuxtApp: unknown) => Promise<void>;

async function run(): Promise<Verbaly> {
  const provided: unknown[] = [];
  const vueApp = {
    use(p: { install(app: never): void }) {
      p.install({ provide: (_key: unknown, value: unknown) => provided.push(value) } as never);
      return vueApp;
    },
  };
  await runPlugin({ vueApp });
  return provided[0] as Verbaly;
}

beforeEach(() => {
  resetNuxtMock();
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
});

describe('runtime plugin (client-only)', () => {
  it('reads the locale cookie from document.cookie', async () => {
    document.cookie = 'verbaly-locale=pt; path=/'; // path matches the beforeEach cleanup
    const instance = await run();
    expect(instance.locale).toBe('pt');
    expect(instance.t('greet')).toBe('Olá');
  });

  it('falls back to navigator languages / source locale without a cookie', async () => {
    const instance = await run();
    expect(instance.locale).toBe('en'); // happy-dom reports en-US → narrows to en
  });
});
