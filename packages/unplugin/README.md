<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Verbaly for webpack, Rollup, esbuild and Rspack, powered by unplugin.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/unplugin"><img src="https://img.shields.io/npm/v/@verbaly/unplugin?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/unplugin?color=blue" alt="MIT" /></a>
</p>

---

[Verbaly](https://github.com/AronSoto/verbaly) beyond Vite: the same compiler (typed `verbaly/app` module, per-locale code-splitting and the **build report** of what `verbaly check` would fail on) wrapped with [unplugin](https://github.com/unjs/unplugin) so it runs on **webpack 5, Rollup, esbuild, Rspack** (and Vite, though [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) is richer there: live extraction + HMR).

## 🚀 Install

```bash
pnpm add verbaly @verbaly/unplugin
pnpm add -D @verbaly/compiler   # the verbaly command: init, extract, check
```

```js
// webpack.config.mjs
import { verbaly } from '@verbaly/unplugin';

export default {
  plugins: [verbaly.webpack()],
};
```

```ts
// verbaly.config.ts, created by npx verbaly init: list your languages, the build and `verbaly check` read them
export default { sourceLocale: 'en', locales: ['en', 'es', 'pt'] };
```

```js
// rollup.config.mjs
import { verbaly } from '@verbaly/unplugin';
export default { plugins: [verbaly.rollup()] };

// esbuild
verbaly.esbuild();
// rspack
verbaly.rspack();
```

Extraction runs via the CLI: add it to your dev loop or CI:

```bash
npx verbaly extract           # scan sources, sync catalogs, write the types (src/verbaly.d.ts)
npx verbaly extract --watch   # keep extracting as you code (dev loop)
```

- **Same project module**: `import { t, setLocale } from 'verbaly/app'`. With webpack, write that name: webpack reads `virtual:verbaly`, the old one, as a URI scheme and stops before any plugin sees it. A file that imports `@verbaly/react`, `@verbaly/vue` or `@verbaly/svelte` loads it too, so their hooks work with no provider in the browser.
- **The language a visitor chose**: `switchLocale` saves it in the browser and sets `<html lang>`, which `setLocale` sets too, saving nothing. A single-page app starts in its source language, so read the choice back before the first render: `setLocale(resolveLocale({ supported: locales, path: false })).then(render)`, with `resolveLocale` from `verbaly`.
- **Build report**: each build, and each rebuild of a watch, says what `verbaly check` would fail on and goes on. A problem is said once while it lasts, so a watch does not repeat it on every save. `failOnMissing: true` stops the build instead.
- **Files outside `include`**: the build names once, when it starts, every file outside your `include` that writes a `` t`…` ``, since that text ships untranslated.
- **Typed keys**: each build writes the types to `src/verbaly.d.ts` too, with the texts the code adds, so a fresh clone typechecks after its first build. A script that checks types first needs `npx verbaly typegen` before it.
- ESM-only, like the compiler. Use `webpack.config.mjs` (or `"type": "module"`).

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks/vite#unplugin**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
