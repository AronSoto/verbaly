<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<h3 align="center">Write your text in the code. Ship it in every language.</h3>

<p align="center">
  The runtime of Verbaly: an i18n compiler and a tiny runtime for React, Vue, Svelte, Next.js, Nuxt, SvelteKit, Astro and plain HTML.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/gzip-3.35KB-3fb950" alt="3.35KB gzip" />
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero dependencies" />
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/demo.gif" alt="A terminal session: the code writes t`Welcome back, ${name}`, verbaly extract writes the catalogs, verbaly check fails on the missing Spanish, then on a translation that dropped {name}, and passes once it is fixed" width="760" />
</p>

Most i18n tools ask you to invent a key for every sentence and keep a file per language in step with the code by hand. **Verbaly turns that around:** you write the sentence where it is used, and the compiler gives it a stable key, writes your translation files, types every param and splits one module per language. This package is the runtime: **a 3.35 KB runtime** on its own (`createVerbaly`), and a site with no framework, which also pulls the DOM interpreter and the url helpers, ships **6.17 KB**. Both are measured on every release by `pnpm --filter verbaly size`, never estimated.

```ts
// with key files: name it, write it in en.json, es.json, pt.json, keep them in sync
t('dashboard.welcome_back', { name });

// with Verbaly: write the sentence where it is used
t`Welcome back, ${name}`;

// and the compiler writes a stable key and a typed call for you
t('ESsQIvlA', { name });

// prefer a readable key? Opt in per message
t.id('inbox.title')`Hello ${name}`; // → t('inbox.title', { name })
```

Missing a translation? **Every build says which ones**, and `verbaly check` stops your CI on them, so a raw key never reaches a release. A translation that dropped your `{name}` or flattened a plural block fails `check` too: being filled in is not the same as working.

## 🚀 Try it in 30 seconds

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
// verbaly.config.ts, created by npx verbaly init: list your languages, the build and `verbaly check` read them
export default { sourceLocale: 'en', locales: ['en', 'es', 'pt'] };
```

```ts
// anywhere in your app, extracted + typed on save
import { t, setLocale } from 'virtual:verbaly';

t`Hello ${name}`;
await setLocale('es'); // per-locale bundle loaded on demand
```

With the compiler, every `t` your project holds is typed by its catalog: the generated types fill in `Register`, so `Translate` and `Locale` (both exported here, types only, zero bytes) are your keys and your locales, and an instance's `t` checks keys and params too.

### 🎛️ Standalone runtime (no compiler)

`verbaly` also works on its own for dynamic/CMS content:

```ts
import { createVerbaly } from 'verbaly';

const v = createVerbaly({
  locale: 'en',
  messages: { en: { greeting: 'Hello {name}' } },
  loaders: { es: () => import('./locales/es.json') }, // lazy catalogs
});

v.t('greeting', { name: 'Aron' }); // "Hello Aron"
v.setLocale('es'); // auto-loads the catalog; or: await v.loadLocale('es') first
```

### 🌐 Plain HTML, no framework needed

```html
<h1 data-verbaly="home.title"></h1>
<p data-verbaly="home.intro" data-verbaly-rich></p>
<!-- rich: 'The build <em>gate</em>' renders a real <em> (whitelist, XSS-safe) -->
<p
  data-verbaly="home.cta"
  data-verbaly-rich
  data-verbaly-links='{"repo":"https://github.com/x"}'
></p>
<!-- links: 'See the <repo>repo</repo>' renders <a href>; hrefs from you, never from messages -->
```

```ts
import { bindDom, createVerbaly, persistLocale, resolveLocale } from 'verbaly';

const v = createVerbaly({
  locale: resolveLocale({ supported: ['en', 'es', 'pt'] }), // storage → navigator → fallback
  /* … */
});
// the whole document by default: the <title> and the meta description translate with the page
bindDom(v, {
  richLinks: { docs: { href: '/docs', target: '_blank', rel: 'noopener' } }, // named links
}); // renders + re-renders on locale change

