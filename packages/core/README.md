<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<h3 align="center">Write your text in the code. Ship it in every language.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/gzip-3.35KB-3fb950" alt="3.35KB gzip" />
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero dependencies" />
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/hero.gif" alt="On the left, a component that writes t`Welcome back, ${name}`, t`You have ${count} new messages` and t`Open inbox`. On the right, the same page in a browser switching from English to Spanish to Portuguese. Below, the four steps: write, extract, translate, check." width="760" />
</p>

You write the sentence where it is used, and the compiler gives it a stable key, writes your translation files and types every param. This package is the runtime: **a 3.35 KB runtime** with zero dependencies, and a site with no framework ships **6.17 KB**, both measured on every release.

```ts
// with Verbaly: write the sentence where it is used
t`Welcome back, ${name}`;

// and the compiler writes a stable key and a typed call for you
t('ESsQIvlA', { name });
```

## Install

```bash
pnpm add verbaly @verbaly/vite
pnpm add -D @verbaly/compiler   # the verbaly command: init, extract, check
npx verbaly init
```

```ts
// vite.config.ts
import verbaly from '@verbaly/vite';

export default { plugins: [verbaly()] };
```

```ts
// verbaly/app is your project's module: the plugin writes it from your config
import { t, setLocale } from 'verbaly/app';

t`Hello ${name}`;
await setLocale('es'); // loads only the Spanish module
```

**Works with** [React](https://verbaly-web.vercel.app/docs/frameworks/react) · [Next.js](https://verbaly-web.vercel.app/docs/frameworks/react#next) · [Vue](https://verbaly-web.vercel.app/docs/frameworks/vue) · [Nuxt](https://verbaly-web.vercel.app/docs/frameworks/vue#nuxt) · [Svelte](https://verbaly-web.vercel.app/docs/frameworks/svelte) · [SvelteKit](https://verbaly-web.vercel.app/docs/frameworks/svelte#sveltekit) · [Astro](https://verbaly-web.vercel.app/docs/frameworks/astro) · [webpack, Rollup, esbuild, Rspack](https://verbaly-web.vercel.app/docs/frameworks/vite#unplugin) · [plain HTML](https://verbaly-web.vercel.app/docs/frameworks/dom), and on its own for text that comes from a CMS.

## Why

- **No key files to maintain:** the compiler names each text and keeps every language file in step.
- **Typed from the text:** a wrong or missing param fails to compile.
- **Broken translations never ship:** `verbaly check` stops a missing translation, and one that lost a `{param}` or a plural case, in CI.
- **`Intl` all the way:** numbers, currency, dates, relative time, lists and plurals, with no dependency.

## Learn more

📖 [Docs](https://verbaly-web.vercel.app/docs) · 🧩 [API reference](https://verbaly-web.vercel.app/docs/reference/api) · 🔁 [Coming from i18next](https://verbaly-web.vercel.app/docs/guide/migrate) · ⭐ [GitHub](https://github.com/AronSoto/verbaly)

All packages share one version number. Verbaly is `0.x`, and every change is in the [changelog](https://github.com/AronSoto/verbaly/blob/develop/changelog/CHANGELOG.md).

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
