import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/module.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    fixedExtension: false,
    clean: true,
  },
  {
    // runtime plugin: registered by path from the module, resolved by the consumer's Nuxt build.
    // No dts — its ambient imports ('#imports', 'virtual:verbaly') must never ship as declarations.
    entry: { 'runtime/plugin': 'src/runtime/plugin.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    fixedExtension: false,
    clean: false,
    deps: { neverBundle: ['#imports', 'virtual:verbaly'] },
  },
]);
