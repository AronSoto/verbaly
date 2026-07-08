// ships the raw .svelte components next to the compiled entry
import { copyFileSync } from 'node:fs';
import { URL } from 'node:url';

for (const file of ['Trans.svelte', 'TransNodes.svelte', 'Trans.svelte.d.ts']) {
  copyFileSync(
    new URL(`../src/${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
}
