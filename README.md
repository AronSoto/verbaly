<p align="center">
  <img src="assets/logo.png" alt="Verbaly" width="320" />
</p>

<h3 align="center">Write your text in the code. Ship it in every language.</h3>

<p align="center">
  An i18n compiler and a tiny runtime for React, Vue, Svelte, Next.js, Nuxt, SvelteKit, Astro and plain HTML.<br />
  No key files to keep in sync, params typed from the text, and a CI gate that stops broken translations.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verbaly"><img src="https://img.shields.io/npm/v/verbaly?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AronSoto/verbaly/ci.yml?logo=github&label=CI" alt="CI" /></a>
  <a href="https://codecov.io/gh/AronSoto/verbaly"><img src="https://codecov.io/gh/AronSoto/verbaly/branch/develop/graph/badge.svg" alt="coverage" /></a>
  <a href="https://socket.dev/npm/package/verbaly"><img src="https://badge.socket.dev/npm/package/verbaly/0.77.0" alt="Socket supply chain security" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/AronSoto/verbaly"><img src="https://api.scorecard.dev/projects/github.com/AronSoto/verbaly/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.npmjs.com/package/verbaly#provenance"><img src="https://img.shields.io/badge/provenance-SLSA%20v1-3fb950?logo=npm" alt="published with npm provenance" /></a>
  <img src="https://img.shields.io/badge/gzip-3.35KB-3fb950" alt="3.35KB gzip runtime" />
  <img src="https://img.shields.io/badge/dependencies-0-3fb950" alt="zero runtime dependencies" />
  <img src="https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/verbaly?color=blue" alt="MIT" /></a>
</p>

## The idea

Most i18n tools ask you to invent a key for every sentence, write it in a file per language and keep the files in step with the code by hand. Verbaly turns that around:

```tsx
// with key files: name it, write it in en.json, es.json, pt.json, keep them in sync
t('dashboard.welcome_back', { name });

// with Verbaly: write the sentence where it is used
t`Welcome back, ${name}`;

// and the compiler writes a stable key and a typed call for you
t('ESsQIvlA', { name });
```

The compiler gives each text a stable key, writes your translation files, types every param, plural and date from the text itself, and splits one module per language. The runtime that ships is **3.35 KB gzip** with zero dependencies, measured on every release by a gate in this repo (`pnpm --filter verbaly size`).

## Quick start

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
// anywhere in your app: extracted and typed on save
import { t, setLocale } from 'virtual:verbaly';

