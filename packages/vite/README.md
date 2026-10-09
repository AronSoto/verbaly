<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Zero-config Vite plugin for Verbaly: live extraction, codegen and HMR.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/vite"><img src="https://img.shields.io/npm/v/@verbaly/vite?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/vite?color=blue" alt="MIT" /></a>
</p>

---

The Vite plugin for [Verbaly](https://github.com/AronSoto/verbaly). Write natural text in your code; on save it extracts stable keys, syncs per-locale JSON catalogs, generates typed `virtual:verbaly` + `verbaly.d.ts`, and **fails `vite build` when a translation is missing**.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/vite
```

```ts
// vite.config.ts
import verbaly from '@verbaly/vite';

export default {
  plugins: [verbaly({ sourceLocale: 'en', locales: ['en', 'es', 'pt'] })],
};
```

```ts
// anywhere in your app, extracted + typed on save
import { t, setLocale } from 'virtual:verbaly';
```

- **Live extraction** with debounced catalog writes + HMR, from `.js/.ts/.jsx/.tsx` and `.svelte`/`.vue` files (script and markup). Every write starts from the files on disk, so a checkout or an `extract` run in another terminal is never undone with an older text, and a catalog saved half-typed is reported in one line while the server keeps running. The terminal says what `next dev` says, once each: a hand edit of a text your code owns, a key with two texts, a `t` under another name, a translation older than its source.
- **Typed keys**: the types go to `src/verbaly.d.ts` (the root when there is no `src/`), the folder the Vite and SvelteKit templates' `tsconfig` includes, so `tsc -b` sees them with nothing to configure. `npx verbaly typegen` writes them on a fresh clone.
- **Per-locale code-splitting**: `setLocale` lazy-loads only what's used.
- **Build gate**: missing translations stop the build (same as `verbaly check`); `failOnMissing: false` opts out.
- **Files outside `include`**: when the dev server or the build starts, it names once every file outside your `include` that writes a `` t`…` ``, since that text is never extracted and shows in the source language.

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks/vite**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
