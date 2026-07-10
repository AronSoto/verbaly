import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/devtools.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  fixedExtension: false,
  clean: true,
});