t`Hello ${name}`;
await setLocale('es'); // loads only the Spanish module
```

Every framework has a page with its one or two lines: [React](https://verbaly-web.vercel.app/docs/frameworks/react) · [Next.js](https://verbaly-web.vercel.app/docs/frameworks/react#next) · [Vue](https://verbaly-web.vercel.app/docs/frameworks/vue) · [Nuxt](https://verbaly-web.vercel.app/docs/frameworks/vue#nuxt) · [Svelte](https://verbaly-web.vercel.app/docs/frameworks/svelte) · [SvelteKit](https://verbaly-web.vercel.app/docs/frameworks/svelte#sveltekit) · [Astro](https://verbaly-web.vercel.app/docs/frameworks/astro) · [plain HTML](https://verbaly-web.vercel.app/docs/frameworks/dom) · [webpack, Rollup, esbuild, Rspack](https://verbaly-web.vercel.app/docs/frameworks/vite#unplugin)

📖 Full docs: **https://verbaly-web.vercel.app/docs**

## Why Verbaly

- **No key files to maintain.** You write the sentence; the compiler names it and keeps every language file in step.
- **Typed from the text.** `{name}`, plurals, currency and dates are inferred from the message, so a wrong or missing param fails to compile.
- **Broken translations never ship.** `verbaly check` rejects a missing translation, and one that lost a `{param}`, a tag or a plural case, with the reason in plain words. A build reports and goes on; CI is where it stops.
- **Small and fast.** Zero dependencies, one module per language, a memoized hot path benchmarked against i18next on every release.
- **Plain JSON, any workflow.** XLIFF, CSV and gettext PO round trips for translators, Android and iOS exports, and machine translation that stays a draft until a person approves it.
- **Ready for coding agents.** An MCP server, an Agent Skill and `llms.txt`, with drafts an agent cannot approve.

## How it compares

|                           | **Verbaly**           | i18next              | Lingui                 | Paraglide      | typesafe-i18n |
| ------------------------- | --------------------- | -------------------- | ---------------------- | -------------- | ------------- |
| Type-safe keys & params   | ✅ inferred from text | plugin/manual        | partial                | ✅             | ✅            |
| Runtime size (gzip)       | **3.35KB, zero deps** | 13.6KB (19.0 +react) | 2.2KB (3.3 +react)     | compiled       | 1.2KB         |
| Setup                     | 1 Vite plugin         | heavy config         | macros + Babel/SWC     | inlang project | generator     |
| Key maintenance           | **none, extracted**   | by hand              | extract → compile step | by hand        | by hand       |
| Dynamic / CMS content     | ✅ real runtime path  | ✅                   | ✅                     | ⚠️ weak        | ✅            |
| Plain HTML (no framework) | ✅ DOM interpreter    | ❌                   | ❌                     | ❌             | ❌            |
| Missing-translation gate  | ✅ fails CI only      | runtime warning      | CI step                | ✅             | ❌            |
| Broken-translation gate   | ✅ fails CI only      | ❌                   | ❌                     | ❌             | ❌            |
| Catalog format            | plain JSON            | JSON                 | PO/JSON                | inlang format  | TS files      |

Sizes are min+gzip of each library's main entry with React external, measured with the same method on 2026-10-15.

## Packages

| Package                                                                                                          | What it is                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`verbaly`](packages/core)                                                                                       | The runtime: `t`, `Intl` formats, locale helpers and the DOM interpreter |
| [`@verbaly/compiler`](packages/compiler)                                                                         | Extraction, typed codegen, the gate and the `verbaly` command            |
| [`@verbaly/vite`](packages/vite) · [`@verbaly/unplugin`](packages/unplugin)                                      | Bundler plugins: Vite, and webpack, Rollup, esbuild and Rspack           |
| [`@verbaly/react`](packages/react) · [`@verbaly/vue`](packages/vue) · [`@verbaly/svelte`](packages/svelte)       | Framework adapters: hooks or composables plus `<Trans>`                  |
| [`@verbaly/next`](packages/next) · [`@verbaly/nuxt`](packages/nuxt) · [`@verbaly/sveltekit`](packages/sveltekit) | Server rendering: the language per request, hydration with no flash      |
| [`@verbaly/astro`](packages/astro)                                                                               | Astro integration: `.astro` extraction and a static build per language   |
| [`@verbaly/mcp`](packages/mcp)                                                                                   | MCP server: the translation cycle as tools for an agent                  |
| [`@verbaly/studio`](packages/studio)                                                                             | A local review panel over your translation files                         |

All of them share one version number, and every release is published from CI with npm provenance.

## Coding agents

Give your agent the whole cycle as tools, with structured output and resources to read your config and catalogs:

```bash
claude mcp add verbaly -- npx -y @verbaly/mcp
```

Machine translations stay drafts until a person approves them (`verbaly review --approve`, or Studio), so an agent can fill gaps without shipping unreviewed text: approving is deliberately not a tool. The [Agent Skill](skills/verbaly/SKILL.md) teaches the write, extract, check and translate cycle (`npx degit AronSoto/verbaly/skills/verbaly .claude/skills/verbaly`), and the docs publish [llms.txt](https://verbaly-web.vercel.app/llms.txt).

## Review translations locally

```bash
npx verbaly-studio
```

A panel over localhost with every message, what is missing, what is broken, what a machine wrote and where each text lives in your code. Your JSON files are the database and git is the history, a save runs the same validations as `verbaly check`, and it never edits your source text.

<details>
<summary><strong>Editor: see the text behind a key on hover</strong></summary>

Generated keys are hashes, so `t('a1B2c3D4')` in a diff tells you nothing. The [i18n-ally](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally) extension shows the real text inline once you point it at your catalogs. Two files, no Verbaly config changes:

`.vscode/settings.json`

```json
{
  "i18n-ally.localesPaths": ["locales"],
  "i18n-ally.keystyle": "flat",
  "i18n-ally.sourceLanguage": "en",
  "i18n-ally.displayLanguage": "en"
}
```

`.vscode/i18n-ally-custom-framework.yml`

```yaml
languageIds:
  - javascript
  - typescript
  - javascriptreact
  - typescriptreact
  - vue
  - svelte
  - astro
usageMatchRegex:
  - "[^\\w\\d]t\\(\\s*['\"`]({key})['\"`]"
monopoly: true
```

`keystyle` has to match your catalogs: `flat` for dotted keys, `nested` for groups. Use the extension for reading, not writing: its extract and rename actions assume you own the keys, and here the compiler does.

</details>

## Development

```bash
pnpm install
pnpm build      # tsdown: ESM + CJS + .d.ts
pnpm test       # each package's suite
pnpm typecheck
pnpm --filter verbaly bench   # the hot path against i18next
```

Verbaly is `0.x`: the API can still change between minor versions, and every change is in the [changelog](changelog/CHANGELOG.md). Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Feedback

- **Something broke or surprised you:** [open a bug](https://github.com/AronSoto/verbaly/issues/new?template=bug_report.yml). A minimal snippet is enough.
- **Something felt like friction:** [tell us what](https://github.com/AronSoto/verbaly/issues/new?template=feature_request.yml). The roadmap follows real use.
- **It just works:** a [star](https://github.com/AronSoto/verbaly) or a mention helps others find it.

## Sponsor

Verbaly is MIT-licensed, dependency-free and built independently. If it saves you time, [sponsoring it](https://github.com/sponsors/AronSoto) funds the road to 1.0: more integrations, faster releases and long-term maintenance.

<p align="center">
  <a href="https://github.com/sponsors/AronSoto"><img src="https://img.shields.io/badge/♥%20Sponsor%20Verbaly-bef12d?style=for-the-badge&logoColor=1a1f16" alt="Sponsor Verbaly on GitHub" /></a>
</p>

## License

[MIT](./LICENSE) © Aron Soto · [@AronSoto](https://github.com/AronSoto)