v.setLocale('es');
persistLocale('es'); // localStorage + <html lang> + <html dir>
```

```ts
// locale switchers without hardcoded names or direction tables
import { localeDirection, localeName } from 'verbaly';

localeName('es'); // 'español' (endonym, via Intl.DisplayNames)
localeName('de', 'en'); // 'German'
localeDirection('ar'); // 'rtl': switchLocale/persistLocale already apply it to <html dir>
// switchLocale is the whole switch: navigation or in-place swap, then both persistence channels
```

```ts
// server-side (SSR): one instance per request, locale from the request itself
import { createVerbaly, resolveRequestLocale } from 'verbaly';

// the address wins when it carries the language: a url is public, a cookie is one visitor
const locale = resolveRequestLocale({
  supported: ['en', 'es', 'pt'],
  path: url.pathname,
  routing: 'prefix-except-source',
  cookie: cookies.get('verbaly-locale'),
  header: request.headers.get('accept-language'),
  fallback: 'en',
});
const v = createVerbaly({ locale, fallback: 'en', messages });
```

```ts
// the url helpers, all pure and safe on a server
import { alternateLinks, localePath, stripLocalePath } from 'verbaly';

localePath('pt', { supported, sourceLocale: 'en', path: '/es/docs' }); // '/pt/docs'
// your framework's own trailing slash, which the Astro and Next integrations pass for you
localePath('es', { supported, sourceLocale: 'en', path: '/', trailingSlash: 'never' }); // '/es'
stripLocalePath({ supported, path: '/es/docs' }); // '/docs', the route behind the url
alternateLinks({ supported, sourceLocale: 'en', path: '/docs', baseUrl: 'https://x.dev' });
// one hreflang entry per locale plus x-default, the same set `verbaly render` writes
```

## ✨ What you get

- **Type-safe params**: `{name}`, plurals, currency and dates inferred from the message; a wrong or missing param fails to compile.
- **`Intl` all the way**: number, currency, date, time, relative time, lists and units, CLDR plurals and select, with zero dependencies. ICU and relative time are wired only when your catalogs use them.
- **Static text compiled, dynamic text at runtime**: a real runtime path for CMS content, with lazy catalogs per language.
- **Plain HTML**: a DOM interpreter with opt-in rich text (a whitelist, never `innerHTML`) and named links whose hrefs come from your code.
- **RTL and language names built in**: `localeDirection` keeps `<html dir>` right, and `localeName` gives your switcher real names through `Intl.DisplayNames`.
- **Devtools**: opt-in `verbaly/devtools` answers "what key is this text?" in the browser, tree-shaken out of production.
- **Fast, with receipts**: a memoized hot path, benchmarked against i18next on every release (`pnpm --filter verbaly bench`).

## 🧩 Ecosystem

| Package                                                  | Description                                             |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `verbaly`                                                | Core runtime (this package)                             |
| `@verbaly/vite`                                          | Zero-config Vite plugin                                 |
| `@verbaly/unplugin`                                      | webpack · Rollup · esbuild · Rspack                     |
| `@verbaly/compiler`                                      | Extraction + codegen + the `verbaly` CLI                |
| `@verbaly/react` · `@verbaly/vue` · `@verbaly/svelte`    | Framework adapters (React also covers Preact)           |
| `@verbaly/astro`                                         | Astro integration + per-locale static build             |
| `@verbaly/next` · `@verbaly/nuxt` · `@verbaly/sveltekit` | SSR: locale per request, hydration with no flash        |
| `@verbaly/mcp`                                           | MCP server: the translation cycle as tools for an agent |
| `@verbaly/studio`                                        | Local review server over your catalogs                  |

All thirteen share one version number, so you never match compatible ranges.

📖 **Docs:** https://verbaly-web.vercel.app/docs/reference/api

🔁 **Coming from i18next?** Keep your keys and catalogs: the [migration guide](https://verbaly-web.vercel.app/docs/guide/migrate) maps everything one-to-one.

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
