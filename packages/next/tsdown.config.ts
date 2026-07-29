import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // dual: next.config.ts is often transpiled to CJS, so the ESM compiler is reached via import()
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    fixedExtension: false,
    clean: true,
  },
  {
    // server/client import 'virtual:verbaly': a consumer-resolved bundler alias, never bundled
    entry: { server: 'src/server.ts', client: 'src/client.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    fixedExtension: false,
    clean: false,
    deps: { neverBundle: ['virtual:verbaly'] },
  },
  {
    // no dts: the runtime is module.exports = fn, declared by the hand-written loader.d.cts
    entry: { loader: 'src/loader.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    fixedExtension: false,
    clean: false,
  },
]);
