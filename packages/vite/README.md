<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Zero-config Vite plugin for Verbaly — live extraction, codegen and HMR.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/vite"><img src="https://img.shields.io/npm/v/@verbaly/vite?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/vite?color=blue" alt="MIT" /></a>
</p>

---

The Vite plugin for [Verbaly](https://github.com/AronSoto/verbaly). Write natural text in your code; on save it extracts stable keys, syncs per-locale JSON catalogs, generates typed `virtual:verbaly` + `verbaly.d.ts`, and **fails `vite build` when a translation is missing**.

## Install

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
// anywhere in your app — extracted + typed on save
import { t, setLocale } from 'virtual:verbaly';
```

- **Live extraction** with debounced catalog writes + HMR.
- **Per-locale code-splitting** — `setLocale` lazy-loads only what's used.
- **Build gate** — missing translations stop the build (same as `verbaly check`).

📖 Docs & live playground: **https://verbaly-web.vercel.app**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
