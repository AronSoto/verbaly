// Ships the panel as source, like @verbaly/svelte does for Trans.svelte: the host compiles it.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'ui');
const to = join(here, '..', 'dist', 'panel');
// a rune module across a package boundary is the one thing a host's bundler may not transform
const SKIP = new Set(['main.ts', 'store.svelte.ts', 'boot.css', 'index.html', 'env.d.ts']);

mkdirSync(to, { recursive: true });
const copied = [];
for (const name of readdirSync(from)) {
  if (SKIP.has(name)) continue;
  copyFileSync(join(from, name), join(to, name));
  copied.push(name);
}

if (!copied.includes('Panel.svelte') || !copied.includes('Panel.svelte.d.ts')) {
  throw new Error('the panel entry or its types did not ship');
}
console.log(`[verbaly] panel source: ${copied.length} files in dist/panel`);
