<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Vue 3 bindings for Verbaly: composables over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/vue"><img src="https://img.shields.io/npm/v/@verbaly/vue?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://verbaly-web.vercel.app/docs/frameworks/vue"><img src="https://img.shields.io/npm/dependency-version/@verbaly/vue/peer/vue?logo=vuedotjs&logoColor=4FC08D&label=Vue&color=35495E" alt="supported Vue versions" /></a>
  <a href="https://github.com/AronSoto/verbaly/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AronSoto/verbaly/ci.yml?logo=github&label=CI" alt="CI" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/AronSoto/verbaly"><img src="https://api.scorecard.dev/projects/github.com/AronSoto/verbaly/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.npmjs.com/package/@verbaly/vue#provenance"><img src="https://img.shields.io/badge/provenance-SLSA%20v1-3fb950?logo=npm" alt="published with npm provenance" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/vue?color=blue" alt="MIT" /></a>
</p>

---

Vue 3 composables for [Verbaly](https://github.com/AronSoto/verbaly): a thin layer over the reactive core with per-component cleanup (`onScopeDispose`).

## 🚀 Install

```bash
pnpm add verbaly @verbaly/vue @verbaly/vite   # @verbaly/unplugin on webpack, Rollup, esbuild or Rspack
pnpm add -D @verbaly/compiler   # the verbaly command: init, extract, check
npx verbaly init
```

Add `verbaly()` to the plugins in `vite.config` (the [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) README shows it). It writes `verbaly/app`, the module these composables read. In Nuxt, use [`@verbaly/nuxt`](https://www.npmjs.com/package/@verbaly/nuxt) instead, which installs this plugin for you.

```ts
// main.ts
import { verbalyPlugin } from '@verbaly/vue';
import { verbaly } from 'verbaly/app';

app.use(verbalyPlugin(verbaly));
```

```html
<script setup>
  import { useT, useLocale } from '@verbaly/vue';
  const t = useT();
  const locale = useLocale(); // writable: locale.value = 'en'
</script>

<template>
  <p>{{ t('inbox', { count: 3 }) }}</p>
</template>
```

**The plugin is optional in the browser.** With none above it, a hook reads the instance `verbaly/app` creates, so a single-page app can skip it and a component test renders with no wrapper. The Vite plugin and unplugin load `verbaly/app` in every file that imports `@verbaly/vue`, so that instance is there before the first render. On a server it is required, since every request has its own instance.

**Switching languages.** Writing `locale.value` switches every component, and the page follows: `<html lang>`, `<html dir>` and the choice, saved in the browser. Where a server renders the page, as in Nuxt, switch with `switchLocale` from `verbaly/app` instead: it also sets the cookie the server reads. A single-page app starts in its source language, so read that choice back before mounting:

```ts
// main.ts: the saved choice, else the browser's, loaded before anything renders
import { resolveLocale } from 'verbaly';
import { locales, setLocale } from 'verbaly/app';

setLocale(resolveLocale({ supported: locales, path: false })).then(() => app.mount('#app'));
```

**Keys are typed.** `useT()` checks every key and its params against your source catalog, through the types Verbaly generates (`src/verbaly.d.ts` in a Vite app, `.nuxt/verbaly.d.ts` in Nuxt): a key no catalog has does not compile. A key that comes from data, like `t(item.key)` or a variable typed as a union of keys, passes as it is, and its params are left open; declare it with `defineKeys` from `verbaly/app` when you want `check` to verify it exists.

Or skip the keys entirely: write the source text in place and the compiler extracts it, right in your `.vue` files (script and template):

```html
<template>
  <p>{{ t`Hello ${name}, you have ${count} messages` }}</p>
</template>
```

### ✨ Rich text: `<Trans>`

```html
<script setup>
  import { Trans } from '@verbaly/vue';
  import { h } from 'vue';
  const components = { terms: (c) => h('a', { href: '/terms' }, c) };
</script>

<template>
  <Trans id="agree" :components="components" />
</template>
```

Whitelisted phrasing tags in a message (`<em>`, `<code>`…) render as real elements, same whitelist as `data-verbaly-rich` (`richTags` overrides it); unknown tags unwrap to inert text. Named links need no render functions; hrefs come from your code, never from messages (`javascript:` blocked):

```html
<!-- message: 'Read the <docs>guide</docs>' -->
<Trans id="cta" :links="{ docs: { href: '/docs', target: '_blank', rel: 'noopener' } }" />
```

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks/vue**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
