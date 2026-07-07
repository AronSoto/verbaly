<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Verbaly for webpack, Rollup, esbuild and Rspack — powered by unplugin.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/unplugin"><img src="https://img.shields.io/npm/v/@verbaly/unplugin?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/unplugin?color=blue" alt="Apache-2.0" /></a>
</p>

---

[Verbaly](https://github.com/AronSoto/verbaly) beyond Vite: the same compiler — typed `virtual:verbaly` module, per-locale code-splitting and the **missing-translation build gate** — wrapped with [unplugin](https://github.com/unjs/unplugin) so it runs on **webpack 5, Rollup, esbuild, Rspack** (and Vite, though [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) is richer there: live extraction + HMR).

## Install

```bash
pnpm add verbaly @verbaly/unplugin
```

```js
// webpack.config.mjs
import { verbaly } from '@verbaly/unplugin';

export default {
  plugins: [verbaly.webpack({ sourceLocale: 'en', locales: ['en', 'es', 'pt'] })],
};
```

```js
// rollup.config.mjs
import { verbaly } from '@verbaly/unplugin';
export default { plugins: [verbaly.rollup({ locales: ['en', 'es'] })] };

// esbuild
verbaly.esbuild({ locales: ['en', 'es'] });
// rspack
verbaly.rspack({ locales: ['en', 'es'] });
```

Extraction runs via the CLI — add it to your dev loop or CI:

```bash
npx verbaly extract   # scan sources, sync catalogs, write verbaly.d.ts
```

- **Same virtual module** — `import { t, setLocale } from 'virtual:verbaly'`.
- **Build gate** — missing translations fail the build (`failOnMissing: false` to opt out).
- ESM-only, like the compiler. Use `webpack.config.mjs` (or `"type": "module"`).

📖 Docs & live playground: **https://verbaly-web.vercel.app**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
