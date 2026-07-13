import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // dual: next.config.ts is often transpiled to CJS by Next — the ESM-only
    // compiler is reached via dynamic import() (preserved in the CJS output)
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    fixedExtension: false,
    clean: true,
  },
  {
    // server/client import 'virtual:verbaly' — a consumer-resolved bundler alias, never bundled
    entry: { server: 'src/server.ts', client: 'src/client.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    fixedExtension: false,
    clean: false,
    deps: { neverBundle: ['virtual:verbaly'] },
  },
  {
    // webpack/turbopack loader — CJS, loader-runner territory.
    // No dts: the runtime is `module.exports = fn`; the hand-written
    // loader.d.cts at the package root declares it with `export =`.
    entry: { loader: 'src/loader.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    fixedExtension: false,
    clean: false,
  },
]);
