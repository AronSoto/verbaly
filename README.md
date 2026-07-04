<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.png" />
    <img src="assets/logo-light.png" alt="Verbaly" width="360" />
  </picture>
</p>

<p align="center">
  <em>Effortless i18n — write natural text, ship type-safe, tree-shakeable translations.</em>
  <br />
  <strong>TypeScript</strong> · <strong>Vite</strong> · <strong>Compiler + runtime</strong> · <strong>Zero-config</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://bundlephobia.com/package/verbaly"><img src="https://img.shields.io/bundlephobia/minzip/verbaly?label=gzip" alt="bundle size" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="Apache-2.0" /></a>
</p>

---

## What is Verbaly?

Most i18n tools make you **maintain key files by hand** — keys drift from the code, there's no type-safety, and setup is heavy.

**Verbaly inverts the flow.** You write the source text right in your code. A build plugin extracts the messages, generates **stable keys, types, and one module per locale**. So you get compiler-grade safety with a runtime under **~3KB**.

```ts
// You write this:
t`Hello ${name}, you have ${count} messages`;

// The compiler generates: a stable key + inferred types + per-locale entries.
t('EMo3ph4u', { name, count }); //  ← fully typed, tree-shakeable
```

Missing a translation? **The build fails** — raw keys never reach production.

---

## Quick start

```bash
pnpm add verbaly @verbaly/vite
```

```ts
// vite.config.ts
import verbaly from '@verbaly/vite';

export default {
  plugins: [verbaly({ locales: ['en', 'es', 'pt'] })],
};
```

```ts
// anywhere in your app
import { t, setLocale } from 'virtual:verbaly';

t`Hello ${name}`; // extracted + typed on save
await setLocale('es'); // per-locale bundle loaded on demand
```

Plain HTML, no framework? Bind by attribute:

```html
<h1 data-verbaly="home.title"></h1>
```

👉 Full docs & live playground: **https://verbaly-web.vercel.app**

---

## Packages

| Package                                  | Version                                                                                                          | Description                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`verbaly`](packages/core)               | [![npm](https://img.shields.io/npm/v/verbaly?label=)](https://www.npmjs.com/package/verbaly)                     | Core runtime — `t`, locale store, `Intl` formatting, DOM interpreter |
| [`@verbaly/compiler`](packages/compiler) | [![npm](https://img.shields.io/npm/v/@verbaly/compiler?label=)](https://www.npmjs.com/package/@verbaly/compiler) | Message extraction, type-safe codegen and CLI                        |
| [`@verbaly/vite`](packages/vite)         | [![npm](https://img.shields.io/npm/v/@verbaly/vite?label=)](https://www.npmjs.com/package/@verbaly/vite)         | Zero-config Vite plugin with live extraction                         |
| [`@verbaly/react`](packages/react)       | [![npm](https://img.shields.io/npm/v/@verbaly/react?label=)](https://www.npmjs.com/package/@verbaly/react)       | React hooks (`useT`, `useLocale`) + `<Trans>`                        |
| [`@verbaly/vue`](packages/vue)           | [![npm](https://img.shields.io/npm/v/@verbaly/vue?label=)](https://www.npmjs.com/package/@verbaly/vue)           | Vue 3 composables (`useT`, `useLocale`) + `<Trans>`                  |

---

## Why it's different

- **Hybrid compiler + runtime** — static text is compiled (types + tree-shaking); dynamic/CMS content has a real runtime path. No forced trade-off.
- **Type-safe params** — `{name}`, plurals, currency and dates are inferred from the message itself. Wrong or missing params fail to compile.
- **Tiny & tree-shakeable** — ~3KB gzip core, zero dependencies, per-locale code-splitting.
- **No proprietary format** — plain, portable JSON catalogs. No lock-in.
- **Works with plain HTML** — a `data-verbaly` DOM interpreter for the framework-less case, with opt-in rich text (`data-verbaly-rich`, whitelist-based, XSS-safe) and locale bootstrap helpers (`resolveLocale`/`persistLocale`).
- **Fails the build on missing translations** — the #1 i18n pain, gone.

---

## Development

```bash
pnpm install
pnpm build      # tsup → ESM + CJS + .d.ts
pnpm test       # Vitest (141 tests)
pnpm typecheck
```

> ⚠️ Early development. `0.x` published — API not stable yet.

## License

[Apache-2.0](./LICENSE) © Aron Soto — [@AronSoto](https://github.com/AronSoto)
