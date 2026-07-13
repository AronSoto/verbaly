import { describe, expect, it, vi } from 'vitest';
import plugin from '../src/runtime/plugin';

// an outdated @verbaly/vite exports no `locales` — the import arrives empty/undefined
vi.mock('virtual:verbaly', () => ({
  locales: [],
  sourceLocale: 'en',
  createRequestInstance: () => Promise.resolve(null),
}));

describe('runtime plugin guard', () => {
  it('throws an actionable error when locales are missing', async () => {
    const runPlugin = plugin as unknown as (nuxtApp: unknown) => Promise<void>;
    await expect(runPlugin({ vueApp: { use() {} } })).rejects.toThrow('verbaly.config');
  });
});
