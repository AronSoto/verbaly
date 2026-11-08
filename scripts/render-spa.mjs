// paints a built single-page app as a browser would, with no browser: <dist> [saved locale]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { root } from './tarballs.mjs';

const require = createRequire(join(root, 'packages', 'core', 'package.json'));
const { Window } = require('happy-dom');
const { LOCALE_STORAGE_KEY } = await import(
  pathToFileURL(join(root, 'packages', 'core', 'dist', 'index.js')).href
);

const [dist, saved] = process.argv.slice(2);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = /<script type="module"[^>]*\ssrc="\/?([^"]+)"/.exec(html)?.[1];
if (!entry) throw new Error(`no module script in ${join(dist, 'index.html')}`);

const window = new Window({ url: 'http://localhost/' });
if (saved) window.localStorage.setItem(LOCALE_STORAGE_KEY, saved);
window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
// what a bundle reaches for as a global in a browser, taken from the window that holds the page
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) globalThis[key] = window[key];
}
for (const key of ['window', 'document', 'navigator', 'localStorage', 'location', 'history']) {
  Object.defineProperty(globalThis, key, {
    value: window[key],
    configurable: true,
    writable: true,
  });
}

await import(pathToFileURL(join(dist, entry)).href);
// the app paints after its language loads: wait for text that holds still for half a second
const start = Date.now();
let text = '';
let still = 0;
while (Date.now() - start < 10_000 && still < 5) {
  await sleep(100);
  const now = window.document.body.textContent.replace(/\s+/g, ' ').trim();
  still = now && now === text ? still + 1 : 0;
  text = now;
}
console.log(JSON.stringify({ lang: window.document.documentElement.lang, text }));
await window.happyDOM.close();
process.exit(0);
