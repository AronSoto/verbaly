<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Message extraction, type-safe codegen and CLI for Verbaly.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/compiler"><img src="https://img.shields.io/npm/v/@verbaly/compiler?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/compiler?color=blue" alt="MIT" /></a>
</p>

---

The compiler behind [Verbaly](https://github.com/AronSoto/verbaly): AST extraction of `` t`…` `` **and JSX `<Trans>` children** into stable hashed keys (or **readable keys** via `` t.id('inbox.title')`…` `` and `<Trans id="inbox.title">…</Trans>`), flat JSON catalog sync, and typed codegen. It also ships the **`verbaly` CLI**.

Extraction covers `.js`/`.ts`/`.jsx`/`.tsx` **and `.svelte`, `.vue` and `.astro` single-file components**: script blocks and frontmatter, plus markup expressions (Svelte's `$t` store form included). Text that only sits on screen is never extracted, so a documented snippet cannot become a real key.

> Most projects don't install this directly: [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) wraps it with zero config. Reach for it when scripting extraction/checks yourself.

## 🧰 CLI

```bash
npx verbaly init           # scaffold config + locale catalogs (detects your bundler)
npx verbaly doctor         # diagnose the setup (config, catalogs, wiring, types, translations)
npx verbaly wrap           # onboarding codemod: report plain JSX text, --write wraps it in t``
npx verbaly extract        # sync catalogs + types
npx verbaly extract --watch  # keep extracting as you code (dev loop)
npx verbaly extract --prune  # drop orphaned keys
npx verbaly status         # coverage per locale, plus unreviewed and broken counts
npx verbaly check          # exit 1 if anything is missing or broken (CI)
npx verbaly translate      # fill missing translations via Claude (or your provider), as drafts
npx verbaly review         # list machine drafts, --approve accepts them
npx verbaly export         # translator files (XLIFF 2.0, CSV, gettext PO) or mobile resources (Android, iOS)
npx verbaly import <files> # fill catalogs back from translated XLIFF/CSV/PO files
npx verbaly pseudo         # generate a pseudo-locale catalog for i18n QA (en-XA)
npx verbaly render         # pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)
```

Reads `verbaly.config.{js,mjs,ts,mts,json}` (TS configs need `esbuild` installed). Generates `locales/<locale>.json` (flat, portable, no proprietary format) and `verbaly.d.ts` with params typed per key.

## 🚦 The build gate

`verbaly check` is the only command that exits 1, and it asks two questions, not one.

**Is every message translated?** A missing key or an empty value fails the build, so raw keys never reach production.

**Can the translation render what the source renders?** Presence is not correctness. These fail too, each with the reason in plain words:

| The translation…                        | Why it fails                                   |
| --------------------------------------- | ---------------------------------------------- |
| lost a `{param}`, or renamed it         | the value never reaches the text               |
| lost an `<em>` (or gained one)          | the emphasis, code or link marker is gone      |
| turned a plural block into plain text   | one form for every count                       |
| has a plural block with no `other` case | every count it does not list renders **empty** |

Two more are reported as **warnings** and keep the exit code at 0, because the text still renders: a plural set missing forms the target language needs (Polish or Arabic want more than English), and a dropped `=0` style case that now falls back to `other`.

```bash
npx verbaly check                     # text report
npx verbaly check --reporter github   # ::error and ::warning annotations on the PR, at the source line
npx verbaly check --drafts            # also fail while machine translations await review
```

Hand-edited catalogs get the same treatment as imported files: the gate does not care where a translation came from.

## 🤖 Machine translation

`verbaly translate` fills the `""` holes `check` reports. The default provider uses Claude via the official SDK; install it as a dev dependency (translation is a build-time step, not an app runtime dependency): `pnpm add -D @anthropic-ai/sdk` (or `npm i -D`), plus `ANTHROPIC_API_KEY`. Default model is `claude-sonnet-5` (balanced quality/cost); override with `translate.model` in config or `--model <id>`. Placeholders, variants and tags are validated after translation: anything not preserved verbatim stays `""` so `check` keeps failing.

**Machine output is a draft until a human says yes.** Everything `translate` writes is recorded in `locales/.verbaly-drafts.json` (commit it, never edit it by hand). `verbaly review` lists the drafts, `--approve` accepts them, and importing a translator's file clears the flag because a human already reviewed it. `verbaly check --drafts` turns "nothing unreviewed ships" into a CI rule; plain `check` leaves it alone, since a draft has a value and is therefore not missing.

Plug your own provider in `verbaly.config.ts`:

```ts
translate: {
  provider: async ({ sourceLocale, targetLocale, messages }) => ({ ...translated });
}
```

## 🌍 Human translators & TMS

Catalogs are **flat JSON**: most TMS platforms (Crowdin, Lokalise, Phrase, …) ingest them natively; point the platform at `locales/` and you're done. For everything else there's a built-in round-trip:

```bash
npx verbaly export                    # verbaly-export/<locale>.xlf (XLIFF 2.0, source + target per unit)
npx verbaly export --format csv       # spreadsheet-friendly: key,source,target,location
npx verbaly export --format po        # gettext PO (msgctxt = key, works with any PO editor)
npx verbaly import verbaly-export/es.xlf   # fill the catalog back
```

`export` writes one file per target locale with the source text alongside the current translation (`--missing` exports only the untranslated entries). Every entry carries **where the text lives in your source** (XLIFF `location` notes, a `location` column in CSV, `#:` comments in PO), so translators and TMS tools see the context instead of guessing it. In XLIFF, `{params}` and rich tags travel as **protected inline codes with semantic ids** (`<ph id="name"/>`, `<pc id="em">`), so TMS editors show them as untouchable chips instead of editable raw syntax. `import` reads XLIFF 2.0/1.2, CSV or PO back (PO entries flagged `fuzzy` count as untranslated) and **validates every entry like `translate` does**: a translation that drops a `{param}`, a variant block or an `<em>` tag is rejected and reported, so a translator's typo can't break your UI. Existing translations are kept unless `--overwrite`; `--dry-run` previews everything.

## 📱 Mobile resources

The same catalogs can ship to a companion mobile app as drop-in native resources:

```bash
npx verbaly export --format android-xml   # verbaly-export/values-<locale>/strings.xml (drop into res/)
npx verbaly export --format ios-strings   # verbaly-export/<locale>.lproj/Localizable.strings (drop into Xcode)
```

Your source locale becomes the platform default (`values/strings.xml`, `en.lproj`), and untranslated keys are skipped so the app falls back to it natively instead of showing empty text. Keys are sanitized to valid Android resource names (`hero.title` → `hero_title`; a collision fails loudly), values keep Verbaly's `{name}` syntax. Export-only by design: translations flow from your catalogs to the app.

## 📄 Static rendering (SSG)

`verbaly render` walks your built site (`dist/` by default, `--site <path>` to change) and pre-fills every `data-verbaly` element **per locale** using the real runtime: plurals, `Intl` formatting, `data-verbaly-args`, attribute translation and `data-verbaly-rich` (same whitelist, XSS-safe). The source locale is filled in place; every other locale is mirrored to `dist/<locale>/…` with `<html lang>` set. Static HTML ships already translated (**no flash of untranslated content**) and the runtime attributes stay put, so client-side locale switching keeps working.

Named links in rich messages render as real `<a>` elements; hrefs come from config or markup, never from messages (`javascript:` blocked):

```ts
// verbaly.config.ts
render: { links: { docs: { href: '/docs', target: '_blank', rel: 'noopener' } } }
```

Per-element `data-verbaly-links='{"repo":"https://…"}'` merges over the config map.

**Multi-locale SEO**: set `render.baseUrl` (or `--base-url`) and every page gets reciprocal `<link rel="alternate" hreflang>` (plus `x-default`) for the whole locale set; `--sitemap` writes a locale-aware `sitemap-i18n.xml`. `--clean` drops stale `dist/<locale>/` pages before mirroring. Injection is idempotent.

## 🔍 Pseudo-localization

`verbaly pseudo` fills a QA catalog (`en-XA` by default, `--locale <id>` to change) from the source: accented letters, `⟦…⟧` markers and ~33% length padding reveal hardcoded strings, clipped layouts and concatenation bugs. Params, variant blocks and tags survive verbatim, with the same structural validation as `translate`.

📖 Docs: **https://verbaly-web.vercel.app/docs/reference/cli**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
