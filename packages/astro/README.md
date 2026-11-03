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

One line in `astro.config` wires everything: the Vite plugin (live extraction, the `verbaly/app` module and the build report) and, if you use the mirror flow, `verbaly render` runs by itself after every build. The generated types live inside Astro's own `.astro` folder (via `injectTypes`), so no extra file lands in your project.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/astro
pnpm add -D @verbaly/compiler   # the verbaly command: init, extract, check
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

Locales live in your `verbaly.config` (created by `npx verbaly init`), where `verbaly check` and `extract` read them too:

```ts
// verbaly.config.ts, created by npx verbaly init: list your languages, the build and `verbaly check` read them
export default { sourceLocale: 'en', locales: ['en', 'es', 'pt'] };
```

## ✍️ Write the text in place

```astro
---
import { createRequestInstance, sourceLocale } from 'verbaly/app';

const { t } = await createRequestInstance(Astro.currentLocale ?? sourceLocale);
const name = 'Ada';
const count = 3;
const title = t`Search and find`;
---

<h1>{title}</h1>
<p>{t`Hello ${name}, you have ${count} messages`}</p>
<img alt={t`Company logo`} src="/logo.png" />
```

Every message becomes a stable key with typed params. A build lists what `verbaly check` would fail on and goes on, so run `check` in CI (`failOnMissing: true` stops the build instead). The types go to the slot Astro gives integrations (`.astro/integrations/_verbaly_astro/verbaly.d.ts`), and `npx verbaly extract` writes that same file, so `astro check` never sees the module declared twice.

## 🌍 Two ways to ship the languages

**Path-based pages** (Astro's i18n routing): build one instance per request and use `t` as usual. Astro owns the routes, Verbaly owns the catalogs and the type safety.

```astro
---
import { createRequestInstance, sourceLocale } from 'verbaly/app';
const { t } = await createRequestInstance(Astro.currentLocale ?? sourceLocale);
---
```

`createRequestInstance` awaits the catalog before it returns, which is what makes the page arrive
translated instead of flashing. `Astro.currentLocale` is `undefined` outside a localized route, so
the fallback is not decoration.

The integration reads Astro's `i18n` too, so `switchLocale` and `localePath` from `verbaly/app`
go to the page Astro serves in the other language: `prefix-except-source` by default, or
`prefix-all` with `prefixDefaultLocale: true`. That needs Astro's `defaultLocale` to be your
`sourceLocale`, and each language's path to be its code; the dev server and the build say so
when it is not. A prefix mode your `verbaly.config` names stays as it is, and `npx verbaly doctor`
shows the mode in use.

```astro
<button data-lang="es">Español</button>
<script>
  import { switchLocale } from 'verbaly/app';

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    button.addEventListener('click', () => switchLocale(button.dataset.lang!)); // goes to /es/…
  }
</script>
```

**Mirror mode** (one tree, pre-translated copies): keep your markup bound with `data-verbaly` attributes and add a `render` section to your `verbaly.config`. After `astro build`, the integration mirrors `dist/` into `dist/<locale>/` with every message pre-filled, plus hreflang and a per-locale sitemap if you configure `baseUrl`. No flash of untranslated content, no client work.

```js
// verbaly.config.mjs
export default {
  locales: ['en', 'es', 'pt'],
  render: { baseUrl: 'https://example.com', sitemap: true },
};
```

Force it on or off with the integration option: `verbaly({ render: true })`.

Every url the mirror and `verbaly/app` write (hreflang, sitemap, canonical, links and `localePath`) follows Astro's own `trailingSlash`, so with `'never'` the Spanish home is `/es`, never `/es/`. With `<ClientRouter />`, `verbaly/app` takes the language of each page before the swap, so a live `bindDom` paints the incoming page in its own language. Its default root is the whole document, so it keeps working after the router replaces the `body`.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/frameworks/astro](https://verbaly-web.vercel.app/docs/frameworks/astro)

MIT © Aron Soto
