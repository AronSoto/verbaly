<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Nuxt integration for Verbaly — zero-config module with per-request locale negotiation and flash-free hydration.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/nuxt"><img src="https://img.shields.io/npm/v/@verbaly/nuxt?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/nuxt?color=blue" alt="MIT" /></a>
</p>

---

Server-rendered pages arrive already translated in the visitor's language — cookie first, then `Accept-Language`, then your fallback — and the client hydrates with the **same locale and the same catalog**, so there's no flash of untranslated text and no hydration mismatch. Each request gets its **own instance**: no locale leaking between concurrent users.

One line in `nuxt.config` wires everything: the Vite plugin (live extraction + the `virtual:verbaly` module), the per-request negotiation and `<html lang>`.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/nuxt @verbaly/vue
```

## ⚡ Wire it up

**1. The module** — this is the whole setup:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@verbaly/nuxt'],
});
```

Locales live in your `verbaly.config` (created by `npx verbaly init`), or inline:

```ts
modules: [['@verbaly/nuxt', { locales: ['en', 'es', 'pt'] }]],
```

**2. Write text** — components use the Vue bindings as usual:

```vue
<script setup>
import { useT } from '@verbaly/vue';
const t = useT();
</script>

<template>
  <h1>{{ t('x7Ka9q2f') }}</h1>
</template>
```

**3. Switching languages** (client) — persists the cookie the server reads:

```vue
<script setup>
import { switchLocale } from 'verbaly';
import { useVerbaly } from '@verbaly/vue';
const verbaly = useVerbaly();
</script>

<template>
  <button @click="switchLocale(verbaly, 'es')">Español</button>
</template>
```

That's it. The module negotiates the locale per request (cookie → `Accept-Language` → fallback), awaits the catalog **before** render, installs the Vue plugin, and keeps `<html lang>` in sync.

## 📖 Options

Via the `verbaly` key in `nuxt.config` or inline module options — every [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) option passes through, plus:

| Option | What it does |
| --- | --- |
| `cookie` | Cookie read/written for the user's choice (default `verbaly-locale`); `false` = `Accept-Language` only. |
| `fallback` | Locale when nothing matches (defaults to the source locale). |

- No dependency on `nuxt` or `@nuxt/kit` — the module is typed structurally; the only moving parts are core primitives (`resolveRequestLocale`) and the generated `createRequestInstance`.
- For fully static sites (`nuxi generate`), consider [`verbaly render`](https://www.npmjs.com/package/@verbaly/compiler) for pre-translated output per locale.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs](https://verbaly-web.vercel.app/docs)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
