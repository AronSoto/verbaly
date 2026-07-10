<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="340" />
</p>

<p align="center">
  <em>Effortless i18n — write natural text, ship type-safe, tree-shakeable translations.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/gzip-~3KB-3fb950" alt="~3KB gzip" />
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="MIT" /></a>
</p>

---

Most i18n tools make you maintain key files by hand — keys drift from the code, no type-safety, heavy setup. **Verbaly inverts the flow:** write the source text in your code, a build plugin extracts stable keys, types and per-locale modules. Compiler-grade safety, a runtime under **~3KB**, zero dependencies.

```
// You write this:
t`Hello ${name}, you have ${count} messages`;

// The compiler generates: a stable key + inferred types + per-locale entries.
t('EMo3ph4u', { name, count }); //  ← fully typed, tree-shakeable

// Prefer readable keys? Opt in per message:
t.id('inbox.title')`Hello ${name}`; // → t('inbox.title', { name })
```

Missing a translation? **The build fails** — raw keys never reach production.

## 🚀 Try it in 30 seconds

```
pnpm add verbaly @verbaly/vite
```

```
// vite.config.ts
import verbaly from '@verbaly/vite';

export default { plugins: [verbaly({ locales: ['en', 'es', 'pt'] })] };
```

```
// anywhere in your app — extracted + typed on save
import { t, setLocale } from 'virtual:verbaly';

t`Hello ${name}`;
await setLocale('es'); // per-locale bundle loaded on demand
```

### 🎛️ Standalone runtime (no compiler)

`verbaly` also works on its own for dynamic/CMS content:

```
import { createVerbaly } from 'verbaly';

const v = createVerbaly({
  locale: 'en',
  messages: { en: { greeting: 'Hello {name}' } },
  loaders: { es: () => import('./locales/es.json') }, // lazy catalogs
});

v.t('greeting', { name: 'Aron' }); // "Hello Aron"
v.setLocale('es'); // auto-loads the catalog; or: await v.loadLocale('es') first
```

### 🌐 Plain HTML — no framework needed

```
<h1 data-verbaly="home.title"></h1>
<p data-verbaly="home.intro" data-verbaly-rich></p>
<!-- rich: 'The build <em>gate</em>' renders a real <em> — whitelist, XSS-safe -->
<p
  data-verbaly="home.cta"
  data-verbaly-rich
  data-verbaly-links='{"repo":"https://github.com/x"}'
></p>
<!-- links: 'See the <repo>repo</repo>' renders <a href> — hrefs from you, never from messages -->
```

```
import { bindDom, createVerbaly, persistLocale, resolveLocale } from 'verbaly';

const v = createVerbaly({
  locale: resolveLocale({ supported: ['en', 'es', 'pt'] }), // storage → navigator → fallback
  /* … */
});
bindDom(v, {
  richLinks: { docs: { href: '/docs', target: '_blank', rel: 'noopener' } }, // named links
}); // renders + re-renders on locale change

v.setLocale('es');
persistLocale('es'); // localStorage + <html lang>
```

## ✨ What you get

- **Hybrid compiler + runtime** — static text compiled (types + tree-shaking), dynamic content via a real runtime path.
- **Type-safe params** — `{name}`, plurals, currency and dates inferred from the message; wrong/missing params fail to compile.
- **`Intl`-powered format** — number/currency/date/time/relative/list/unit + CLDR plurals and select/gender, tiny surface. `'Updated {when:relative}'` · `'{langs:list}'` · `'{d:unit/kilometer}'`.
- **Plain, portable JSON catalogs** — no proprietary format, no lock-in.
- **DOM interpreter** for framework-less HTML — with opt-in rich text (whitelist-based, XSS-safe) and named links (`richLinks` / `data-verbaly-links`; hrefs come from the caller, `javascript:` blocked).
- **Lazy catalogs** — `loaders` + `loadLocale` load per-locale JSON on demand, in the runtime itself.
- **Fast, with receipts** — fully memoized hot path, benchmarked every release: 5–35× faster than i18next on lookup, interpolation and plurals.

## 🧩 Ecosystem

| Package                                               | Description                         |
| ----------------------------------------------------- | ----------------------------------- |
| `verbaly`                                             | Core runtime (this package)         |
| `@verbaly/vite`                                       | Zero-config Vite plugin             |
| `@verbaly/compiler`                                   | Extraction + codegen + CLI          |
| `@verbaly/unplugin`                                   | webpack · Rollup · esbuild · Rspack |
| `@verbaly/react` · `@verbaly/vue` · `@verbaly/svelte` | Framework adapters                  |

📖 **Docs & live playground:** https://verbaly-web.vercel.app

🔁 **Coming from i18next?** Keep your keys and catalogs — the [migration guide](https://verbaly-web.vercel.app/docs/migrate) maps everything one-to-one.

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
