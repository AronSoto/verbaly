<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Verbaly for webpack, Rollup, esbuild and Rspack, powered by unplugin.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/unplugin"><img src="https://img.shields.io/npm/v/@verbaly/unplugin?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/unplugin?color=blue" alt="MIT" /></a>
</p>

---

[Verbaly](https://github.com/AronSoto/verbaly) beyond Vite: the same compiler (typed `virtual:verbaly` module, per-locale code-splitting and the **build report** of what `verbaly check` would fail on) wrapped with [unplugin](https://github.com/unjs/unplugin) so it runs on **webpack 5, Rollup, esbuild, Rspack** (and Vite, though [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) is richer there: live extraction + HMR).

## 🚀 Install

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

Extraction runs via the CLI: add it to your dev loop or CI:

```bash
npx verbaly extract           # scan sources, sync catalogs, write the types (src/verbaly.d.ts)
npx verbaly extract --watch   # keep extracting as you code (dev loop)
```

- **Same virtual module**: `import { t, setLocale } from 'virtual:verbaly'`.
- **Build report**: each build, and each rebuild of a watch, says what `verbaly check` would fail on and goes on. A problem is said once while it lasts, so a watch does not repeat it on every save. `failOnMissing: true` stops the build instead.
- **Files outside `include`**: the build names once, when it starts, every file outside your `include` that writes a `` t`…` ``, since that text ships untranslated.
- ESM-only, like the compiler. Use `webpack.config.mjs` (or `"type": "module"`).

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks/vite#unplugin**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
