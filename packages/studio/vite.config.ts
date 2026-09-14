import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// the panel is one page served from a local port, so it ships as flat files with no base path
export default defineConfig({
  root: 'src/ui',
  plugins: [svelte({ preprocess: vitePreprocess(), configFile: false })],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
    target: 'es2022',
  },
});
