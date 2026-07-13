// type-level compat against the real Next types (devDep only) — mirror of
// sveltekit's Handle assertion and nuxt's NuxtModule assertion
import type { NextConfig } from 'next';
import { describe, expect, it } from 'vitest';
import { withVerbaly, type NextConfigLike } from '../src/index';

describe('type compatibility with next', () => {
  it('a real NextConfig is structurally accepted and the wrapper stays Next-compatible', () => {
    const real: NextConfig = {
      reactStrictMode: true,
      webpack: (config) => config,
      turbopack: { resolveAlias: { lodash: 'lodash-es' } },
    };

    const like: NextConfigLike = real;
    const wrapped = withVerbaly(real);
    const nextCompatible: (
      phase: string,
      context?: { defaultConfig?: unknown },
    ) => Promise<NextConfig> = wrapped;

    expect(like).toBe(real);
    expect(typeof nextCompatible).toBe('function');
  });
});
