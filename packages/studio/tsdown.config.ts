import { defineConfig } from 'tsdown';

export default defineConfig({
  // one build for both entries: the bin imports the library's chunks instead of a copy of them
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  clean: true,
});
