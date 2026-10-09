<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Message extraction, type-safe codegen and CLI for Verbaly.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/compiler"><img src="https://img.shields.io/npm/v/@verbaly/compiler?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/compiler?color=blue" alt="MIT" /></a>
</p>

---

The compiler behind [Verbaly](https://github.com/AronSoto/verbaly): AST extraction of `` t`…` `` **and JSX `<Trans>` children** into stable hashed keys (or **readable keys** via `` t.id('inbox.title')`…` `` and `<Trans id="inbox.title">…</Trans>`), JSON catalog sync, and typed codegen. It also ships the **`verbaly` CLI**.

Extraction covers `.js`/`.ts`/`.jsx`/`.tsx` **and `.svelte`, `.vue` and `.astro` single-file components**: script blocks and frontmatter, plus markup expressions (Svelte's `$t` store form included). Text that only sits on screen is never extracted, so a documented snippet cannot become a real key.

> Most projects don't install this directly: [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) wraps it with zero config. Reach for it when scripting extraction/checks yourself.

## 🧰 CLI

```bash
npx verbaly init           # scaffold config + locale catalogs (detects your framework)
npx verbaly doctor         # diagnose the setup (config, catalogs, wiring, types, translations)
npx verbaly wrap           # onboarding codemod: report plain JSX text, --write wraps it in t``
npx verbaly migrate        # port catalogs from another i18n library (--write applies, --plurals merges)
npx verbaly extract        # sync catalogs + types
npx verbaly extract --watch  # keep extracting as you code (dev loop)
npx verbaly extract --prune  # drop orphaned keys (waits while any source file does not parse)
npx verbaly extract --dry-run  # say what extract would add and prune, write nothing
npx verbaly typegen        # write the TypeScript types alone (CI: run it before tsc)
npx verbaly status         # coverage per locale, plus unreviewed, broken and outdated counts
npx verbaly check          # exit 1 if anything is missing or broken (CI)
npx verbaly translate      # fill missing translations via Claude (or your provider), as drafts
npx verbaly review [keys]  # drafts and outdated translations with their texts, --approve accepts them
npx verbaly-studio         # the same catalogs on localhost (@verbaly/studio, separate package)
npx verbaly export         # translator files (XLIFF 2.0, CSV, gettext PO) or mobile resources (Android, iOS)
npx verbaly import <files> # fill catalogs back from translated XLIFF/CSV/PO files
npx verbaly pseudo         # generate a pseudo-locale catalog for i18n QA (en-XA)
npx verbaly render         # pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)
```

Reads `verbaly.config.{js,mjs,ts,mts,json}` (TS configs need `esbuild` installed). Generates `locales/<locale>.json` (portable JSON, flat or nested, whichever the file already is) and the TypeScript types of your messages, [where your framework looks for them](#-typed-keys-and-where-the-types-live).

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

A third warning is a key that **only a translation has**. It never fails the build either, and the report says which case it is: your code reads it, so the source language shows the raw key there, or nothing reads it and it is dead weight in that language's download (`extract --prune` drops it).

Three more warnings name things that used to happen in silence, each with the file and line to go to:

- **One key, two texts.** Two `` t.id('k')`…` `` with different texts both render the one written first, by file path, so the order your files load never picks it. The report lists every place that disagrees.
- **The catalog and the code disagree.** A text written in your code is the code's: the build ships it, and the source catalog only mirrors it (see [where a text lives](#-where-a-text-lives)).
- **An outdated translation.** The source text changed after the translation was written, and nobody has looked at the translation since. It is read against the text that ships, the one in your code, so it is caught even before `extract` runs.

The bundler plugins run the same gate on `build`, and when `check` has warnings the build prints one line saying how many, then passes: `npx verbaly check` reads them out.

```bash
npx verbaly check                     # text report
npx verbaly check --reporter github   # ::error and ::warning annotations on the PR, at the source line
npx verbaly check --drafts            # also fail while machine translations await review
npx verbaly check --outdated          # also fail while a translation is older than its source text
```

Under `--outdated` those translations are printed with the failures, and the GitHub reporter marks them as `::error` on the catalog file, since they are what fails the job.

Hand-edited catalogs get the same treatment as imported files: the gate does not care where a translation came from.

## 🧭 Where a text lives

A message keeps its text in exactly one place, and that place is where you edit it:

| You write                                 | The text lives in                  | You change it in        |
| ----------------------------------------- | ---------------------------------- | ----------------------- |
| `` t`Save changes` ``                     | the code (the key is a hash of it) | the code                |
| `` t.id('settings.save')`Save changes` `` | the code, under a key you chose    | the code                |
| `t('settings.save')`                      | the source catalog                 | `locales/<source>.json` |

**The code wins over the catalog for the texts it writes.** `extract`, the dev servers and the build all use the text in the code, so a hand edit of one in the source catalog is replaced, and Verbaly tells you and points at the line where the text lives. `extract` prints one line per text that followed the code, with the text it had before: an edit you made in the code reads as a change, and one made in the catalog shows exactly what it undid. Every command that reads a source text reads that same one, the text that ships: `check`, `status`, `review`, `translate`, `export`, `import`, Studio and the MCP server.

**Keys first** is the third row: the text lives only in the catalog, and a literal `t('settings.save')` counts as a use, so `--prune` keeps it. When a key comes from data instead of a literal, declare the keys with `defineKeys`, so the compiler sees them and TypeScript checks them where you write them:

```ts
import { defineKeys } from 'virtual:verbaly';

const titles = defineKeys({ verbaly: 'project.verbaly.title', blog: 'project.blog.title' });
t(titles[slug]);
```

`defineKeys` is detected by name, like `t`. It comes from `virtual:verbaly`, the module generated for your project, which is the one the framework provider already loads.

**A translation knows which source text it was written for.** For readable keys, the second and third rows, Verbaly keeps a short fingerprint of the source text and of the translation in `.verbaly-state.json`, next to your catalogs. It is taken the moment the translation is written, by `translate`, `import`, Studio or an agent, so a source that changes right after is still caught; `import` takes it from the source text the translator's file carries, so a file made for an older text reads as outdated at once. When the source text changes and the translation does not, the translation is **outdated**: `status`, `check` and `doctor` say so, `review` lists it with both texts, and `review --approve` keeps it if it still holds. Editing the translation clears it on its own. Hash keys never need this, because a new text is a new key.

Four details that catch people out:

- **Keep the files that write `t` inside `include`.** The default reads `src/` and `app/`. A file outside them, like `components/` in a Next app without `src/`, is never extracted, so its text shows in the source language in every language. `@verbaly/next`, the Vite plugin and unplugin say so once when they start, with the pattern to add, and `doctor` lists every such file.
- **Name it `t`.** The compiler reads calls named `t`. `const tr = useT()` works at runtime, but `` tr`…` `` is never extracted, so that text stays in the source language. `extract`, `doctor` and the dev servers name every such call with its file and line, in `.vue`, `.svelte` and `.astro` files too, and `--prune` keeps the translations it reads until it is renamed. Only a `useT` or `getT` from a Verbaly package (or auto-imported, as Nuxt does) counts, so a `t` from another library is left alone.
- **A number param is formatted for the language.** `{year}` with `2026` renders `2,026` in English, the same as ICU. Pass `String(year)` when the value is a label, not a quantity.
- **Literal braces are doubled in a catalog.** `{{` shows `{`. `extract` does it for you from code; a catalog written by hand has to do it itself.

## 🔑 Typed keys, and where the types live

Every `t` your project holds checks its keys and their params: the one from `virtual:verbaly`, `useT()` in React, Vue and Svelte, `getT()` in Next, and the `t` of an instance from `createInstance` or `createRequestInstance`. A key no catalog has does not compile, a message with a `{name}` asks for it, and Next's `getRequestLocale()` returns one of your locales instead of any string:

```ts
const t = useT();
t('settings.save'); // ✓
t('settings.sav'); // ✗ '"settings.sav"' is not assignable to parameter of type 'VerbalyKey'
t('greeting'); // ✗ greeting is "Hello {name}", so it asks for { name }
t(item.key); // ✓ a key that comes from data passes as it is
```

A key you write is checked, through a `const` or a template of literals too. A key that comes from data, a `string` or a template with a part from data like ``t(`status.${s}`)``, passes as it is, since no catalog can tell which key it will be. Declare such keys with `defineKeys` (above) when you want `check` to verify they exist and `--prune` to keep them.

The types are one generated file, written where your framework's TypeScript already reads, so there is nothing to add to `tsconfig.json`:

| Project                                                             | The file                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                                                             | `.verbaly/types.d.ts`, next to the generated modules. TypeScript skips a dot folder, so its line in `tsconfig.json` is added for you, the way Next adds `.next/types` |
| Astro                                                               | `.astro/integrations/_verbaly_astro/verbaly.d.ts`, the slot Astro gives integrations                                                                                  |
| Nuxt                                                                | `.nuxt/verbaly.d.ts`, the slot Nuxt gives modules                                                                                                                     |
| Vite, SvelteKit, webpack, Rollup, esbuild, Rspack, or the CLI alone | `src/verbaly.d.ts`, the folder every app template includes, or `verbaly.d.ts` when there is no `src/`                                                                 |

`extract`, `typegen`, the dev servers, Studio and the MCP server all write that same file, and `dts` in your config still names another one (`dts: false` writes none). A `verbaly.d.ts` an older Verbaly left at the root is removed the first time the new one is written, because the two would declare the same module; one you wrote yourself, without the generated header, is left alone.

In CI, write the types before you check them, since a fresh clone has none: `npx verbaly typegen && tsc --noEmit`. In Next, `next typegen` writes them as well, because it loads the same config: `next typegen && tsc --noEmit`.

## 🤖 Machine translation

`verbaly translate` fills the `""` holes `check` reports. The default provider uses Claude via the official SDK; install it as a dev dependency (translation is a build-time step, not an app runtime dependency): `pnpm add -D @anthropic-ai/sdk` (or `npm i -D`), plus `ANTHROPIC_API_KEY`. Default model is `claude-sonnet-5-5` (balanced quality/cost); override with `translate.model` in config or `--model <id>`. Each model is asked for the least thinking it accepts, so any current Claude model works there, and on the models that support it a batch the model declines is answered by Anthropic's recommended fallback model instead of coming back untranslated. Placeholders, variants and tags are validated after translation: anything not preserved verbatim stays `""` so `check` keeps failing.

Long runs survive the network. Batches go out in parallel (`translate.concurrency`, default 4), a transient failure is retried (`translate.retries`, default 2), and a batch that still does not answer is reported with its keys while every batch that did answer is written: re-running asks only for what is left.

Two config options steer the wording. `translate.instructions` is free text appended to the system prompt (tone, address form, product voice), and `translate.glossary` states how a term has to come out, for all locales or per locale, so a brand name never comes back translated:

```ts
export default {
  sourceLocale: 'en',
  locales: ['en', 'es', 'pt'],
  translate: {
    instructions: 'Address the reader informally. Keep UI labels short.',
    glossary: { Verbaly: 'Verbaly', checkout: { es: 'pago', pt: 'pagamento' } },
  },
};
```

Only the terms a batch actually contains are sent, so a glossary of hundreds never becomes the prompt.

**Machine output is a draft until a human says yes.** Everything `translate` writes is recorded in `locales/.verbaly-state.json`, the file that also holds the fingerprints above: commit it, and never edit it by hand. `verbaly review` lists the drafts with the source text and the translation side by side, `--approve` accepts them (`verbaly review home.title --approve` accepts only the keys you name), and importing a translator's file clears the flag because a human already reviewed it. `import --draft` keeps them as drafts instead, for a file nobody has read yet. An agent that translates on its own saves its work through the MCP tool `verbaly_write_drafts`, which checks it like a provider's and marks it as a draft. `verbaly check --drafts` turns "nothing unreviewed ships" into a CI rule; plain `check` leaves it alone, since a draft has a value and is therefore not missing. `extract` keeps the file in step with the catalogs, so a pruned key takes its draft with it, and the file disappears when there is nothing left in it. It only ever touches the languages it read: `extract --locales es` leaves every other language's drafts and fingerprints as they were. If the file cannot be read, say after a merge conflict, the commands that only read it warn and go on, and the ones that would write drafts stop before writing anything: restore it from git, because deleting it would mark every draft as reviewed.

Plug your own provider in `verbaly.config.ts`. In TypeScript, `TranslateProvider` types it for you:

```ts
import type { TranslateProvider } from '@verbaly/compiler';

const provider: TranslateProvider = async ({ targetLocale, messages, origins, glossary }) => {
  // origins maps a key to the source files it appears in, so you can translate with context
  // glossary and instructions ride along too: a custom provider gets the same steering
  return { ...translated };
};

export default { sourceLocale: 'en', locales: ['en', 'es'], translate: { provider } };
```

## 🔗 Where the language lives in the URL

One setting, because every other URL answer follows from it:

**You usually write nothing.** The mode follows your setup: a project with a `render` section builds one URL tree per language, so it is `prefix-except-source`; a project without one has a single address, so it is `no-prefix`. Say it out loud only to disagree:

```ts
export default {
  sourceLocale: 'en',
  locales: ['en', 'es', 'pt'],
  routing: 'prefix-all', // /en/docs and /es/docs, when no language is the house language
};
```

| `routing`              | The address               | Switching language is         |
| ---------------------- | ------------------------- | ----------------------------- |
| `prefix-except-source` | `/docs` and `/es/docs`    | a navigation                  |
| `prefix-all`           | `/en/docs` and `/es/docs` | a navigation                  |
| `no-prefix`            | `/docs` in every language | the text changing where it is |

Pick by surface, not by taste: [Google recommends a different URL per language](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) rather than cookies or browser settings, so anything people reach through search wants the language in the address. An app behind a login loses nothing with `no-prefix`.

`virtual:verbaly` exports `routing`, `localePath`, `localeFromPath` and **`switchLocale`, already bound** to your locales, source and mode. The switcher is one line and it is the same line in every mode:

```ts
import { switchLocale } from 'virtual:verbaly';

await switchLocale('es');
```

Under a prefix mode that goes to `/es/…`, which is already rendered in Spanish, so there is no catalog to fetch and no flash. Under `no-prefix` it swaps the text where it stands and the address never changes. Either way it remembers the choice, in the cookie a server reads **and** in the storage the pre-paint redirect reads, and it sets `<html lang>` and `<html dir>`. Pass your framework's router so the app survives the switch:

```ts
await switchLocale('es', { navigate: (path) => router.push(path) });
```

`npx verbaly doctor` names the mode you are in, and says so when the mode and a `render` section disagree: `render` keeps the source language at the root and writes every other language under its own prefix, which is `prefix-except-source`.

## 🧪 What the runtime carries, and what it does not

Verbaly's own syntax covers plurals, selects and formats, and [ICU message syntax](https://unicode-org.github.io/icu/userguide/format_parse/messages/) is the escape hatch for what it does not. **You pay for the escape hatch only if you open it.** The compiler reads your catalogs, and if any message uses ICU it wires the parser into the generated runtime; if none does, the parser is not in your bundle at all. Measured on a real app bundle: **544 bytes gzip**, which is 15% of the runtime.

**Relative time works the same way.** `{when:relative}` and `{n:relative/day}` pull `Intl.RelativeTimeFormat` and a unit table, another **318 bytes**, and most apps never write one. Same deal: the compiler sees it in your catalogs and wires it, or it is not in your bundle.

Nothing to configure. The one case the catalogs cannot answer is a message that arrives after the build, from a CMS or a fetched catalog:

```ts
export default { locales: ['en', 'es'], icu: true, relative: true }; // ship them anyway
```

Without that, such a message renders **its own source text** (ICU) or the raw value with a warning that names what is missing (relative), rather than half-rendering into something that looks plausible.

The other format cases stay in the runtime always, and that is measured rather than assumed: `currency`, `date`, `time`, `unit`, `list`, `percent` and `integer` cost **24 to 38 bytes each**, so making them optional would buy less than the machinery to do it.

## 🌍 Human translators & TMS

Catalogs are **plain JSON**, in whichever shape your file already has: most TMS platforms (Crowdin, Lokalise, Phrase, …) ingest them natively; point the platform at `locales/` and you're done. For everything else there's a built-in round-trip:

```bash
npx verbaly export                    # verbaly-export/<locale>.xlf (XLIFF 2.0, source + target per unit)
npx verbaly export --format csv       # spreadsheet-friendly: key,source,target,location
npx verbaly export --format po        # gettext PO (msgctxt = key, works with any PO editor)
npx verbaly import verbaly-export/es.xlf   # fill the catalog back
```

`export` writes one file per target locale with the source text alongside the current translation (`--missing` exports only the untranslated entries). Every entry carries **where the text lives in your source** (XLIFF `location` notes, a `location` column in CSV, `#:` comments in PO), so translators and TMS tools see the context instead of guessing it. In XLIFF, `{params}` and rich tags travel as **protected inline codes with semantic ids** (`<ph id="name"/>`, `<pc id="em">`), so TMS editors show them as untouchable chips instead of editable raw syntax. `import` reads XLIFF 2.0/1.2, CSV or PO back (PO entries flagged `fuzzy` count as untranslated) and **validates every entry like `translate` does**: a translation that drops a `{param}`, a variant block or an `<em>` tag is rejected and reported, so a translator's typo can't break your UI. Existing translations are kept unless `--overwrite`; `--dry-run` previews everything.

A file names its language the way its tool writes it, so `import` reads that name as one of your locales: gettext's `pt_BR` (or a `PT-br`) fills the `pt-BR` you have. A file for a new language starts its catalog, under the tag's proper spelling, unless your config lists its `locales`: then a language outside that list is skipped with a warning and exit code 1, because the app would never load it. Add the locale to the list first, or pass `--locale`.

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

**The head is half of what a search result shows.** A mirrored page whose `<title>` and `<meta name="description">` are not bound ships the source language to every locale, which is most of the reason to give a locale its own URL in the first place. Bind them like anything else, and `render` fills them:

```html
<title data-verbaly="page.title">URL strategy</title>
<meta name="description" content="…" data-verbaly-attr='{"content":"page.desc"}' />
<meta property="og:title" content="…" data-verbaly-attr='{"content":"page.title"}' />
```

`verbaly render` counts the pages whose title never varies and says so, once, with the fix. It is a warning and never fails a build: a site can have a name that does not translate.

**Multi-locale SEO**: set `render.baseUrl` (or `--base-url`) and every page gets reciprocal `<link rel="alternate" hreflang>` (plus `x-default`) for the whole locale set; `--sitemap` writes a locale-aware `sitemap-i18n.xml`. `--clean` drops stale `dist/<locale>/` pages before mirroring. Injection is idempotent.

### Text that only one page needs

A catalog only grows, and every page downloads all of it. A changelog, a blog archive or a long FAQ makes every visitor pay for text they are not looking at. Name those groups and they stay in the build:

```ts
export default {
  locales: ['en', 'es'],
  bundle: { exclude: ['changelog'] }, // still pre-filled by render, no longer downloaded
  render: { baseUrl: 'https://example.com' },
};
```

`render` keeps reading the full catalogs, so those pages still publish translated; the browser just stops fetching that text. Entries are key prefixes matched whole segment by whole segment, so `nav` never takes `navbar` with it, and `changelog.v1` excludes one version instead of the group. Measured on this project's own docs site: the locale chunk goes from **55.6 KB to 39.3 KB brotli** with nothing lost on screen.

**It composes with `render.inlineCatalog`, it is not replaced by it.** With both on, a mirrored page ships only the messages it renders (**2.86 KB brotli** on that site's home) and fetches no chunk at all, while the exclusion caps what a visitor would download on the day something does need the catalog.

**Use it for text `render` covers.** A key that is excluded and then asked for at runtime resolves to itself, like any absent key, and `bindDom` leaves the pre-rendered text alone rather than painting the key over it. The build says so when a prefix matches nothing, and when your code reads an excluded key through `t()`. To use an excluded group at runtime anyway, load it yourself:

```ts
import { verbaly } from 'virtual:verbaly';

const extra = await import(`./i18n/changelog/${locale}.json`);
verbaly.addMessages(locale, extra.default);
```

## 🔍 Pseudo-localization

`verbaly pseudo` fills a QA catalog (`en-XA` by default, `--locale <id>` to change) from the source: accented letters, `⟦…⟧` markers and ~33% length padding reveal hardcoded strings, clipped layouts and concatenation bugs. Params, variant blocks and tags survive verbatim, with the same structural validation as `translate`.

📖 Docs: **https://verbaly-web.vercel.app/docs/reference/cli**

> ⚠️ Early development (`0.x`): API not stable yet.

## 🧩 Programmatic API

Almost nobody needs this: the CLI and the framework plugins cover the whole cycle. It exists for the one case they do not, building your own integration for a bundler or a tool we do not ship.

The package exports two layers, and **nothing else is public**. Anything you can see in the source but not in this list is internal and can change in any release.

**Your project's own types**, for a typed config file or a custom provider:

`VerbalyConfig` · `ResolvedConfig` · `RenderConfig` · `RedirectConfig` · `BundleConfig` · `TranslateConfig` · `GlossaryEntry` · `TranslateProvider` · `TranslateRequest` · `TranslateResult` · `TranslateOptions` · `TranslateProgress` · `TranslateFailure`

**Building an integration.** This is exactly what `@verbaly/vite`, `@verbaly/unplugin`, `@verbaly/next`, `@verbaly/astro`, `@verbaly/nuxt`, `@verbaly/mcp` and `@verbaly/studio` consume, so a third one has everything they have:

| Area              | Exports                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup             | `init` · types `Host` `InitOptions` `InitResult`                                                                                                                       |
| Config & catalogs | `loadConfig` `resolveConfig` `targetLocales` `loadCatalogs` `readCatalog` `parseCatalog` `writeCatalog` `clientCatalogs` `needsIcu` `needsRelative` · types `Catalog` `Catalogs`                                                                                                                       |
| Extraction        | `syncProject` `extractProject` `collectOrigins` `syncCatalogs` `shippedCatalogs` `pruneCatalogs` `MessageRegistry` `stableKey` `watchTree` · types `SyncProjectResult` `SyncResult` `TreeOptions`                                                                                            |
| Codegen           | `generateDts` `writeDts` `generateRuntimeModule` `generateLocaleModule` · types `DtsOptions` `RuntimeModuleOptions`                                                                                                                                    |
| Bundler plumbing  | `transformSource` `transformCode` `runBuildGate` `createSourceFilter` `reportOutsideInclude` `isTransformTarget` `resolveVirtualId` `loadVirtualModule` `RESOLVED_VIRTUAL_ID` `LOCALE_MODULE_PREFIX` `SOURCE_FILE_RE` · types `PluginOptions` `TransformResult` |
| The gate          | `check` `validateMessage` `validatePair` `formatCheckResult` `formatCheckWarnings` `collisionEntries` `formatCollision` `formatFinding` `createDevReporter` · types `Finding` `DevReporter` `CheckResult` `MissingEntry` `UnknownEntry` `BrokenEntry` `ExtraEntry` `CollisionEntry` `DivergentEntry` `OutdatedEntry` `SourceSite` `StructureIssue` `IssueSeverity` |
| Coverage          | `status` `formatStatusResult` `counted` · types `StatusResult` `LocaleStatus`                                                                                                                                                            |
| Review state      | `loadDrafts` `saveDrafts` `markDrafts` `clearDrafts` `effectiveDrafts` `loadState` `readState` `updateState` `recordTranslations` `outdatedTranslations` `STATE_FILE` · types `Drafts` `State` `Fingerprints` `TranslationWrite`                                                            |
| Translation       | `translateCatalogs` `mergeTranslations` `writeDrafts` `resolveProvider` `formatTranslateFailures` · types `DraftEntry` `WriteDraftsResult`                                                                                               |
| Diagnosis         | `doctor` `formatDoctorEntry` · types `DoctorResult` `DoctorEntry`                                                                                                                                                                        |
| Onboarding        | `wrapProject` · types `WrapResult` `WrapEntry` `WrapSkip` `WrapBlocked` `WrapOptions`                                                                                                                                                                  |
| Static rendering  | `renderSite` `formatRenderWarnings` · types `RenderSiteOptions` `RenderSiteResult`                                                                                                                       |
| Error output      | `formatCliError`                                                                                                                                                       |

A minimal plugin is `loadConfig` + `loadCatalogs` once, then `transformSource` per file and `runBuildGate` at the end:

```ts
import {
  MessageRegistry,
  loadCatalogs,
  loadConfig,
  runBuildGate,
  transformSource,
} from '@verbaly/compiler';

const cfg = await loadConfig(process.cwd());
const catalogs = loadCatalogs(cfg);
const registry = new MessageRegistry();

// per file: rewrites t`…` to a keyed call and hands you the messages it found
const { messages, result } = transformSource(code, id, registry);

// at the end of the build: throws with the reason and the remedy
runBuildGate(cfg, registry);
```

Call `reportOutsideInclude(cfg)` once when your build starts: it names every file outside `include` that writes a `` t`…` ``, which no build translates. It reads the project itself, so a cached transform never hides one. `writeDts(cfg, catalog)` writes the types where the config resolves them and returns the file and whether it changed.

A dev server that writes the catalogs goes through `syncProject`, the same path `extract`, the MCP server and Studio take: it scans (or takes the registry you hold), syncs, writes the catalogs and the types, and keeps `.verbaly-state.json` in step, in that order. Pass `confirm: true` when your registry is built file by file, so a file that changed on disk unseen is read again before its text is written back. `createDevReporter` then says each of its findings once, says it again if it goes away and comes back, and keeps a long list to a few lines.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
