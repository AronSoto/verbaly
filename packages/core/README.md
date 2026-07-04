<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="340" />
</p>

<p align="center">
  <em>Effortless i18n — write natural text, ship type-safe, tree-shakeable translations.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://bundlephobia.com/package/verbaly"><img src="https://img.shields.io/bundlephobia/minzip/verbaly?label=gzip" alt="bundle size" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="Apache-2.0" /></a>
</p>

---

Most i18n tools make you maintain key files by hand — keys drift from the code, no type-safety, heavy setup. **Verbaly inverts the flow:** write the source text in your code, a build plugin extracts stable keys, types and per-locale modules. Compiler-grade safety, a runtime under **~3KB**, zero dependencies.

```ts
// You write this:
t`Hello ${name}, you have ${count} messages`;

// The compiler generates: a stable key + inferred types + per-locale entries.
t('EMo3ph4u', { name, count }); //  ← fully typed, tree-shakeable
```

Missing a translation? **The build fails** — raw keys never reach production.

## Install

```bash
pnpm add verbaly @verbaly/vite
```

```ts
// vite.config.ts
import verbaly from '@verbaly/vite';

export default { plugins: [verbaly({ locales: ['en', 'es', 'pt'] })] };
```

```ts
// anywhere in your app — extracted + typed on save
import { t, setLocale } from 'virtual:verbaly';

t`Hello ${name}`;
await setLocale('es'); // per-locale bundle loaded on demand
```

### Standalone runtime (no compiler)

`verbaly` also works on its own for dynamic/CMS content:

```ts
import { createVerbaly } from 'verbaly';

const v = createVerbaly({
  locale: 'en',
  messages: { en: { greeting: 'Hello {name}' } },
});

v.t('greeting', { name: 'Aron' }); // "Hello Aron"
```

### Plain HTML

```html
<h1 data-verbaly="home.title"></h1>
<p data-verbaly="home.intro" data-verbaly-rich></p>
<!-- rich: 'The build <em>gate</em>' renders a real <em> — whitelist, XSS-safe -->
```

```ts
import { bindDom, createVerbaly, persistLocale, resolveLocale } from 'verbaly';

const v = createVerbaly({
  locale: resolveLocale({ supported: ['en', 'es', 'pt'] }), // storage → navigator → fallback
  /* … */
});
bindDom(v); // renders + re-renders on locale change

v.setLocale('es');
persistLocale('es'); // localStorage + <html lang>
```

## What you get

- **Hybrid compiler + runtime** — static text compiled (types + tree-shaking), dynamic content via a real runtime path.
- **Type-safe params** — `{name}`, plurals, currency and dates inferred from the message; wrong/missing params fail to compile.
- **`Intl`-powered format** — number/currency/date/time + CLDR plurals and select/gender, tiny surface.
- **Plain, portable JSON catalogs** — no proprietary format, no lock-in.
- **DOM interpreter** for framework-less HTML.

## Ecosystem

| Package                           | Description                 |
| --------------------------------- | --------------------------- |
| `verbaly`                         | Core runtime (this package) |
| `@verbaly/vite`                   | Zero-config Vite plugin     |
| `@verbaly/compiler`               | Extraction + codegen + CLI  |
| `@verbaly/react` · `@verbaly/vue` | Framework adapters          |

📖 **Docs & live playground:** https://verbaly-web.vercel.app

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
