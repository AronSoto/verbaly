import { defineConfig } from 'tsdown';

export default defineConfig({
  // server is the hook-free entry a React Server Component can import
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  fixedExtension: false,
  clean: true,
});
