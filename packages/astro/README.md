<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Astro integration for Verbaly: write-in-source extraction for .astro files plus automatic per-locale static rendering.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/astro"><img src="https://img.shields.io/npm/v/@verbaly/astro?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/astro?color=blue" alt="MIT" /></a>
</p>

---

Write your text in place, in the frontmatter or right in the markup of your `.astro` files. The compiler extracts the messages, generates stable keys, typed params and one catalog per language, and the dev server keeps them in sync while you code.

One line in `astro.config` wires everything: the Vite plugin (live extraction, the `virtual:verbaly` module and the build gate) and, if you use the mirror flow, `verbaly render` runs by itself after every build. The generated types live inside Astro's own `.astro` folder (via `injectTypes`), so no extra file lands in your project.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/astro
```

## ⚡ Wire it up

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import verbaly from '@verbaly/astro';

export default defineConfig({
  integrations: [verbaly()],
});
```

Locales live in your `verbaly.config` (created by `npx verbaly init`), or inline:

```js
integrations: [verbaly({ locales: ['en', 'es', 'pt'] })],
```

## ✍️ Write the text in place

```astro
---
const title = t`Search and find`;
---

<h1>{title}</h1>
<p>{t`Hello ${name}, you have ${count} messages`}</p>
<img alt={t`Company logo`} src="/logo.png" />
```

Every message becomes a stable key with typed params. Untranslated entries fail the build (opt out with `failOnMissing: false`).

## 🌍 Two ways to ship the languages

**Path-based pages** (Astro's i18n routing): build one instance per request and use `t` as usual. Astro owns the routes, Verbaly owns the catalogs and the type safety.

```astro
---
import { createRequestInstance, sourceLocale } from 'virtual:verbaly';
const { t } = await createRequestInstance(Astro.currentLocale ?? sourceLocale);
---
```

`createRequestInstance` awaits the catalog before it returns, which is what makes the page arrive
translated instead of flashing. `Astro.currentLocale` is `undefined` outside a localized route, so
the fallback is not decoration.

**Mirror mode** (one tree, pre-translated copies): keep your markup bound with `data-verbaly` attributes and add a `render` section to your `verbaly.config`. After `astro build`, the integration mirrors `dist/` into `dist/<locale>/` with every message pre-filled, plus hreflang and a per-locale sitemap if you configure `baseUrl`. No flash of untranslated content, no client work.

```js
// verbaly.config.mjs
export default {
  locales: ['en', 'es', 'pt'],
  render: { baseUrl: 'https://example.com', sitemap: true },
};
```

Force it on or off with the integration option: `verbaly({ render: true })`.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/frameworks/astro](https://verbaly-web.vercel.app/docs/frameworks/astro)

MIT © Aron Soto
