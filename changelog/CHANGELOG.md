# Changelog

Version history of **Verbaly** — one file, full detail per version, newest first. The twelve packages share one version number (aligned releases).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly). Each entry ends with a **Docs impact** note — the contract `verbaly-web` syncs against. Since 0.15.0, entries open with a short **Highlights** section — the `Release` workflow publishes it (plus the theme line) as the GitHub Release notes; the full detail lives here.

> Length control: when 1.0 ships, the 0.x entries move to `changelog/archive-0.x.md`.

---

## [0.33.0] · 2026-07-29

**The public API becomes a decision instead of an accident.** `@verbaly/compiler` exported **132 names** against the core's 41, and not one of them was documented anywhere: they had accumulated as whatever the first-party plugins happened to need, and at 1.0 every single one would have become a semver promise nobody had ever reviewed. This version reads the whole list against a written rule, publishes the 60 that survive it, documents them, and pins them with a test so the list can never grow by accident again. The same pin now guards the runtime's 41. **Breaking (pre-1.0, tooling API only): 72 exports are gone from `@verbaly/compiler` and `transformSource` returns a different shape.** Nothing in the runtime moved, no rendered output changed, and a project using the CLI or any first-party plugin needs no edits.

### Highlights

- **If you use the CLI or one of the framework packages, this release changes nothing for you.** No config, no imports, no output. The whole version happens inside a package that only integrations reach into.
- **`@verbaly/compiler` finally documents what you are allowed to import,** in two layers: the types your own config file and your own translation provider need, and the toolkit for building an integration we do not ship. Everything else is now internal and says so.
- **The surface went from 132 names to 60,** each one kept because a real integration imports it, because it is a documented extension point, or because a kept signature needs it. The 72 that survived none of those tests are gone.
- **A bundler plugin no longer receives Verbaly's syntax tree.** It used to get the whole parsed analysis just to pick two fields off it; now it gets the messages it found, as a plain catalog. That is one less thing that can break when the parser changes.
- **Both packages now fail their own test if the surface grows,** so adding a public name is a deliberate act a reviewer sees in the diff, instead of something that happens on the way to fixing something else.

### Added

- **`test/surface.test.ts` in `@verbaly/compiler` and a matching pin in `verbaly`**: the exported value list is asserted against the real module (so `index.ts` cannot claim an export it does not deliver), the type list against the source (types are erased at runtime), and a third assertion checks the two agree. Both were verified to fail on an added export before being called done. The compiler's file also asserts the extraction internals stay out.
- **A "Programmatic API" section in the `@verbaly/compiler` README**: the two layers, a table of every export by area, the note that anything not listed is internal, and a minimal plugin example. The listed names were cross-checked against the surface test mechanically (no invented API, nothing missing) and both code samples were typechecked verbatim against the packed tarball.
- **`TranslateProvider` is now shown in the custom-provider example** (`@verbaly/compiler` README): the "plug your own provider" snippet had no type, so a TypeScript user had to guess the request shape. The example also names `origins`, which was already passed to providers and never documented.

### Changed

- **`transformSource` returns `{ messages, result }` instead of `{ analysis, result }`** (`@verbaly/compiler`, breaking): `messages` is a `Catalog` (key to source text) built from the file's extracted messages, first occurrence winning, which mirrors `MessageRegistry`'s collision rule. `@verbaly/vite` was the only consumer of the old field, in one place, and it used exactly two properties of each entry to feed live extraction. Handing it a catalog instead of the parse tree removed `Analysis`, `AnalyzeOptions`, `TaggedMessage`, `TaggedParam`, `TransComponent`, `UsedKey` and `StrayImport` from the public surface in one move: the audit's finding was not that those names were exported, it was that a plugin had to know them at all.
- **72 exports removed from `@verbaly/compiler`** (breaking), 39 values and 33 types. The rule each survivor passed: a first-party package or the docs site imports it, or it is a documented extension point (the config types, the custom provider), or a kept signature reaches it. What went: the extraction internals above, the command entry points (`init`, `doctor`, `wrapProject`, `wrapCode`, `watchProject`, `exportCatalogs`, `importCatalogs`, `pseudoCatalogs`, `renderHtml`), the validation internals (`validateMessage`, `validatePair`, `structureMatches`, `gatePasses`, `checkNextSteps`, `githubCheckAnnotations`), the config and catalog helpers the CLI reaches directly (`findConfigFile`, `loadConfigFile`, `targetLocales`, `readCatalog`, `catalogPath`, `serializeCatalog`), host detection (`detectHost`, `readDependencies`, `WIRING_PACKAGES`), and their result and option types. **If you were calling one of these, the CLI command covers the same ground**; if you need one back as API, that is a one-line minor, which is the cheap direction to be wrong in.
- **The public surface is documented as a promise, not as a side effect** (`@verbaly/compiler`): the root `index.ts` states the rule in one line and groups the exports by layer, so the file reads as the decision it now is.

### Notes

- **The measurement was wrong the first time, and that is the reason this needed doing carefully.** A static scan of `import { … } from '@verbaly/compiler'` across the workspace said 35 of the 132 were used. It missed `@verbaly/next` entirely, because next reaches the ESM-only compiler through `typeof import('@verbaly/compiler')` and property access (its root entry is dual, so `next.config.ts` can be CJS). Five more names were live: `generateRuntimeModule`, `generateLocaleModule`, `transformCode`, `SOURCE_FILE_RE` and `resolveConfig`. Trusting the first number would have published a broken `@verbaly/next`; the typecheck caught it, and the real figure is 41 consumed by first-party code.
- **What "internal" does and does not mean here.** The 72 names cannot be imported: TypeScript answers "has no exported member". Two of them, `Analysis` and `TaggedMessage`, are still *declared* in the emitted `.d.ts`, because `MessageRegistry` is public and its method signatures mention them, so TypeScript answers "declares it locally" instead. That is how any public class works and it is not a hidden export: the names are unreachable, and the plugins use the registry as an opaque handle (construct it, pass it, `remove` a file). Recorded rather than papered over.
- **QA against the packed tarballs, not the workspace.** A clean project with `strict` and `nodenext` installed the real `verbaly` and `@verbaly/compiler` tarballs and typechecked two files: a config with a custom `TranslateProvider` (layer 1) and a complete bundler plugin using 20 exports (layer 2). Both compile. A third file importing six removed names produces exactly nine errors and no silent `any`. The full CLI cycle was re-run end to end in a fresh project: `init` → `extract` (with the escaped-block warning) → `status` → `check` → round-trip through XLIFF, CSV and PO → mobile export → `pseudo`, with the gate exiting 1 while translations were missing and 0 once complete.
- **The same release-blocking flake as 0.32.0, in the other shape** (`@verbaly/next`): all four of its suites reach the real ESM compiler through a dynamic `import()`, which pulls in Babel, and under `pnpm test` (twelve packages in parallel) that cold load beat vitest's 5 second default. `pnpm coverage` was green on all 901 while `pnpm test` failed two, the same split step 2b of the release ritual exists to catch. Where 0.32.0 annotated three individual tests, here every test in the file pays the cost, so the timeout goes on the `describe`. Caught in the ritual, twice in a row, which is the argument for keeping that step.
- **901 tests** (compiler **459** · core **237** · next 41 · nuxt 28 · react 27 · svelte 25 · vite 25 · vue 16 · sveltekit 13 · unplugin 12 · astro 10 · mcp 8), was 891: +8 compiler (the four surface assertions and four for `transformSource`'s new contract, including the repeated-explicit-key case), +2 core (its value list and the fact that `t` is never exported).
- Runtime sizes unchanged: 3.49 KB tree-shaken · 5.75 KB full · 1.60 KB devtools (min+gzip, budgets 3.75/6.20/1.75). Bench re-run (ritual): lookup **33.6×**, interpolation **11.6×**, plural **4.6×**, currency **5.7×** vs i18next 26, in family with 0.32.0 (31.4×/10.9×/5.1×/5.1×). `publint` "All good" on all twelve; `attw` shows only the documented node10 exceptions, with `@verbaly/next`'s dual root green on all four resolutions.
- No new dependencies. No change to the message format, the key scheme, the catalog format or any rendered output.
- **1.0 status:** this was the last known breaking change in the queue, so criterion 2 is closed again, this time with the surface reviewed rather than assumed. What remains is criterion 3, one feedback cycle with real external users.
- Competitive seal 0.33.0 (2026-07-29, re-check pending at release time): nothing moved in the landscape. This version buys no new differentiator; it buys the right to promise the ones we have. A compiler whose public API is 132 undocumented names cannot credibly offer a stable 1.0, and none of i18next, Lingui, typesafe-i18n or Paraglide publishes a reviewed and test-pinned surface for its build-time package.

### Docs impact (synced)

> Small on the site and large in the package README, which is the right split: the site serves people translating an app, the README serves the few people building an integration. The README part shipped with this version.

- **`docs/reference/cli`, the custom-provider snippet**: it can now show `TranslateProvider` typing the function, and mention that the provider also receives `origins` (key to the source files it appears in), which was always passed and never documented. That is the only user-visible piece of this release.
- **Nothing else on the site changes.** No page documents a compiler export today, and this version deliberately does not add one: the audience for the programmatic API is someone writing a bundler integration, and they are reading the package on npm, not the landing. If a "Compiler API" page is ever wanted, the README's table is the source to copy from, and it is now guaranteed accurate by the surface test.
- **Worth a look on the next sync, not an action item:** the site's own build uses `@verbaly/astro`, which consumes the trimmed surface, so a green `pnpm build` after the version bump is itself the consumer test for this release.

---

## [0.32.0] · 2026-07-29

**Nothing breaks in silence.** 0.30.0 gave the build gate teeth and 0.31.0 made the commands agree with each other, and this version closes the same story from the other end: every remaining path where Verbaly did the safe thing without telling you now says so, at the moment you can act on it. A plural block that renders an empty string, a currency placeholder with no currency, a message that was written with a plural block in a place that cannot have one, and `t` imported from a package that does not export it: four ways to ship the wrong text with every command green. Plus the one thing everybody saw and nobody could miss: every single CLI error printed its prefix twice. No breaking changes, no new configuration, no new runtime API.

### Highlights

- **A plural block with no catch-all case now warns in the browser, not just in the build.** 0.30.0 made the gate refuse it, but a catalog that arrives from a lazy loader, from `addMessages` or from a CMS never passes through the gate, so the empty string could still reach a real page. Now it names the message and tells you to add an `other` case.
- **A placeholder missing its argument stops rendering as a bare number.** `{price:currency}` with no currency code, `{n:unit}` with no unit, `{n:relative}` with no time unit: each one printed the plain value and said nothing. Each one now says what it needs and shows the shape of the fix.
- **Writing a plural block inside a `t` template no longer ships as literal braces.** In a `t` template the values come from `${…}`, so a plural or format block written there becomes text your users see with the braces still in it. `verbaly extract` and `verbaly doctor` now point at the file and the exact text.
- **`import { t } from 'verbaly'` finally gets an answer that mentions Verbaly.** `t` comes from your instance or from the generated module, never from the package, and until now only the bundler complained, in a message that gave no hint about where `t` should come from. `verbaly doctor` names the file and the fix.
- **Every CLI error prints its prefix once.** Every failure of the binary read `[verbaly] [verbaly] …`.

### Added

- **Warnings for every remaining silent degradation in the runtime** (`verbaly` core, `format.ts`): a variant block where nothing matched and there is no `other` (it renders an empty string), a format missing a required argument (`currency`, `unit`, `relative`), a `list` given a value that is not an array, and a `relative` given something that is neither a number nor a `Date`. Each one names the message, like the missing-param warning has since 0.31.0, and each one keeps the same output it produced before: this version adds the report, never changes the rendering. The audit that produced the list started from the invariant 0.30.0 wrote down (degrading is fine, degrading quietly is not) and read every `return` in the file against it.
- **`escapedSyntax(message)`** (`@verbaly/compiler`, `validate.ts`, not exported from the package index on purpose): returns the slice of an extracted message where a plural or format block survived as literal text. `verbaly extract` prints a warning per message with the file and the slice, and `verbaly doctor` reports it as a `messages` warning. It is deliberately **not** a `StructureIssue`, so it can never fail a build: a catalog that carries escaped syntax is usually a docs site showing the format on purpose (verbaly-web's own English catalog has four such messages), and the gate would have failed correct projects.
- **`Analysis.strayImports` and `MessageRegistry.strayImports()`** (`@verbaly/compiler`): `analyze` records a named `t` imported from `verbaly` or any `@verbaly/*` package, and `verbaly doctor` reports it as an `imports` error naming the files and where `t` really comes from. Detection is by the imported name, so `useT as t` is correctly left alone: what has to exist is the package export, not the local binding. `StrayImport` is exported as a type, like every other field of `Analysis`.
- **`formatCliError(error)`** (`@verbaly/compiler`, exported from `run.ts`): prefixes `[verbaly]` only when the message does not already open with it. It lives in `run.ts` and not in the bin wrapper because `cli.ts` has no tests, and it is the single place a new entry point should reuse.

### Changed

- **`applyFormat` takes the parameter node instead of three of its fields** (`verbaly` core): it needed the parameter's name to write a warning that names it, and passing the node dropped the signature from four arguments to three. A shared `degrade(problem)` closure writes every one of the new warnings, and a `where(ctx)` helper is now the single place that appends ` in "key"` (the missing-param warning was inlining it).
- **`formatRelative` validates its input at the call site** (`verbaly` core): `applyFormat` checks the value type and the argument before delegating, so the function now takes `number | Date` and its `catch` is reached only by a real `Intl` failure. That let its warning stop blaming the time unit for what is often an invalid `Date` (`{d:relative} in "posted" cannot format "Invalid Date" as "day"`).
- **The size budgets move to 3.75 and 6.20 KB** (`verbaly` core, `scripts/size.mjs`): the tree-shaken runtime grew from 3.34 to 3.49 KB, all of it warning strings, which left the old 3.55 budget with 60 bytes of headroom where the file's own rule is about 8%. Raising the budget is the honest bookkeeping: the number that matters is in the Notes, measured every release.
- **`verbaly init --help` and `verbaly doctor` stopped saying "bundler"** (`@verbaly/compiler`): 0.31.0 replaced bundler detection with host detection and swept the docs site, but the CLI's own help line still read "detects your bundler" and doctor still reported "no bundler detected". Both now say framework, which is what the `HOSTS` table actually looks for.

### Fixed

- **Every CLI error printed `[verbaly]` twice** (`@verbaly/compiler`): each error thrown by the compiler opens with the prefix (an unparseable catalog, an unsupported exchange format, a config file that needs esbuild) and the bin wrapper added another one unconditionally. Universal, cosmetic, and exactly the kind of thing pillar 3 is about.
- **`verbaly doctor` now exits 1 on a project that cannot build for a reason the gate cannot see** (`@verbaly/compiler`): the stray `t` import joins the missing catalog directory and the unparseable JSON in that group. The 0.31.0 rule still holds where it matters: doctor never errors on something that builds and renders, so a warning can never fail somebody's CI.

### Notes

- **The runtime warnings deliberately leave the offending value out of the text.** `warnOnce` dedupes on the whole string and its set is unbounded, so `no case matched for {count} = 5` would let a counter walking 0 to N add N entries to memory. The remedy does not depend on the value, so the message names the parameter and the key and stops there. A test pins it: two different counts through the same broken block warn once.
- **Verified against the real docs site before shipping:** the new compiler run against verbaly-web's 867 messages in three locales reports zero problems and `verbaly doctor` stays healthy, which is the false-positive check that mattered most for `escapedSyntax` (that catalog contains escaped format syntax on purpose) and for the `imports` check (with `include: []` neither check runs, because no code is read).
- Runtime sizes: **3.49 KB tree-shaken** (was 3.34) · 5.75 KB full · 1.60 KB devtools (min+gzip, size gate green with the new budgets 3.75/6.20/1.75). The 150 bytes are the warning strings. Bench re-run (ritual): lookup **31.4×**, interpolation **10.9×**, plural **5.1×**, currency **5.1×** vs i18next 26, in family with 0.31.0 (28.5×/11.4×/5.8×/5.7×).
- **891 tests** (compiler **451** · core **235** · next 41 · nuxt 28 · react 27 · svelte 25 · vite 25 · vue 16 · sveltekit 13 · unplugin 12 · astro 10 · mcp 8), was 873: +16 compiler (stray imports including the `useT as t` case, `escapedSyntax` with its four non-cases, doctor's `imports` and `messages` entries plus a clean project staying quiet, the extract warning, and `formatCliError` both ways), +2 core (a second message with the same missing `other` still warns, and a `relative` value of the wrong type).
- No new dependencies, in any layer. No change to the message format, the key scheme, the catalog format or any rendered output: every change in this version either adds a report or renames a word in help text.
- **A release-blocking test flake was caught in the release prep, not in the Release workflow** (`@verbaly/compiler`): the three `config.test.ts` cases that load a `verbaly.config.ts` go through `bundle-require`, which spawns esbuild, and under `pnpm test` (all twelve packages in parallel) that cold start beat vitest's 5 second default. `pnpm coverage` passed all 891 tests while `pnpm test` failed one, which is exactly the split step 2b of the release skill exists to catch. The three now carry an explicit 30 second timeout, because a test that starts an external process should never be measured against the budget for a pure unit test.
- **Backlog note:** the three problems the 0.31.0 QA pass found against the published tarballs are all closed here. What stays open and blocks 1.0 is the public surface of `@verbaly/compiler`: 132 exported symbols against the core's 41, and measured this version, **only 35 of them are imported by any first-party package**. That audit is breaking and needs a version of its own.
- Competitive seal 0.32.0 (2026-07-29, re-check pending at release time): nothing moved in the landscape. What this version strengthens is not a new differentiator but the credibility of the existing one: a toolchain that validates translation structure has to be a toolchain that never stays quiet about a broken render, in the build **and** at runtime. i18next has no build step, Lingui checks its own extraction, Paraglide validates the inlang format, and none of the three reports a plural block that renders empty.

### Docs impact (synced)

> Nothing conceptual moves and no page gains a section. Four pages gain one sentence each, because the tooling now says something it did not say before.

- **`docs/reference/api`**: the paragraph about `t()` and bad data should say that **every** degradation warns and names the message, not just the missing parameter. If the page lists the format arguments, `currency`, `unit` and `relative` can now say plainly that the argument is required and that leaving it out warns.
- **`docs/guide/format`**: the plural section already says a plural block needs `other`. It can now add that leaving it out warns in the browser too, not only in the build. This is also the right page for the one real gotcha of the version: in a `t` template the values come from `${…}`, so a plural or format block written inside one renders with its braces visible, and `verbaly extract` says so.
- **`docs/reference/cli`**: the `doctor` check list gains its two new rows (`imports`: `t` imported from a verbaly package, and `messages`: an extracted message that kept a block as literal text) and the `extract` row gains its warning. If the page states that doctor exits 1 exactly when `check` does, it needs the more precise version: doctor also fails on a setup fault the gate cannot see, and never on something that builds.
- **`docs/init/start` and any framework page that shows the first import**: worth a check that no snippet reads `import { t } from 'verbaly'`, because doctor now calls that an error. The docs were audited clean in the 0.31.0 sync, so this is verification, not a rewrite.
- **Nothing to change in the playground**: no rendered output moved. The gate terminal panes keep their text.

---

## [0.31.0] · 2026-07-28

**The tooling stops contradicting itself.** `verbaly doctor` called a project healthy while `verbaly check` blocked its build over the same catalogs, rejected the nested catalogs the runtime has always supported, and told an Astro or Nuxt app to install the package `verbaly init` had just told it not to. The gate read any `<word>` in prose as markup and failed correct translations over it, and every failure closed with the same "run extract" no matter what had actually failed. All of that is now one story: what a command reports is what the project is. **Breaking (pre-1.0, tooling API only):** `detectBundler` and `InitResult.bundler` are gone, and `failOnMissing: false` no longer switches off the whole gate. No runtime API change.

### Highlights

- **`verbaly doctor` stops disagreeing with `verbaly check`.** A translation that is present but broken is now an error in doctor too. The command you run when something looks wrong can no longer answer "setup looks healthy" about a project whose build fails.
- **Catalogs written as nested groups work everywhere.** doctor used to reject them as invalid, and the gate only compared the group names: a group with one untranslated line inside counted as fully translated. Now every line is checked on its own, like the runtime already read it.
- **doctor points at the package your project actually needs.** Astro, Nuxt, Next.js, SvelteKit, Vite or the bundler plugin, the same answer `verbaly init` gives, because both now read one table.
- **The build stops failing over text that only looks like markup.** "Press \<Enter\> to continue" translated as "Pulsa \<Intro\> para continuar" was reported as two broken tags. A tag counts as structure only when the message closes it, so prose stays prose and a real `<em>` or a named link is still protected.
- **Each failure names the step that repairs it,** instead of one "run extract" that only ever fixed missing translations. And `failOnMissing: false` now means what it says: it lets you build with untranslated strings, and still refuses to ship a translation that renders wrong.
- **A missing param says which message it came from.** The warning used to print the param name alone, once per name, so the second message with the same gap stayed silent.

### Added

- **`checkNextSteps(result)` and `gatePasses(result)`** (`@verbaly/compiler`, both exported): the remedy per failure category (missing, unknown, broken), and the single definition of what makes the gate fail. `check()` computes its own `ok` through `gatePasses`, the build gate and the CLI print `checkNextSteps`, so the pass rule and the advice each live in one place.
- **`detectHost(root)`, `WIRING_PACKAGES` and `readDependencies(root)`** (`@verbaly/compiler`): one table (`HOSTS` in `init.ts`) maps a dependency to the verbaly package that wires it and to the line that wires it, ordered so a meta-framework wins over the bundler underneath it (a Nuxt app also has vite). `init` and `doctor` both read it. Covers nuxt, next, sveltekit, astro, vite, webpack, rspack, rollup and esbuild; `WIRING_PACKAGES` is derived from the same table, so a project already wired with any of them passes the check.
- **`verbaly doctor` reports structure**: an error entry for broken translations (locales named, `verbaly check` as the fix) and a warn entry for the structural warnings, in the same `translations` area as the missing report. `doctor` exits 1 exactly when the gate would.
- **`verbaly doctor` explains a silent project**: with `include: []` (source scanning off) it prints a `sources` entry saying the catalogs are the source of truth, and skips the orphan and types checks instead of inventing answers from an empty scan. Claiming orphans there would have pushed a `--prune` that deletes a working catalog.

### Changed

- **`check` and `status` flatten every catalog once** (`@verbaly/compiler`): both used the raw catalog for presence (`catalogs[locale][key]`) and a flattened copy only for structure. On a nested catalog that compared top-level group names, so a locale reported 100% while its leaves were empty. Both now build one flat view per locale up front, the shape `t()` actually sees, and every count, every missing entry and every structural check reads it. Generated flat catalogs are unaffected (flattening one is identity). Verified on the docs site: 34 top-level groups became 857 real messages, and blanking a single leaf now fails the gate naming `hero.claim_line1_start`.
- **`validatePair` only compares tags the message closes** (`@verbaly/compiler`): the markup vocabulary of a pair is the set of names that appear closed (`</x>`) or self-closing (`<x/>`) on either side; anything else is prose. A lone `<Enter>` is dropped by rich rendering and printed verbatim by a plain bind, so it was never structure a translator had to preserve, and a plain-text message had no escape hatch either (`&lt;` is only decoded inside `parseTags`). Everything that was caught before is still caught: a dropped `<em>`, a half-closed pair, a lost `<br/>`, a tag the translation invented, and named links.
- **`failOnMissing: false` waives untranslated strings only** (`@verbaly/compiler`, breaking): it used to return before `check()` even ran, so it also switched off unknown keys and broken translations. Someone opting out is asking to build with text that is still in the source language, which falls back cleanly; they are not asking to ship a plural block that renders empty. The gate now drops the missing list and keeps the rest.
- **The build gate prints the remedy that matches the failure** (`@verbaly/compiler`): it always ended with "Run `npx verbaly extract` and fill the missing translations", which repairs nothing when the failure is a broken translation or a key that exists in no catalog. `verbaly check` prints the same block, in both reporters.
- **`doctor` accepts nested catalogs** (`@verbaly/compiler`): it rejected any non-string top-level value, which made the docs site fail its own doctor on all three locales while its build passed. It now walks the tree and errors only on a leaf that is not text, naming the dotted path (`nav.count`). The loaded catalog is flattened, like every other consumer.
- **`t()` names the message in the missing-param warning** (`verbaly` core): `missing param "name" in "greet"`. `warnOnce` keyed on the param name alone, so the first message to forget `{name}` warned and every other one after it was silent, and the warning that did fire gave nowhere to look. The `key` rides on the format context; the tagged template has no key and keeps the short form.
- **`InitResult.bundler` is now `InitResult.host`** (`@verbaly/compiler`, breaking) and `detectBundler` is replaced by `detectHost`, which returns the whole setup (`name`, `pkg`, `wire`) instead of a bare bundler name. The CLI prints `detected: nuxt` where it printed `detected bundler:`, and `verbaly init` now has real next steps for Nuxt, Next.js and SvelteKit instead of routing them to the generic plugin.

### Fixed

- **`validate.ts` was a binary file to git** (`@verbaly/compiler`): it carried a literal NUL as the plural cache-key separator, so git has shown `Bin 6997 bytes` instead of a diff since the file was added in 0.30.0. Replaced with the `\u0000` escape (identical semantics), which is what the same lesson from 0.14.5 prescribes, with a comment on the line so it does not come back. The repo was swept: no other source file carries a raw control byte.

### Notes

- **Backlog closed with a measurement, not a guess: no resolution cache in the hot path.** The open question was whether `lookup()` walking the fallback chain on every `t()` deserved a cache. Measured on the built runtime: a hit at chain depth 1 is ~35 ns, a hit at the bottom of a four-entry chain (three misses) is ~74 ns, so the walk itself costs about 40 ns in the deepest realistic shape and nothing at all in the common one. A message with one param is ~80 ns and a message with a plural is ~1.7 µs, dominated by `Intl` (`PluralRules.select` and `NumberFormat.format` are ~600 to 900 ns each on their own). A perfect resolution cache would therefore buy about 2% of a formatted message and nothing measurable elsewhere, while adding invalidation on every `addMessages`/`setLocale`. Removed from the backlog; reopen only if a consumer arrives with a deep chain and a param-free workload.
- **Behavior changes to expect on upgrade:** a project with nested catalogs will see `check` and `status` report every message instead of every group, so a locale that read as complete can now report missing entries (they were always missing, nothing regressed at runtime). A project using `failOnMissing: false` can now fail on a broken translation or an unknown key. Both are the point of the version, and every failure names the key, the locale and the reason.
- Runtime sizes: **3.34 KB tree-shaken** (was 3.32) · 5.60 KB full · 1.60 KB devtools (min+gzip, size gate green with budgets 3.55/6.00/1.75). The 20 bytes are the message key in the missing-param warning. Bench re-run (ritual): lookup **28.5×**, interpolation **11.4×**, plural **5.8×**, currency **5.7×** vs i18next 26, in family with 0.30.0 (34.0×/10.5×/4.9×/5.1×).
- **873 tests** (compiler **435** · core **233** · next 41 · nuxt 28 · react 27 · svelte 25 · **vite 25** · vue 16 · sveltekit 13 · unplugin 12 · astro 10 · mcp 8), was 855: +15 compiler (nested leaf checks, the next-steps remedies, the markup vocabulary, doctor's broken/warning/sources entries and host detection), +2 vite (the opt-out still blocking a broken translation, and the remedy text), +1 core (a second message missing the same param still warns).
- No new dependencies, in any layer. No change to the message format, the key scheme or the catalog format.
- Competitive seal 0.31.0 (2026-07-28, re-check pending at release time): nothing moved in the landscape this version. What it strengthens is the same differentiator 0.30.0 opened: a build gate that validates translation structure, now with a diagnosis path (`doctor`) that agrees with it and false positives removed. i18next has no build step, Lingui checks its own extraction, Paraglide validates the inlang format.

### Docs impact (synced)

> The version is about the CLI telling the truth, so the pages that describe commands are the ones that move. No page gains a concept, three of them lose an inaccuracy.

- **`docs/reference/cli`**: the `doctor` row and section need the real list of what it checks now (config, catalogs including nested ones, integration wiring, types, orphans, and translation health with broken and warnings), plus the fact that it exits 1 exactly when `check` would. The `check` section gains a line saying every failure prints the step that repairs it. If the page documents `failOnMissing`, it must now say it waives untranslated strings and never broken ones.
- **`docs/guide/translators`**: the safety-net section can state plainly that prose with angle brackets is left alone, only tags the message closes are structure. That was the one thing a translator could hit that was not their fault.
- **`docs/frameworks/*` and `docs/init/start`**: wherever the install step says which package to add, it now matches what `verbaly init` and `verbaly doctor` print for that framework (Nuxt, Next.js and SvelteKit included).
- **`docs/reference/api`**: the missing-param warning now names the message, one line if the page mentions it.
- **Nothing to change in the playground**: no runtime behavior moved.

---

## [0.30.0] · 2026-07-28

**The build gate stops trusting that a filled-in translation is a working translation.** Until now `verbaly check` asked one question: is there a value for every key? A translation could drop your `{name}`, lose an `<em>`, or flatten a plural block into plain text, and CI stayed green while production quietly showed the wrong text (or nothing at all). The gate now reads the translation against the source and fails on anything that cannot render what the source renders, with the reason in plain words and the source line to click. The runtime stops being silent about the same class of bug, and `@verbaly/react` is now verified against Preact. No new configuration.

### Highlights

- **`verbaly check` catches translations that are present but broken.** A missing `{param}`, a lost rich tag, a plural block turned into plain text, or a plural set with no catch-all case: each one fails the gate with a sentence that says what happened and why it matters, annotated on the exact source line in GitHub. Before this, a hand-edited catalog had no validation at all: only `import` and `translate` were checked.
- **The empty-string bug is gone.** A translation whose plural block lost its `other` case rendered an empty string for every count it did not list. In Polish, `{count | one: … | few: …}` showed nothing at all for 5 items. That now fails the build instead of shipping.
- **Verbaly tells a translator which plural forms their language actually needs.** A Polish or Russian catalog that only carries `one` and `other` gets a warning naming the missing forms. It is a warning, not a failure: the text still renders. Forms no real counter can reach are never requested, so Spanish, French, Portuguese and Italian catalogs stay quiet.
- **`verbaly status` shows a broken count per language,** so you can see the state of a catalog without running the gate.
- **A missing param now warns in the console.** Rendering `{name}` into your UI because nobody passed `name` was the one bad-data path Verbaly did not report. Every other one already warned.
- **Preact works, and now it is proven.** `@verbaly/react` runs its own suite a second time with React resolved to `preact/compat`: hooks, locale switching, `<Trans>` and server rendering all pass. No separate package, no adapter changes.
- **VS Code can show your translations on hover.** The README carries the i18n-ally configuration that turns hash keys into readable text in the editor.

### Added

- **Structural validation of catalogs** (`@verbaly/compiler`, new `validate.ts`): `validateMessage(message, locale?)` checks one message on its own and `validatePair(source, translated)` checks a translation against the message it mirrors. Both return typed `StructureIssue[]` with an `error` or `warning` severity. What is an **error** (the gate fails, because the output is wrong or empty): a param name present in one side and not the other, a rich-tag mismatch counting duplicates, a plural or select block flattened into plain text, a plural block with no `other` case, and a select block that lost the `other` the source had. What is a **warning** (reported, exit stays 0, because the text still renders): a plural set missing forms the target language needs, and an exact `=N` case the source had that now falls back to `other`. Both are exported.
- **`CheckResult.broken`** (`@verbaly/compiler`): a `BrokenEntry[]` (`locale`, `key`, `severity`, `issue`) alongside `missing` and `unknown`. `result.ok` is false only when an entry is an error, so warnings never fail CI. `formatCheckResult` prints a "broken translations" block; the new **`formatCheckWarnings`** prints the warnings on their own; `githubCheckAnnotations` emits `::error` or `::warning` per severity, pointing at the source file and line that wrote the message (the same origin lookup the missing-key annotations use). The CLI prints warnings whether the gate passes or not, and the failure summary now counts broken alongside missing and unknown.
- **`LocaleStatus.broken`** (`@verbaly/compiler`): `verbaly status` counts translations that are present but structurally broken per locale, shown inline (`es: 12/12 translated (100%, 2 broken)`, and the check mark only appears at full coverage with zero broken). `status --json` carries the field.
- **Preact verification** (`@verbaly/react`, new `test/preact.test.tsx` + `vitest.preact.config.ts`): a second vitest run resolves `react`, `react-dom`, `react-dom/client`, `react-dom/server` and `react/jsx-runtime` to `preact/compat` and exercises the real adapter source: provider rendering, locale change through `useSyncExternalStore`, a catalog arriving late, `useLocale` from an event handler, `<Trans>` with components, whitelisted tags, void tags, named links, unknown-tag degradation, and server rendering. The first test asserts the alias actually took effect (compat's `Fragment` is preact's), so the file cannot silently pass as a plain React run. React's own config excludes that file (two renderers in one process render nothing), and the root config registers the preact config as a **named project** (`react/preact`) so `pnpm coverage`, the suite CI runs, covers it as well; without the name vitest refuses to start, because both configs read the same `package.json`. The environment (`happy-dom`) is set in that config rather than a per-file docblock: a docblock is one comment away from dropping the whole suite into node. New devDeps `preact ^10.29.7` + `preact-render-to-string ^6.7.0` (test-only). Backlog item closed with evidence, not a guess.
- **i18n-ally configuration in the README** ("Editor: translations on hover"): `.vscode/settings.json` (`localesPaths`, `keystyle: flat`, source language) plus the `.vscode/i18n-ally-custom-framework.yml` usage regex for `t('key')` across js/ts/jsx/tsx/vue/svelte/astro. `keystyle: flat` is the part that matters: Verbaly catalogs are flat maps and the extension's default guess is nested. Documented as read-only tooling: its extract and rename actions assume the developer owns the keys, and in Verbaly the compiler does. Backlog item closed.

### Changed

- **`structureMatches` is stricter** (`@verbaly/compiler`, the gate `translate` and `import` already shared): it is now `validateMessage` + `validatePair` over the error severities, so besides params and tags it rejects a flattened plural block and one that would render empty. A translator's file and a model's output are held to the same standard as before, plus these two. It takes no locale on purpose: the locale-specific plural advice is `check`'s warning and must never be a reason to drop an imported file.
- **`t()` warns once on a missing param** (`verbaly` core): `formatParam` reached the `{name}` fallback silently, the only bad-data path without a `warnOnce`. It now says `missing param "name"` once per param name. The placeholder output is unchanged, so nothing about rendering moves.
- **The `verbaly_missing` MCP tool reports broken translations and warnings**, and its title and description say so. It shares `check`, so it gained the coverage with no new orchestration; agents that only saw "missing" now see "present but wrong" too.
- **`PLURAL_CATEGORIES` lives once** (`@verbaly/compiler`): the CLDR category name set moved from a private constant in `params.ts` to an export of `validate.ts`, which both modules read. Same five names, one definition.

### Notes

- **Behavior change to expect on upgrade:** a project whose catalogs already carry a broken translation will see `verbaly check` fail where it used to pass. That is the point of the version, and every failure names the key, the locale and the reason. Pre-1.0, called out explicitly.
- **Validation flattens the catalog first, found by dogfooding.** The docs site writes its catalogs **nested** (descriptive namespaced keys, not generated hashes) and the runtime flattens them, so both shapes are real. The first version of the gate walked catalog values as if every one were a string and crashed on the nested shape: `message.matchAll is not a function`, taking the whole `check` down. Validation now flattens both sides and checks leaf by leaf, so a nested catalog gets the same per-message coverage a generated flat one gets. Verified against the real site: 824 messages × 3 locales, zero broken, zero warnings.
- **The plural-form warning probes instead of trusting `Intl`.** `Intl.PluralRules(locale).resolvedOptions().pluralCategories` declares `many` for `es`, `fr`, `pt` and `it`, but no integer count selects it (it exists for compact forms like "1 millón"), so asking translators for it would have warned on every Spanish plural in every project. The reachable set is computed by selecting over counts 0 to 200 and cached per locale, which also trims `cs` (its `many` is decimals-only) while keeping the full Arabic set (`zero`, `one`, `two`, `few`, `many`). Found by the test suite on the first run.
- Runtime sizes: **3.32 KB tree-shaken** (was 3.31) · 5.57 KB full · 1.60 KB devtools (min+gzip, size gate green with budgets 3.55/6.00/1.75). The 10 bytes are the missing-param warning. Bench re-run (ritual): lookup **34.0×**, interpolation **10.5×**, plural **4.9×**, currency **5.1×** vs i18next 26, in family with 0.29.0 (29.8×/10.8×/4.7×/5.2×).
- **855 tests** (compiler **420** · core 232 · next 41 · nuxt 28 · **react 27** · svelte 25 · vite 23 · vue 16 · sveltekit 13 · unplugin 12 · astro 10 · mcp 8), was 799: +47 compiler (validate suite, broken entries in check and status, nested catalogs, CLI gate and reporter), +9 react (the preact run). Core stayed at 232 with the missing-param assertion folded into the existing placeholder test.
- No new runtime dependencies. The two Preact packages are devDeps of `@verbaly/react` and never reach a consumer's bundle.
- **Dependency pass before the release** (rule 4, all patch or minor, suite green after): `magic-string` 1.0.0 → 1.1.0 is the only real dependency that moved (`@verbaly/compiler`). Dev side: astro 7.1.1 → 7.1.4 · next 16.2.10 → 16.2.12 · react/react-dom 19.2.7 → 19.2.8 · svelte 5.56.6 → 5.56.8 · `@nuxt/schema` 4.5.0 → 4.5.1 · `@anthropic-ai/sdk` 0.112.3 → 0.115.0 · happy-dom, prettier, eslint, typescript-eslint, tsdown, `@types/node` patches. `pnpm outdated -r` is empty. The TypeScript side-by-side alias is untouched (TS still 7.0.2, see the debt note in the PLAN). The framework e2e runs are manual and were done at the versions recorded in earlier entries; what re-ran green here is the unit suite plus the type assertions, which compile against the newly installed framework types.
- **Packaging verified at 0.30.0**: publint "All good" on all 12 · attw green on the dual packages (core's node10 view still fails only for the `verbaly/devtools` subpath, the documented known-OK) · react and compiler tarballs inspected (only `dist` + LICENSE + README ship, `workspace:^` rewritten to `^0.30.0`, no runtime dependency added).
- Competitive seal 0.30.0 (2026-07-28, re-check pending at release time): the differentiator this version adds is a build gate that validates translation **structure**, not only presence. i18next has no build step; Lingui checks its own extraction; Paraglide validates its inlang format, not the shape of a translated message against its source.

### Docs impact (synced)

> Executed in `verbaly-web` on 2026-07-28, post-publish, against the real 0.30.0. Two findings worth keeping: the compare table gained a "Broken translations" row, and the new runtime warning caught a genuine old bug on the docs site (a message wrote `instance={verbaly}` with raw braces inside a rich node, so the parser read it as a placeholder and it only looked right because the missing-param fallback prints the same text; it now uses the numeric entities the project's own rule asks for). Also swept in the same pass: three doc links in the package READMEs were 404s (`/docs/cli`, `/docs/sveltekit`, `/docs/migrate`) and six more landed on the wrong page.

- **`docs/reference/cli`**: the `check` row and section need the new behavior: the gate fails on translations that exist but cannot render the source (dropped param, lost tag, flattened plural, plural without a catch-all), and prints warnings that do not fail (plural forms the language needs, a dropped `=N` case). Mention that `--reporter github` marks warnings as warnings. The `status` row gains the broken count.
- **`docs/guide/translators`**: this is the page that matters most. A short section: what the gate accepts and rejects in a translation, why a plural set needs its `other` case, and the plural-forms warning for languages like Polish, Russian and Arabic. Frame it as a safety net for the person translating, not as a rule list.
- **`docs/guide/format`**: where plural blocks are explained, state plainly that a block needs an `other` case, since anything it does not list renders empty.
- **`docs/reference/api`**: nothing new in the runtime surface, but if the page describes what happens when a param is missing, add that it warns once in the console.
- **`docs/frameworks/react`**: one line that Preact works through `preact/compat` with no extra package, verified in the test suite. This is a new supported-surface claim, so keep it factual.
- **Landing compare table**: candidate new row "Validates translation structure" (Verbaly yes, the rest no). Re-verify each competitor's cell before writing it.
- **`/changelog`** (`releases.ts` + new `changelog_rel.v0_30_0` keys ×3): 0.30.0 entry, theme + Highlights above in plain language.
- **Playground**: no change needed. Its catalogs are hand-written and the gate now validates them, so if `pnpm build` reports anything broken in `src/i18n/locale/*`, fix the catalog rather than the config.
- Also pending in the web from the 2026-07-27/28 UI iteration (already registered in its PLAN): nothing to sync, it is shipped.
- Bump web to `verbaly@^0.30.0` + `@verbaly/compiler@^0.30.0` + `@verbaly/astro@^0.30.0`, **`pnpm install` only after the npm publish**.

---

## [0.29.0] · 2026-07-27

**Your coding agent can now run the whole translation cycle.** A new MCP server (`@verbaly/mcp`) gives Claude Code, Cursor and any MCP client four tools: see the coverage, list what's missing, extract new text and machine-translate the gaps, with every machine translation still landing as a draft a human reviews. A public Agent Skill and an `llms.txt` on the docs site complete the channel. Nuxt projects stop getting a `verbaly.d.ts` in their root (types now live in `.nuxt/`), and displayed code snippets in `.vue`/`.astro`/`.svelte` markup can no longer invent phantom keys. No breaking changes.

### Highlights

- **New: `@verbaly/mcp`, the translation cycle as agent tools.** One command (`claude mcp add verbaly -- npx -y @verbaly/mcp`) and your coding agent can check coverage, list missing translations, extract new text and fill the gaps with machine translation. Anything the agent translates is saved as a draft, so nothing ships without a human saying yes.
- **A public Agent Skill teaches your agent Verbaly.** Install `skills/verbaly` from the repo into your project and the agent knows the write, extract, check, translate cycle and the rules that keep it safe (never hand-write keys, params must survive translation, empty means untranslated).
- **The docs now speak LLM.** The docs site publishes an `llms.txt` index, so agents that read documentation find their way around Verbaly without scraping HTML.
- **Nuxt projects keep their root clean.** The generated types now live inside `.nuxt/` and register themselves automatically, exactly like the Astro integration already did. No more `verbaly.d.ts` at the project root, and no tsconfig edits either.
- **Displayed code can no longer become a translation key.** Docs and tutorial pages that show `` t`…` `` snippets as visible text (in `.vue`, `.astro` or `.svelte` files) used to risk those snippets being extracted as real keys. Now only code inside real expressions counts.

### Added

- **`@verbaly/mcp`** (new package, the twelfth): an MCP server over stdio exposing `verbaly_status` and `verbaly_missing` (read-only, flagged as such) plus `verbaly_extract` and `verbaly_translate` (writing). Orchestration mirrors the CLI over the same compiler primitives; translate keeps the draft contract (`markDrafts`/`saveDrafts`, the result text points to `verbaly review`). Every failure returns as an actionable tool error (`isError` + message), never a crashed server. Bin `verbaly-mcp` (`--root` flag, per-tool `root` argument override); ESM-only; deps `@modelcontextprotocol/sdk` + `zod` + `@verbaly/compiler` (CLI/tooling layer, the shipped runtime stays zero-dep). Tests talk to the real server through the SDK's `InMemoryTransport` + `Client`; the stdio bin smoke-tested by hand (initialize + tools/list).
- **Public Agent Skill** (`skills/verbaly/SKILL.md`, committed): the cycle, the safety rules and the framework wiring table in agent-readable form; installable via `npx degit AronSoto/verbaly/skills/verbaly .claude/skills/verbaly`. The README gains a "Coding agents" section (MCP + skill + llms.txt).
- **`llms.txt` on the docs site** (`verbaly-web`, `src/pages/llms.txt.ts`): generated at build time from the real docs navigation (it cannot drift), with per-page descriptions, the current version and the agent channel. Already live in the web repo, pre-publish.
- **New `@verbaly/compiler` exports**: `collectOrigins(cfg)` (key → root-relative source paths, was private to the CLI) and `resolveProvider(cfg, model?)` (config provider function or the lazy claude provider, ditto). The MCP server consumes them; any tooling can now.

### Changed

- **`@verbaly/nuxt` uses Nuxt's types slot** (decided 2026-07-19, mirror of Astro's `injectTypes`): the module defaults `dts` to `.nuxt/verbaly.d.ts` and hooks `prepare:types` to write the file and push its reference into `.nuxt/nuxt.d.ts`, so consumers get types with zero tsconfig and zero root files; the vite plugin keeps that same file fresh in dev. An explicit `dts` option still wins; `dts: false` turns both off. `@verbaly/compiler` becomes a real dependency of the module (build-time only; the runtime plugin never imports it).
- **SFC markup candidates count only in expression context** (`@verbaly/compiler`, `sfc.ts`): `.astro`/`.svelte` markup candidates must sit inside balanced `{…}` regions; `.vue` inside `{{ … }}` mustaches or quoted `:`/`@`/`v-` directive values. Display-only text never runs at runtime, so extracting it was always a false positive (the 0.26.0 dogfood finding: verbaly-web's displayed snippets invented keys and needed `include: []` to work around it). Extraction from real code is unchanged; script blocks and frontmatter were never affected.

### Notes

- Runtime untouched: core sizes stay **3.31 KB tree-shaken** · 5.57 KB full · 1.60 KB devtools (min+gzip, size gate green). Bench re-run (ritual): lookup **29.8×**, interpolation **10.8×**, plural **4.7×**, currency **5.2×** vs i18next 26, in family with 0.28.0 (28.6×/10.5×/5.4×/5.4×).
- **799 tests** (compiler **373** · core 232 · next 41 · **nuxt 28** · svelte 25 · vite 23 · react 18 · vue 16 · sveltekit 13 · unplugin 12 · astro 10 · **mcp 8**), was 783: +5 compiler (expression-context suite), +3 nuxt (types slot), +8 mcp.
- New deps (all in `@verbaly/mcp`, tooling layer per the layered zero-dep rule): `@modelcontextprotocol/sdk ^1.30.0`, `zod ^4.4.3`; devDep `@types/node ^26.1.1` (the native tsc needed an explicit `"types": ["node"]` in this package's tsconfig, unlike its siblings).
- **First publish of `@verbaly/mcp` is manual** (a brand-new package cannot have a Trusted Publisher until it exists on npm): publish once by hand, configure the Trusted Publisher, re-run the workflow; the per-package resume skips the eleven already published.
- The `run.ts` helpers `collectOrigins`/`resolveProvider` moved to `extract.ts`/`translate.ts` (now public, see Added); the CLI behavior is byte-identical.
- Competitive seal 0.29.0 (2026-07-27, re-check): i18next 26.3.6 · **Lingui 6.6.0** · typesafe-i18n 5.27.1 · **Paraglide 2.23.0** · **next-intl 4.13.4** · **@nuxtjs/i18n 10.5.0** · svelte-i18n 4.0.1 · **vue-i18n 11.4.8** (minor/patch bumps, no landscape shift). Lingui validated the Agent Skill route; none of the sealed tools ships a first-party MCP server for the translation cycle as of this check, so the adoption channel (MCP + skill + llms.txt) is currently a differentiator.

### Docs impact (synced)

- **`docs/reference/cli`**: new "Coding agents" section after the commands table: the `@verbaly/mcp` install one-liner, the four tools (status/missing read-only, extract/translate writing), the draft rule (machine output waits for `verbaly review`), and a pointer to the Agent Skill in the repo.
- **`docs/guide/translators`**: one short paragraph in the machine-translation loop: an agent can run the same cycle via MCP and its output still lands as drafts behind the same review gate.
- **`docs/frameworks/vue`** (`#nuxt` section): if it mentions the generated `verbaly.d.ts` at the project root, rewrite: the types live in `.nuxt/` and register themselves (regla 8: as if it were always so).
- **`docs/frameworks/astro` / `vue` / `svelte`**: where extraction from markup is described, state it plainly: text is extracted from expressions (`{…}`, `{{ … }}`, directive values); displayed snippets in plain text are never extracted.
- **Landing compare table**: optional new row "Agent tooling (MCP server + skill)" if it reads well; otherwise no change.
- **`/changelog`** (`releases.ts` + new `changelog_rel.v0_29_0` keys ×3): 0.29.0 entry, theme + Highlights above in plain language.
- **`llms.txt`**: already implemented in the web this iteration; after the post-publish `pnpm install`, verify it renders `Current version: 0.29.0`.
- Bump web to `verbaly@^0.29.0` + `@verbaly/compiler@^0.29.0` + `@verbaly/astro@^0.29.0`, **`pnpm install` only after the npm publish**.

---

## [0.28.0] · 2026-07-20

**The translator matrix is complete, and the runtime is measurably harder to crash.** `verbaly export`/`import` now speak gettext PO, so any PO editor or TMS works out of the box. XLIFF files now protect your `{params}` and tags as untouchable chips with meaningful names, so a translator can no longer break them by accident. A custom sitemap filename in `render` is finally honored, a rare crash with invalid dates is fixed, and CI now fails automatically if the runtime ever grows past its size budget. No breaking changes.

### Highlights

- **Export and import gettext PO files.** `verbaly export --format po` writes one `.po` file per language, ready for any PO editor (Poedit, Weblate, Crowdin, …). `verbaly import` reads them back with the same safety net as every other format: a translation that breaks a placeholder is rejected, not shipped. Entries a tool marks as `fuzzy` count as untranslated.
- **Translators can no longer break your placeholders in XLIFF.** `{params}` and tags now travel as protected codes with meaningful names (`name`, `em`, `link`), so translation tools show them as untouchable chips instead of editable text. Plural and select blocks stay editable on purpose: their words need translating.
- **Custom sitemap names work now.** `render: { sitemap: 'sitemap.xml' }` used to be ignored and always wrote `sitemap-i18n.xml`. The name you configure is the name you get.
- **A rare crash is gone.** Passing an invalid date to a message could throw instead of degrading gracefully. Found by the new randomized test suite that now hammers the parser with garbage on every run, so this class of bug stays fixed.
- **The runtime cannot silently grow.** CI now measures the core bundle (min+gzip) on every push and fails if it exceeds its size budget. The ~3KB promise is enforced by a machine, not a habit.

### Added

- **gettext PO export/import** (`@verbaly/compiler`, new `po.ts`): `verbaly export --format po` writes one `<locale>.po` per target with `msgctxt` = catalog key (keys are hashes, so `msgid` alone cannot identify them), `msgid` = source text, `msgstr` = translation, `#:` location comments from origins, and a `Language:` header. `import` accepts `.po` files: locale from the `Language:` header → filename → `--locale`; multiline string continuations; escaped `\n`/`\t`/`\"`/`\\`; a leading BOM tolerated; `fuzzy`-flagged entries read as untranslated (msgfmt semantics); `msgid_plural`/`msgstr[n>0]` are ignored (Verbaly plurals live inside one message). Values keep the `{name}` syntax verbatim, the gettext norm. `ExchangeFormat` gains `'po'`.
- **Semantic inline codes in XLIFF** (`@verbaly/compiler`, new `inline.ts`): simple `{params}` export as `<ph id="name" disp="{name}"/>`, paired rich tags as `<pc id="em" dispStart="&lt;em&gt;" dispEnd="&lt;/em&gt;">…</pc>`, self-closing tags (`<br/>`) as `<ph>`. Ids are semantic (the param/tag name, NMTOKEN-sanitized, deduped `name`/`name2`), so TMS editors show meaningful protected chips. Variant params (`{v | one: … | other: …}`) stay raw on purpose: their bodies hold translatable text. `disp` carries the exact source slice, so import reconstructs the message verbatim; when a TMS strips `disp`, the id is the fallback and the structural gate still validates the result. Escapes (`{{`, `}}`, `||`) and nesting round-trip losslessly.
- **Size gate in CI** (`verbaly` core, new `scripts/size.mjs` + `size` script): bundles the three sealed surfaces from `dist` (tree-shaken `createVerbaly`, full core, devtools) with esbuild, measures min+gzip and fails when a budget is exceeded (3.55 / 6.00 / 1.75 KB: the sealed sizes plus ~8% headroom for esbuild variance). Wired into both workflows (`ci.yml` after build, `release.yml` before publish). Raising a budget is a conscious, changelog-documented decision (pillar 2).
- **Property-based parser tests** (`verbaly` core, new `test/property.test.ts`, devDep `fast-check`): the never-crash invariant (pillar 3) as properties over random strings plus a syntax-soup generator (braces, variants, formats, tags, entities): `parse` and `parseTags` accept anything, `t` always returns a string and formats deterministically for any catalog message and any params (numbers, dates, invalid dates, objects, null).

### Fixed

- **Custom sitemap filename honored in `render`** (`@verbaly/compiler`): `render.sitemap: 'name.xml'` (or `--sitemap` with a config string) was collapsed to a boolean by the enable check, so the string branch was dead code and the file was always `sitemap-i18n.xml`. The flag and the name are now computed separately (backlog finding, 2026-07-19).
- **Invalid `Date` no longer crashes `t`** (`verbaly` core): an invalid Date reaching auto-format, a variant `#` or a `:list` item threw `RangeError: Invalid time value` from `Intl.DateTimeFormat` (the one unguarded path). `autoFormat` now degrades like every other bad input: `warnOnce` + the plain value. Found by the new property tests on their first run.

### Notes

- Bench re-run (ritual): lookup **28.6×**, interpolation **10.5×**, plural **5.4×**, currency **5.4×** vs i18next 26, in family with 0.26.0 (53.6×/9.7×/5.0×/5.5×) and 0.24.0 (28.8×/11.1×/5.0×/5.8×).
- Bundle sizes: **3.31 KB tree-shaken** (+0.02 = the invalid-date guard) · **5.57 KB full** (+0.03) · 1.60 KB devtools (min+gzip), now measured by the committed script instead of an ad-hoc harness: the gate reproduces the sealed numbers.
- **783 tests** (compiler **368** · core **232** · next 41 · nuxt 25 · svelte 25 · vite 23 · react 18 · vue 16 · sveltekit 13 · unplugin 12 · astro 10), was 768: +10 compiler (custom-sitemap regression + inline codes and PO suites), +5 core (4 properties + the invalid-Date regression).
- New devDeps (build/test-time only, the shipped runtime stays zero-dep): `fast-check ^4.9.0`, `esbuild ^0.28.1` (core). eslint config gains node globals for `**/scripts/*.mjs`.
- New compiler exports: none beyond the widened `ExchangeFormat`; `inline.ts`/`po.ts` stay internal (the public surface is `exportCatalogs`/`importCatalogs`/`parseExchangeFile`, unchanged).
- Competitive seal 0.28.0 (2026-07-20, re-check): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · **vue-i18n 11.4.7** (was 11.4.6, patch). Territory unchanged; with PO the TMS matrix (XLIFF 2.0/1.2 · CSV · PO · mobile delivery) is broader than any compiler-based tool in the space.

### Docs impact (synced)

- **`docs/reference/cli`**: `export` row gains `po` in the format list (`xliff`, `csv`, `po`, `android-xml`, `ios-strings`); `import` row mentions `.po` files and that `fuzzy` entries count as untranslated; if the `render` row describes the sitemap, no text change needed (the configured name simply works now).
- **`docs/guide/translators`**: add PO to the round-trip story (one `.po` per language, `msgctxt` is the key, locations as `#:` comments, works with any PO editor); mention that XLIFF now protects `{params}` and tags as named chips so translators cannot break them, while plural/select bodies stay editable.
- **Landing compare table**: the TMS/export row can now say XLIFF, CSV and gettext PO.
- **`/changelog`** (`releases.ts` + new `changelog_rel.v0_28_0` keys ×3): 0.28.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.28.0` + `@verbaly/compiler@^0.28.0` + `@verbaly/astro@^0.28.0`, **`pnpm install` only after the npm publish**.

---

## [0.27.0] · 2026-07-19

**Machine translations now arrive as drafts you review, not as finished work you trust blindly.** `verbaly translate` marks everything it writes as an unreviewed draft, a new `verbaly review` command lets you approve them, and `verbaly check --drafts` can block a merge until a human has signed off. The translation model also gets told where each string lives in your code, so it translates with context. No breaking changes.

### Highlights

- **Machine output is a draft until you say otherwise.** `verbaly translate` still fills the gaps, but every string it writes is now flagged as an unreviewed draft. Your catalogs stay exactly as clean as before: the review state lives in a separate `.verbaly-drafts.json` file next to them.
- **Approve translations when you have read them.** `verbaly review` lists everything waiting for a human; `verbaly review --approve` accepts it (all of it, or one locale at a time). Importing a translator's file counts as review too, so the draft flag clears automatically.
- **Block merges on unreviewed machine text.** `verbaly check --drafts` fails CI while any machine translation is still unreviewed. Plain `verbaly check` is unchanged, so nothing breaks until you opt in.
- **Better translations, because the model gets context.** `verbaly translate` now tells the provider which source files each string appears in, so tone and length fit where the text is actually used.
- **See what needs review at a glance.** `verbaly status` (and `--json`) now report the count of unreviewed drafts per locale.

### Added

- **Draft tracking** (`@verbaly/compiler`, new `drafts.ts`): a `.verbaly-drafts.json` sidecar in the catalogs directory records which keys are unreviewed machine translations, per locale. It is deliberately a **separate file**: catalogs stay flat JSON with no extra metadata (the format rule holds). Committed like catalogs (review state is shared across the team). Content-compared writes (an unchanged save never churns the file); a corrupt file throws with the path. New exports: `loadDrafts`, `saveDrafts`, `markDrafts`, `clearDrafts`, `effectiveDrafts`, `DRAFTS_FILE`, and the `Drafts` type.
- **`verbaly review`** (`@verbaly/compiler`): lists machine translations awaiting review (optionally one `--locale`); `--approve` marks them reviewed and clears them from the sidecar. Exit 0 always (it is informational, like `status`).
- **`verbaly check --drafts`** (`@verbaly/compiler`): opt-in gate that also fails (exit 1) when unreviewed drafts remain, naming the keys per locale. Without the flag, `check` behaves exactly as before (a draft has a value, so it is not "missing").
- **Source-location context for translation** (`@verbaly/compiler`): `TranslateRequest` gains an optional `origins` map (key → source files); `translateCatalogs` passes the batch's origins through and the built-in Claude provider adds a "where each string appears" section to the prompt. Only the current batch's origins are sent.
- **Draft count in status** (`@verbaly/compiler`): `LocaleStatus` gains `drafts`; `formatStatusResult` notes `N unreviewed` inline and `status --json` carries the number.

### Changed

- **`verbaly translate` marks its output as drafts** (`@verbaly/compiler`): the CLI writes the translated values (as always) and records each written key in the sidecar; the log line now reads `+N translated (draft)`.
- **`verbaly import` clears the draft flag for imported keys** (`@verbaly/compiler`): a file coming back from a human (or a TMS) is reviewed by definition, so its keys leave the draft set. Dry-run touches nothing.
- **Locale discovery ignores dotfile sidecars** (`@verbaly/compiler`, `config.ts`): `resolveConfig` no longer treats a `.json` file whose name starts with `.` as a locale, so `.verbaly-drafts.json` never becomes a phantom locale (same spirit as the existing pseudo-catalog exclusion). A new sidecar file needs no further change.

### Notes

- Design (with Aron, 2026-07-19): the "draft + review" pipeline is the market's consolidated pattern (translate only what changed, mark it as a draft, gate on review). Verbaly's stable keys already give "translate only what changed" for free (a changed source is a new key), so this release adds the missing half: review state and a gate, without a proprietary catalog format. The sidecar is the deliberate choice over embedding metadata in catalogs (pillar 3: simple surface, the flat-JSON rule stays true).
- Runtime untouched: this is a compiler/CLI-only release. Core bundle sizes unchanged (**3.29 KB tree-shaken** · 5.54 KB full · 1.60 KB devtools, min+gzip) and the bench is unchanged (last run 0.26.0: lookup 53.6× · interpolation 9.7× · plural 5.0× · currency 5.5× vs i18next 26).
- **Quality pass (this iteration):** test coverage lifted repo-wide with behavior tests only (no `src/` change beyond this feature): **lines 93.2% → 99.6%**, statements 91.8% → 99.0%, branches 85.8% → 95.1%. The Codecov badge tracks line coverage. The Socket score (77) is Supply-Chain-Security only, with zero alerts: it reflects package age and a single maintainer, not code, and rises with time.
- **768 tests** (compiler **358** · core **227** · next 41 · nuxt 25 · svelte 25 · vite 23 · react 18 · vue 16 · sveltekit 13 · unplugin 12 · astro 10), was 622. The feature adds the compiler's `drafts` unit suite plus translate/review/check/import/status CLI paths; the rest of the jump is the coverage pass.
- publint/attw unchanged (no export-shape or packaging change beyond new named exports from `@verbaly/compiler`).
- Competitive seal 0.27.0 (2026-07-19, re-check): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. The "keyless" angle is now shared (next-intl `useExtracted`, Lingo.dev Compiler); Verbaly's edge stays the full write→ship cycle across every framework, and this release adds the reviewed-machine-translation gate that the compiler-based tools in the space do not offer built-in.

### Docs impact (synced)

- **`docs/reference/cli`**: new `verbaly review` row (list drafts, `--approve` accepts, optional `--locale`); `check` row gains `--drafts` (opt-in gate on unreviewed machine translations); `translate` row notes its output is marked as a draft; `status` row notes the unreviewed count; `import` row notes it clears the draft flag; new "Review the drafts" section with the loop.
- **`docs/guide/translators`**: extend the machine-translation story into a draft → review → approve loop (translate marks drafts, `review --approve` or an imported file accepts them, `check --drafts` gates CI). Mention the `.verbaly-drafts.json` sidecar is committed and never edited by hand.
- **`docs/reference/api`** (if it lists compiler exports): add `loadDrafts`/`saveDrafts`/`markDrafts`/`clearDrafts`/`effectiveDrafts`/`DRAFTS_FILE` and the `Drafts` type; `TranslateRequest` gains `origins`.
- **Landing compare table**: seal identical; if a row mentions machine translation, it can now say "with a review gate".
- **`/changelog`** (`releases.ts` + new `changelog_rel.v0_27_0` keys ×3): 0.27.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.27.0` + `@verbaly/compiler@^0.27.0` (+ the other `@verbaly/*` it depends on), **`pnpm install` only after the npm publish**.

---

## [0.26.0] · 2026-07-18

**Astro joins the family, and adopting Verbaly on an existing app stops being a chore.** A new `@verbaly/astro` integration wires everything with one line and runs the per-locale rendering by itself; the compiler now extracts text written directly in `.astro` files; a new `verbaly wrap` command finds your hardcoded JSX text and wraps it for you; and `verbaly check` can now report failures as clickable annotations on your GitHub pull requests. No breaking changes.

### Highlights

- **Astro support, one line.** Add `verbaly()` to the integrations in `astro.config` and everything is wired: live extraction while you code, type-safe keys, and the build gate. The typed keys live inside Astro's own `.astro` folder, so no extra file lands in your project. If you use the pre-translated mirror flow, `verbaly render` now runs by itself after every build.
- **Write your text right in `.astro` files.** The same `` t`…` `` you already use in `.js`, `.tsx`, `.svelte` and `.vue` now works in the frontmatter and in the markup of Astro components. The compiler extracts it, types it, and keeps the catalogs in sync.
- **Migrating an existing app? Let `verbaly wrap` do the boring part.** It scans your React (or any JSX) code, finds the hardcoded user-visible text, and wraps it in `` t`…` `` for you. It reports first; nothing is touched until you pass `--write`. Anything ambiguous is listed for a human instead of guessed.
- **CI failures now point at your code.** `verbaly check --reporter github` turns every missing translation into a GitHub annotation on the exact file and line where the text lives, right on the pull request.
- **`verbaly status --json`** gives you the coverage numbers machine-readable, ready for badges and dashboards.

### Added

- **`@verbaly/astro`** (new package, the eleventh): a thin Astro integration. `astro:config:setup` injects `@verbaly/vite` with the project root pinned (Astro's Vite root can differ); `astro:config:done` registers the generated types through Astro's `injectTypes`, so they live under `.astro/` (already referenced by every Astro tsconfig) and **no `verbaly.d.ts` lands in the project**, with the dev server refreshing that same file as messages change; `astro:build:done` runs the same `renderSite` as the CLI. The mirror is opt-in (a `render` section in the config, or `render: true | RenderConfig` inline) so path-based i18n routing sites are never mirrored on top; server output skips it with a clear warning. Structural typing like sveltekit/nuxt: no runtime or type dependency on `astro` (method-style hooks for bivariance; assignability to the real `AstroIntegration` pinned in a type test against the astro devDep).
- **`.astro` extraction** (`@verbaly/compiler`): `analyzeFile` now dispatches `.astro` files. The frontmatter (the `---` fenced block) is parsed with Babel at shifted offsets, exactly like SFC script blocks; the markup pass reuses the strict scanner (`t` only, no `$t`), with the frontmatter blanked out. The default `include` gains the `astro` extension, and `SOURCE_FILE_RE` accepts `.astro` so the vite/unplugin transform rewrites it (live extraction + HMR come free through `@verbaly/vite`).
- **`verbaly wrap`** (`@verbaly/compiler`): onboarding codemod for JSX/TSX. Wraps hardcoded text children (joining text and expressions into one message: `<p>Hello {name}</p>` becomes ``<p>{t`Hello ${name}`}</p>``) and user-visible string attributes (`title`, `alt`, `placeholder`, `aria-label`). Report-only by default; `--write` applies. It errs on skipping, never on inventing: mixed text-and-markup (a split sentence ships broken translations), segments already using `t`, and expressions that render markup are reported as "needs a human"; `<Trans>` children and `data-verbaly` subtrees are left alone. Backticks and `${` in literal text are escaped so the output extracts back to exactly what was reported. Programmatic API: `wrapProject`/`wrapCode`.
- **`verbaly check --reporter github`** (`@verbaly/compiler`): failures become `::error` workflow annotations. Missing keys annotate the source file and line where the message lives (one annotation per key, locales grouped); unknown keys annotate the file that uses them. `githubCheckAnnotations` is exported for tooling.
- **`verbaly status --json`** (`@verbaly/compiler`): prints the `StatusResult` as JSON (exit 0 stays; `check` remains the CI gate).
- **`verbaly init` detects Astro** (`@verbaly/compiler`): an `astro` dependency wins over `vite` (Astro projects often list both) and the next steps point at `@verbaly/astro`.
- **`dts` config option** (`@verbaly/compiler`): where the generated types land. A path moves the file, `false` skips it; honored by `extract`, `doctor` and the bundler plugins (`writeDts` also accepts an explicit path and creates the directory). The default stays `<root>/verbaly.d.ts`, the one spot TypeScript includes with zero tsconfig; framework integrations with their own types slot pass their path through it (that is how `@verbaly/astro` wires `injectTypes`).

### Changed

- **The bundler plugins now respect the config's `include`/`exclude`** (`@verbaly/vite`, `@verbaly/unplugin`, via the new `createSourceFilter` in `@verbaly/compiler`): the transform only rewrites files the CLI would scan (transform scope == extract scope), and `include: []` disables source scanning entirely while keeping the virtual modules and the build gate. Found dogfooding `@verbaly/astro` on verbaly-web: a docs site whose pages display literal `` t`…` `` snippets got them extracted as phantom keys and rewritten in the shipped HTML; scoping the transform to the config is the fix, and it also makes a file the CLI never extracts impossible to rewrite into a key the gate then reports missing. picomatch (already in the tree via tinyglobby) becomes an explicit compiler dependency.

### Fixed

- **`translate.ts` had a raw NUL byte** (`@verbaly/compiler`) in the invalid-params sentinel, so git treated the file as binary since it landed: zero reviewable diffs (the exact 0.14.5 lesson). Now the `\u0000` escape, identical semantics.

### Notes

- **Verified e2e against Astro 7.1.1** (real `astro build` via the JS API, temporary fixture): frontmatter and markup `` t`…` `` extracted by the real CLI, rewritten through the real Vite pipeline (our `enforce: 'pre'` transform runs before Astro's compiler, same as svelte/vue), rendered via `virtual:verbaly`'s `createRequestInstance`, the post-build mirror produced `dist/es/index.html` with `<html lang="es">`, `dir`, and `data-verbaly` content pre-filled, and the injected types landed in `.astro/integrations/_verbaly_astro/verbaly.d.ts`, referenced by Astro's own `types.d.ts`, with no root file created.
- The `dts` decision (with Aron, 2026-07-19): per-project types cannot ship in a package's `dist` (they hold YOUR keys), so someone must generate them in the project; the whole ecosystem does (`next-env.d.ts`, `vite-env.d.ts`, `.nuxt/`, `.svelte-kit/`, Prisma into node_modules). The policy is now: use the framework's own types slot when it exists (Astro's `injectTypes` today; Nuxt's `prepare:types` hook is backlog), root file as the zero-config fallback elsewhere.
- Design: the integration keeps the thinness rule (zero new negotiation/instance/render code: it wires `@verbaly/vite` + `renderSite`). The `render` option widens the config field on purpose: `boolean` toggles, an object is both the opt-in and the settings.
- `wrap` scope decision: JSX/TSX first (React, Solid, Preact are the same carrier); SFC markup wrapping waits for real demand. The command cannot know how each framework brings `t` into scope (React's `useT()` is per component), so the CLI says it plainly: apply, follow the TS errors, run `verbaly extract`.
- Dogfood note: verbaly-web now builds through `@verbaly/astro` (the manual `verbaly render` step in its build script is gone) with `include: []`, since its docs pages ARE verbaly snippets. Known limitation recorded in the PLAN backlog: the markup scanner reads raw markup, so display-only `t(`/`` t` `` text outside expression braces can still produce phantom keys when the file IS in scope; candidate-in-expression-context is the follow-up if more consumers hit it.
- Territory extension (pillar 5): write-in-source now covers `.astro` markup. Competitive seal 0.26.0 (2026-07-18, re-check, identical versions to 0.25.0): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. In the Astro space: astro-i18next stalled at 1.0.0-beta.21, Astro's built-in i18n is routing-only (no catalogs, no type safety); nobody extracts natural text from `.astro` markup, and no i18n codemod in the space wraps existing JSX text.
- **622 tests** (compiler **256** · core 205 · next 30 · svelte 25 · nuxt 22 · **vite 22** · vue 16 · react 15 · sveltekit 13 · unplugin 10 · **astro 8**), was 579: +31 compiler (9 astro extraction/transform, 15 wrap unit, 3 wrap CLI, 2 check reporter, 1 status json, 1 dts option), +4 vite (include scope, `include: []` opt-out, dts path override, `dts: false`), +8 astro (plugin injection, types injection + root-free dev flow, mirror e2e on a temp project, inline render config, opt-in heuristics, server-output skip, AstroIntegration assignability).
- Bench re-run (ritual): lookup **53.6×**, interpolation **9.7×**, plural **5.0×**, currency **5.5×** vs i18next 26, in family with 0.25.0 (46.0×/17.1×/4.1×/5.2×). Bundle sizes unchanged (core untouched): **3.29 KB tree-shaken** · **5.54 KB full** · 1.60 KB devtools (min+gzip).
- publint **All good** ×11 · attw: astro ESM-only profile like nuxt/sveltekit (node16-from-CJS = dynamic import only, by design), the rest unchanged 🟢. Tarball: `@verbaly/astro` 6 files (`dist/` + LICENSE + README).
- **Publish note**: `@verbaly/astro` is a new package. The workflow picks `packages/*` up automatically, but the first publish needs the manual step + Trusted Publisher setup (PLAN → Publicación), then re-run the workflow (it resumes per-package).

### Docs impact (synced)

- **`frameworks.ts`**: new `astro` entry (devicon has `astro`); it propagates to hero icons, sidebar select, docs dropdown chips and the what-is grid.
- **NEW page `docs/frameworks/astro`**: own page (base framework, like react/vue/svelte). Lead + benefits + Installation (`pnpm add verbaly @verbaly/astro`, integration in `astro.config`) + write-in-place in `.astro` (frontmatter and markup snippet) + the two shipping modes: path-based i18n routing (Astro owns routes, `createRequestInstance` per page) and mirror mode (`data-verbaly` + automatic `verbaly render` post-build, hreflang/sitemap via config). Note the `render: boolean | RenderConfig` option.
- **`docs/guide/cli`**: new `wrap` row (report by default, `--write` applies, what it skips); `check` row gains `--reporter github`; `status` row gains `--json`; `extract` row's extension list gains `.astro`.
- **`docs/guide/migrate`**: `verbaly wrap` becomes the first step of the migration story (scan, review the report, `--write`, then `extract`).
- **`docs/frameworks/vite`**: the SFC live-extraction bullet gains `.astro`.
- **verbaly-web dogfood (recommended)**: the web is an Astro site; replace `astro build && verbaly render` in `package.json` with the `@verbaly/astro` integration (config stays in `verbaly.config.mjs`, the integration picks its `render` section up as the opt-in). That swap is the whole point of the package.
- **`/changelog`** (`releases.ts` + `changelog_rel.v0_26_0` keys ×3): 0.26.0 entry, theme + Highlights above in plain language.
- Landing compare table: seal identical, no cell changes; if the "write in the markup" row names extensions, add `.astro`. Bump web to `verbaly@^0.26.0` + `@verbaly/compiler@^0.26.0` (+ `@verbaly/astro@^0.26.0` if the dogfood swap lands), **`pnpm install` only after the npm publish**.

---

## [0.25.0] · 2026-07-18

**The whole language, not just the text: automatic RTL, real language names, and context for translators.** Adding Arabic or Hebrew now just works: the page direction follows the locale everywhere (browser switch, SvelteKit, Nuxt, Next.js and pre-rendered pages). Locale switchers get real language names from the platform instead of hardcoded tables. And translator exports now say where each text lives in your source. No breaking changes.

### Highlights

- **Right-to-left languages just work now.** Add Arabic, Hebrew or Persian and the page direction follows the language on its own: when the user switches, when the server renders, and in pre-rendered static pages. No `dir` attribute to manage, ever.
- **Language switchers without hardcoded names.** `localeName('es')` returns 'español', `localeName('de', 'en')` returns 'German'. The names come from the platform (`Intl.DisplayNames`), so any locale works without you maintaining a table.
- **Need the direction yourself?** `localeDirection('ar')` returns `'rtl'`. It is the same helper the rest of the toolkit uses, exported for your own layouts (like Next.js's root layout).
- **Translators now see where each text lives.** `verbaly export` marks every message with the source files it came from: XLIFF gets standard location notes, CSV gets a `location` column. Context stops being guesswork in the translation tool.

### Added

- **`localeDirection(locale)`** (`verbaly` core): returns `'ltr' | 'rtl'`. Uses `Intl.Locale` `getTextInfo`/`textInfo` where the engine has it, falls back to the locale's script (via `maximize()`) against an RTL-script table, then to an RTL-language table (Firefox has no `getTextInfo`). Never throws: a malformed tag degrades to a primary-subtag check.
- **`localeName(locale, displayIn?)`** (`verbaly` core): localized language name via `Intl.DisplayNames` (cached like every other `Intl` constructor). Defaults to the endonym (`localeName('es')` → 'español'); pass `displayIn` for exonyms. Falls back to the tag itself on unknown input, never throws.
- **Source locations in translator exports** (`@verbaly/compiler`): `verbaly export` now scans the project (the same extract pass) and maps every key to its root-relative source files. XLIFF 2.0 units gain `<notes><note category="location">src/App.tsx</note></notes>`; CSV gains a `location` column (multiple files joined with `; `). Mobile formats skip the scan on purpose: they are delivery artifacts, no translator reads them. Programmatic path: `ExportOptions.origins` + `MessageRegistry.origins()`.
- **`%verbaly.dir%` placeholder** (`@verbaly/sveltekit`): `verbalyHandle` fills it with the request locale's direction, next to `%verbaly.lang%`: `<html lang="%verbaly.lang%" dir="%verbaly.dir%">`.

### Changed

- **`switchLocale` and `persistLocale` now set `<html dir>`** (`verbaly` core) alongside the `<html lang>` they already set, using `localeDirection`. Client-side locale switches keep the direction right with zero consumer code.
- **`verbaly render` writes `dir` on `<html>`** (`@verbaly/compiler`) next to the `lang` it already wrote, per mirrored locale (same `setLang` opt-out gates both). Pre-rendered pages now match what the runtime sets after hydration (the render == runtime invariant, extended to direction).
- **`@verbaly/nuxt` keeps `<html dir>` in sync** with the live locale, next to the reactive `lang` it already managed.
- **CSV export header is now `key,source,target,location`** (`@verbaly/compiler`). Import reads columns by header name, so files in the old three-column shape still import fine; the new column is ignored on the way back.
- **Deps refresh, validated green**: magic-string 1.0.0 (pure ESM: fine, the compiler is ESM-only), svelte 5.56.6, vite 8.1.5, vue 3.5.40, @sveltejs/kit 2.70.0, @anthropic-ai/sdk 0.112.3. **tsdown stays 0.22.8**: 0.22.9 resolves a `rolldown-plugin-dts` whose `yuku-parser` (≥0.6.8) dropped the `walk` export and the dts build crashes; `yuku-parser` is pinned to 0.6.1 via pnpm override until upstream catches up (watched debt, see PLAN).

### Notes

- Design: direction handling follows the "lives once" pattern (`localeDirection` in core; `switchLocale`, `persistLocale`, render, sveltekit and nuxt all consume it). Competitors expose at most a lookup (i18next's `dir()`), none applies it end-to-end across client switch, SSR and SSG: that end-to-end wiring is the new territory. Lingui's PO catalogs already carry origin comments; among XLIFF/CSV toolchains, location notes are standard-conformant (XLIFF 2.0 `<notes>`) and ours now emits them.
- Next.js gets no code change on purpose (thin-adapter rule): the layout owns `<html>`, so the README documents `dir={localeDirection(locale)}` with the core helper.
- 579 tests (compiler **225** · core **205** · next 30 · svelte 25 · nuxt 22 · vite 18 · vue 16 · react 15 · sveltekit 13 · unplugin 10), was 563: +10 core (localeDirection rtl/ltr/script-override/malformed, localeName endonym/exonym/regional/garbage, persistLocale dir, switchLocale dir), +4 compiler (render dir ltr+rtl mirror, xliff notes + csv column, location round-trip through import, registry origins merge), +1 sveltekit (dir placeholder), +1 nuxt (reactive dir).
- Bench re-run (ritual): lookup **46.0×**, interpolation **17.1×**, plural **4.1×**, currency **5.2×** vs i18next 26, in family with 0.24.0 (28.8×/11.1×/5.0×/5.8×). Bundle sizes: **3.29 KB tree-shaken** (unchanged: the new helpers tree-shake out of the `createVerbaly` path) · **5.54 KB full** (+0.22 = `localeDirection` + `localeName` + the DisplayNames cache) · 1.60 KB devtools (min+gzip).
- publint **All good** ×10 · attw: core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10), next root dual 🟢 ×4 with ESM-only `./server`/`./client` by design. Tarballs verified: core 0.25.0 (`dist/` + LICENSE + README), compiler with `verbaly` rewritten to `0.25.0` and magic-string `^1.0.0`.
- Competitive seal 0.25.0 (2026-07-18, re-check, identical to 0.24.0): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. Territory unchanged, plus the new end-to-end direction claim above.

### Docs impact (synced)

- **`docs/reference/api`**: two new helper rows (`localeDirection`, `localeName`) in the helpers table; the `switchLocale`/`persistLocale` descriptions gain "+ `<html dir>`".
- **`docs/guide/translators`**: the export section notes that XLIFF/CSV now carry source-file locations (context for the translator); CSV header example becomes `key,source,target,location`.
- **`docs/guide/cli`**: `export` row mentions location notes; `render` row mentions `<html dir>` next to `<html lang>`.
- **`docs/frameworks/svelte` (#sveltekit)**: `app.html` snippet gains `dir="%verbaly.dir%"`.
- **`docs/frameworks/vue` (#nuxt)**: the "keeps `<html lang>` in sync" line becomes lang + dir.
- **`docs/frameworks/react` (#next)**: layout snippet gains `dir={localeDirection(locale)}` (import from `verbaly`).
- **`docs/frameworks/dom`** (or wherever `persistLocale` is shown): mention it now sets the page direction too.
- **Playground / locale switcher dogfood**: the web's hardcoded `LOCALE_NAMES` endonym table can now come from `localeName()` (real package export); optional but it is exactly the friction this release removes.
- **`/changelog`** (`releases.ts` + `changelog_rel.v0_25_0` keys ×3): 0.25.0 entry, theme + Highlights above in plain language.
- Landing compare table: no cell changes (seal identical). Bump web to `verbaly@^0.25.0` + `@verbaly/compiler@^0.25.0`, **`pnpm install` only after the npm publish**.

---

## [0.24.0] · 2026-07-16

**Literal braces reach your messages, and pre-rendered pages get the runtime's full protection.** Rich text now decodes numeric HTML entities (`&#123;` and `&#x7B;` style), so a message can finally show a literal `{` or `}` without confusing the placeholder syntax. In the same pass, `verbaly render` closes a gap with the runtime: translated attributes in static HTML now go through the exact same security guards as the browser interpreter. No breaking changes.

### Highlights

- **Messages can now show literal curly braces.** Write `&#123;` and `&#125;` in a rich message and they render as `{` and `}`. Before, a raw brace broke the placeholder syntax and the entity came out as literal text, so there was no way to display one. Hex forms like `&#x7B;` work too, in the browser, in every `<Trans>` and in pre-rendered pages.
- **Pre-rendered pages are now as safe as the browser.** `verbaly render` translates attributes with the same rules the runtime always used: unsafe links (`javascript:` and friends) never land in the HTML, and dangerous attributes like `style` and `srcdoc` are never written from translations.

### Added

- **Numeric character references in rich text** (`verbaly` core): `parseTags` decodes decimal (`&#123;`) and hexadecimal (`&#x7B;`, case-insensitive) references alongside the named `lt`/`gt`/`amp` set. Decoding stays post-tokenize on text runs only, so a decoded brace or angle bracket can never re-enter the message parser or the tag tokenizer. Out-of-range code points (above U+10FFFF) and malformed references stay literal. Applies everywhere `parseTags` runs: `bindDom` rich, the three `<Trans>` adapters and `verbaly render`.
- **`safeAttribute(name, value)`** (`verbaly` core): the attribute guard as a public helper: returns `undefined` for `on*`/`style`/`srcdoc` names and for URL attributes (`href`, `src`, `xlink:href`, `action`, `formaction`) whose value fails `safeHref`; the value otherwise. `bindDom` and `verbaly render` both consume it, so the guard lives once (same pattern as `normalizeLink`).

### Fixed

- **`verbaly render` skipped the runtime's attribute guards** (`@verbaly/compiler`): the `data-verbaly-attr` path only blocked `on*` names, so a malicious or compromised catalog could pre-render `href="javascript:..."`, `style` or `srcdoc` values into the static HTML that ships before hydration (and `bindDom` skips those attributes, so nothing overwrote them after hydration either). Both sides now share `safeAttribute`, restoring the render == runtime invariant on the attribute path. Found by this release's audit, not reported externally.

### Changed

- **`richToHtml` link handling goes through `normalizeLink`** (`@verbaly/compiler`, internal): `render` re-inlined the string-vs-object link normalization plus `safeHref`; it now consumes core's `normalizeLink` like every adapter. No behavior change.
- **README dash sweep leftovers** (root + core): two `5–35×` ranges survived the 0.23.0 sweep with an en dash; now `5-35×`.

### Notes

- Friction origin (dogfooding): verbaly-web's changelog page translates versioned prose and had five highlights it could not bind, because messages mentioning placeholder syntax had no way to show a literal brace. This release gives them a path (`&#123;`); the web re-binds them in its sync.
- 563 tests (compiler **221** · core **195** · next 30 · nuxt 21 · svelte 25 · vite 18 · vue 16 · react 15 · sveltekit 12 · unplugin 10), was 551: +7 core tags (decimal, hex case-insensitivity, inside tag children, numeric angle brackets stay inert, decode-once, out-of-range literal, malformed literal), +2 core dom (rich braces alongside real params, `safeAttribute` contract), +3 compiler render (style/srcdoc block, URL sanitization mirror of `bindDom`, numeric-entity round-trip).
- Bench re-run (ritual): lookup **28.8×**, interpolation **11.1×**, plural **5.0×**, currency **5.8×** vs i18next 26, in family with 0.23.0 (36.7×/10.2×/5.0×/6.2×). Bundle sizes: 3.33 KB tree-shaken · 5.32 KB full · 1.60 KB devtools (min+gzip); the full surface grows ~0.1 KB for the numeric decoder + `safeAttribute`, the tree-shaken path is unchanged.
- `pnpm outdated`: devDep patches taken and validated (svelte 5.56.5, tsdown 0.22.8). Zero new dependencies.
- publint **All good** ×10 · attw: core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10), next root dual 🟢 ×4 with ESM-only `./server`/`./client` by design. Core tarball verified: 0.24.0, `dist/` + LICENSE + README only, `safeAttribute` in the built output; compiler tarball: `verbaly` dep rewritten to `0.24.0`.
- Competitive seal 0.24.0 (2026-07-16, re-check, identical to 0.23.0): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. Territory unchanged.

### Docs impact (synced)

- **`/changelog` (`releases.ts` + catalogs)**: re-bind the five highlights left unbound for lack of a brace path (0.20 h1, 0.17 h6, 0.11 h2, 0.8 h1, 0.7 h1): add their `changelog_rel.*.hN` keys ×3 with braces written as `&#123;`/`&#125;`, and drop the "llaves literales NO se bindea" exception from the web PLAN and `verbaly-docs-sync` (the standard becomes: braces in versioned prose = numeric entities).
- **`docs/frameworks/dom`** (rich text section): the entity note grows from named `lt`/`gt`/`amp` to numeric references; one line with the `&#123;` example (show a literal brace inside `<code>`).
- **`docs/guide/format`**: optional one-liner where escapes are documented: in rich messages, `&#123;` is the way to display a literal brace (the `{{` escape remains the plain-text path).
- **`docs/guide/server`** (or wherever `render` security is mentioned): note that translated attributes in pre-rendered HTML now pass the same guards as the runtime (unsafe URLs blocked, `style`/`srcdoc` never written).
- **`/changelog`** (`releases.ts`): 0.24.0 entry, theme + Highlights above in plain language.
- Landing compare table: no cell changes (seal identical). Playground: no changes (message format untouched).
- Bump web to `verbaly@^0.24.0` + `@verbaly/compiler@^0.24.0`, **`pnpm install` only after the npm publish**.

---

## [0.23.0] · 2026-07-14

**The 1.0-readiness release: one `<Trans>` contract everywhere, live extraction and a coverage view.** The three framework adapters now share the exact same `<Trans>` surface and rendering rules, the CLI learns `status` (how much is left to translate, per locale) and `extract --watch` (live extraction for bundlers without the Vite plugin), and the last planned pre-1.0 breaking changes land: `@verbaly/svelte` moves to Svelte 5 only, and React/Vue `<Trans>` render whitelisted tags as real elements like the rest of the toolkit always did. **Two breaking changes**, both called out below.

### Highlights

- **`<Trans>` is now the same component in React, Vue and Svelte.** Same props everywhere (`id`, `values`, `instance`, `components`, `richTags`, `links`) and same rendering rules: your custom component wins, then named links, then the safe tag whitelist, and anything unknown degrades to plain text.
- **Breaking: React and Vue `<Trans>` now render whitelisted tags for real.** A message like `The <em>build</em> gate` shows a real `<em>` element, matching Svelte and the DOM interpreter. Before, React and Vue flattened it to plain text. If you relied on that, pass `richTags={[]}`.
- **Breaking: `@verbaly/svelte` requires Svelte 5.** Svelte 4 support is retired while the project is still 0.x. In exchange, the Svelte `<Trans>` finally gets the `components` prop: map a tag in your message to your own component.
- **`verbaly status` tells you how much is left to translate.** One line per language ("es: 45/48 translated (94%)"), no CI noise. `verbaly check` stays the build gate.
- **`verbaly extract --watch` keeps catalogs and types in sync as you code.** Made for webpack, Rspack and Rollup setups, where the Vite plugin's live extraction isn't available.
- **Easier to give feedback.** The README now says exactly where a bug report or a friction report goes, and the issue forms cover all ten packages.

### Added

- **`components` prop on Svelte `<Trans>`** (`@verbaly/svelte`): maps a tag name to a Svelte component; the tag content arrives as `children`. Wins over `links` and the whitelist, mirroring React/Vue. Typed as `Record<string, Component<{ children?: Snippet }>>` in `Trans.svelte.d.ts`.
- **`instance` and `richTags` props on React and Vue `<Trans>`** (`@verbaly/react`, `@verbaly/vue`): render from an explicit instance without a provider/plugin (parity with Svelte), and override the tag whitelist per usage. Without a provider and without `instance`, `<Trans>` throws the usual actionable error.
- **`verbaly status`** (`@verbaly/compiler` CLI): per-locale translation coverage against the needed key set (extracted + source catalog), with a checkmark on complete locales. Informational only: exit code stays 0. Exported for tooling as `status(cfg, catalogs, registry)` + `formatStatusResult` (`StatusResult`, `LocaleStatus` types).
- **`verbaly extract --watch`** (`@verbaly/compiler` CLI): initial extract, then re-extract debounced on source file changes (`fs.watch` recursive; Node ≥ 20 covers all platforms). Watches source files only, so extract's own catalog/dts writes never retrigger a run. Rejected together with `--prune` (a mid-edit state could unreference keys and prune would drop their translations) and with `--dry-run`. The primitive is exported as `watchProject(cfg, run, options?)` (`WatchProjectOptions`).

### Changed

- **Breaking: React and Vue `<Trans>` render whitelisted phrasing tags as real elements** (`@verbaly/react`, `@verbaly/vue`): same whitelist as `data-verbaly-rich` (`richTags` overrides it), resolution order `components` → `links` → whitelist → unwrap. They used to unwrap every tag not in `components`/`links` to inner text, silently dropping formatting that `bindDom`, `verbaly render` and the Svelte `<Trans>` displayed. Migration: pass `richTags={[]}` to keep the old flattening. React guards the void tags (`br`, `wbr`), which reject children in React's renderer.
- **Breaking: `@verbaly/svelte` peer moves to `svelte: ^5.0.0`** (was `^4.0.0 || ^5.0.0`): `Trans.svelte`/`TransNodes.svelte` migrate to runes (`$props`/`$derived`), which is what makes a sane `components` implementation possible (children flow through Svelte 5 snippets; the Svelte 4/5 slot-vs-snippet split was the original blocker, noted since 0.10.0). Stores and context helpers are unchanged. Svelte 4 apps: stay on `@verbaly/svelte@0.22.0`.
- **`writeCatalog` skips identical writes** (`@verbaly/compiler`): content-compared like `writeDts` has been since 0.21.0, so an unchanged extract no longer touches catalog files (no spurious rebuilds for whatever watches them, including `extract --watch` consumers' bundlers).
- **npm-visible prose sweep** (all packages, repo): package.json descriptions, all eleven READMEs, CONTRIBUTING and the issue/PR templates drop the em dash per the project style rule; the compiler README's CLI list gains `status` and `extract --watch`; the bug report form now lists `@verbaly/sveltekit`/`@verbaly/nuxt`/`@verbaly/next` and CONTRIBUTING's monorepo map includes the three meta-framework packages.

### Notes

- **The Svelte 4 decision, with data** (verified 2026-07-14): svelte@5 is 77.0% of the ~4.8M weekly svelte downloads, svelte@4 is 17.7% and falling; Verbaly's audience is new projects (the 0.x adopter installing an i18n library today is overwhelmingly on 5). Pre-1.0 this retirement costs one explicit changelog line; post-1.0 it would cost a 2.0.0. Recorded as the last planned breaking change in the queue.
- **API freeze audit (pre-1.0 pass) ran across the ten packages.** Fixed: the `<Trans>` divergence (above). Kept as conscious decisions: `parse`/`flatten` stay under their generic names (documented low-level API, scoped by the module import); per-call helpers say `supported` while config/integrations say `locales` (a call-site list vs the project's locale set); `LOCALE_COOKIE` stays a sveltekit re-export of core's `LOCALE_STORAGE_KEY`. With this pass, 1.0 criterion 2 (no known breaking changes queued) is met.
- Feedback infrastructure refreshed for 1.0 criterion 3: README gains a **Feedback** section (bug/friction/star paths), issue templates updated (version placeholder, ten packages), CONTRIBUTING mentions all release-train packages.
- 551 tests (compiler **218** · core 186 · next 30 · nuxt 21 · svelte **25** · vite 18 · vue **16** · react **15** · sveltekit 12 · unplugin 10), was 533: +10 compiler (status coverage/format/empty ×3, watch run-and-filter + burst-coalescing ×2, identical-write skip ×1, CLI status + `--watch` guardrails ×4), +3 react (whitelist render, custom `richTags`, `instance` prop reactivity), +3 vue (same trio), +2 svelte (`components` children, precedence over links and whitelist).
- Bench re-run (ritual): lookup **36.7×**, interpolation **10.2×**, plural **5.0×**, currency **6.2×** vs i18next 26, in family with 0.22.0 (30.3×/10.3×/5.0×/5.4×). Core runtime untouched this release: bundle sizes unchanged (3.28 KB tree-shaken · 5.21 KB full · 1.60 KB devtools, min+gzip; re-measured 3.33/5.24/1.60, esbuild harness variance).
- `pnpm outdated`: `@sveltejs/kit` devDep 2.69.2 → 2.69.3 (tests green). Zero new dependencies.
- publint **All good** ×10 · attw: core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10), next root dual 🟢 ×4 with ESM-only `./server`/`./client` by design. Svelte tarball verified: peers rewritten to `svelte ^5.0.0` + `verbaly ^0.23.0`, only `dist/` + LICENSE + README.
- Competitive seal 0.23.0 (2026-07-14, same-day re-check, identical to 0.22.0): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. Territory unchanged.

### Docs impact (synced)

- **`docs/frameworks/react`** and **`docs/frameworks/vue`**: the `<Trans>` sections gain the unified contract: whitelisted tags render as real elements (same whitelist as `data-verbaly-rich`), new `richTags` and `instance` props, resolution order components → links → whitelist → unwrap. **Flag the behavior change** (previously flattened; `richTags={[]}` restores it).
- **`docs/frameworks/svelte`**: `<Trans>` gains `components` (example: tag → component receiving children); **Svelte 4 support removed** (peer `^5.0.0`, breaking): update any "Svelte 4/5" or "4 and 5" wording on this page, in `frameworks.ts` descriptions and in `docs/init/what-is` if present. The "no `components` by design" note (if mirrored anywhere) is obsolete.
- **`docs/guide/cli`**: new `status` command row (coverage per locale, exit 0) and the `extract --watch` flag (live extraction without Vite; rejected with `--prune`/`--dry-run`). The translators page can mention `status` as the "how much is left" view.
- **`docs/guide/translators`**: optional one-liner: `verbaly status` shows per-locale progress before exporting.
- Landing compare table: no cell changes (same-day seal). Playground: no changes (message format untouched).
- **`/changelog`** (`releases.ts`): 0.23.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.23.0` + `@verbaly/compiler@^0.23.0`, **`pnpm install` only after the npm publish**.

---

## [0.22.0] · 2026-07-14

**Your catalogs become native mobile resources.** `verbaly export` learns two new formats: `android-xml` writes drop-in `res/values-*/strings.xml` folders and `ios-strings` writes `*.lproj/Localizable.strings`, so a web app and its mobile companion can share one set of translations. The same release makes catalog reads safer: a corrupt catalog file now stops the CLI with a clear error instead of being silently treated as empty. No breaking changes.

### Highlights

- **Export your translations for mobile apps.** `verbaly export --format android-xml` writes Android resource folders you can drop into `res/`, and `--format ios-strings` writes `.lproj` folders for Xcode. One catalog, web and mobile.
- **Sensible defaults for the platforms.** Your source language becomes the platform default (`values/strings.xml`, `en.lproj`), and untranslated keys are left out so the app falls back to the default language instead of showing empty text.
- **Safer catalog files.** A catalog with broken JSON now stops the command and names the file, instead of being read as empty (which could have ended in lost translations on the next extract). A Windows BOM at the start of the file is simply tolerated.

### Added

- **`verbaly export --format android-xml`** (`@verbaly/compiler`): one `strings.xml` per locale in Android's resource layout: the source locale as default `values/`, two-letter regions as `values-ll-rRR` (`pt-BR` → `values-pt-rBR`), longer BCP-47 tags via the `b+` syntax. Keys are sanitized to valid resource names (`hero.title` → `hero_title`, digit-start keys get a `_` prefix) and a post-sanitize collision fails loudly naming both keys. Values get Android escaping (apostrophes, quotes, backslashes, newlines, leading `@`/`?`) on top of XML entities.
- **`verbaly export --format ios-strings`** (`@verbaly/compiler`): `<locale>.lproj/Localizable.strings` per locale, `"key" = "value";` pairs with quote/backslash/newline escaping. Keys keep their original form (no identifier constraint on iOS).
- **`ExportFormat` / `MobileFormat` types + `isMobileFormat`** (`@verbaly/compiler`): the export format union grows to four; `ExchangeFormat` stays as the translator-file subset (xliff, csv) and import is untouched (mobile formats are a delivery target, not a round-trip).

### Changed

- **A corrupt catalog fails loudly** (`@verbaly/compiler`): `readCatalog` still reads a missing file as an empty catalog, but a file that exists and is not valid JSON now throws naming the path. The old silent-empty behavior was a data-loss path: the next `extract` would have rewritten the file with empty values. The fix surfaces through every consumer (CLI, vite, unplugin, next). A leading BOM is stripped before parsing, so BOM'd catalogs (common with Windows editors) now parse instead of failing.
- **`--missing` is rejected for mobile formats** (`@verbaly/compiler` CLI): it exports translator worklists; mobile output already skips untranslated keys so the app falls back. The error says exactly that.
- **`@verbaly/next`**: the client's `VerbalyProviderProps` now extends the serializable props type from `./server` (plus `children`) instead of re-declaring the shape. Type-level only, no runtime change.

### Notes

- **Values are exported verbatim**: params keep Verbaly's `{name}` brace syntax and plural variants stay in message-format form. Converting to printf-style placeholders (`%1$s`, `%@`) or Android `<plurals>` needs assumptions about argument order and types that only a real mobile consumer can validate: deliberately out of scope until that friction shows up. The natural consumers today run an ICU-style formatter on the app side.
- Backlog item "Export targets mobile" closed: it lives in the compiler, zero new repos, zero new dependencies.
- 533 tests (compiler **208** · core 186 · next 30 · nuxt 21 · svelte 23 · vite 18 · vue 13 · react 12 · sveltekit 12 · unplugin 10), was 526: +6 mobile export (layouts, escapes, name collisions, CLI happy path and rejections) and +2/±1 catalog reads (BOM tolerated, corrupt throws).
- Verified end-to-end with the built CLI over a scratch project: both layouts written as drop-in trees, default `values/` and `en.lproj` carrying the source, untranslated keys skipped with the count reported as `untranslated skipped`, `--missing` and unknown formats rejected with exit 1 and actionable messages.
- Bench re-run (ritual): lookup **30.3×**, interpolation **10.3×**, plural **5.0×**, currency **5.4×** vs i18next 26, in family with 0.21.0 (31.7×/11.1×/4.6×/5.1×). Core untouched this release: bundle sizes unchanged (3.28 KB tree-shaken · 5.21 KB full · 1.60 KB devtools, min+gzip).
- `pnpm outdated` clean; zero new dependencies.
- Competitive seal 0.22.0 (2026-07-14, same-day re-check, identical to 0.21.0): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.22.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. Territory unchanged: nobody extracts natural source text from `.svelte`/`.vue` markup, and none of the web-first tools ship native mobile resource export from the same catalog.

### Docs impact (synced)

- **`docs/guide/translators`**: new section "Export for mobile apps": the two commands, the drop-in layouts (`values-*/strings.xml`, `*.lproj/Localizable.strings`), source locale = platform default, untranslated keys skipped so the app falls back, params stay in `{name}` syntax.
- **`docs/guide/cli`**: the `export` row/section gains the two formats (`--format android-xml | ios-strings`) and the note that `--missing` applies only to xliff/csv.
- **`/changelog`** (`releases.ts`): 0.22.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.22.0` + `@verbaly/compiler@^0.22.0`, **`pnpm install` only after the npm publish**.

---

## [0.21.0] · 2026-07-14

**Quality pass across the ten packages, plus typed Nuxt options.** An adversarial review swept the whole monorepo for duplicated logic, dead code and readability debt, and every worthwhile finding landed: shared plugin primitives grew, the runtime got slightly smaller, `verbaly.d.ts` stops rewriting itself when nothing changed, and `@verbaly/nuxt` options are now typed inside `nuxt.config.ts` (still with zero dependency on `@nuxt/kit`). One small breaking change for direct compiler-API consumers: `generateDts`/`writeDts` take the plain catalog object instead of a `Map`.

### Highlights

- **Typed options for `@verbaly/nuxt`.** The `verbaly` key in `nuxt.config.ts` now autocompletes and catches typos ("Did you mean 'cookie'?"), without adding any dependency to the module.
- **A calmer editor in dev.** `verbaly.d.ts` is only rewritten when its content actually changes, so the TypeScript server stops reloading types on every save.
- **Slightly smaller runtime.** The quality pass trimmed dead work from the core: the tree-shaken runtime is now 3.28 KB min+gzip (was 3.30).
- **Cleaner generated types.** A param used as both date and text no longer produces a duplicated union in `verbaly.d.ts`.
- **Clearer CLI messages.** Every error and hint now reads with plain connectors, and `check` prints the source text right next to the missing key.
- **Breaking** (compiler API only): `generateDts(catalog)` and `writeDts(cfg, catalog)` now take the catalog object (`Record<string, string>`) directly instead of a `Map`. The CLI and all plugins are unaffected.

### Added

- **`transformSource(code, id, registry)`** (`@verbaly/compiler` plugin primitives): the analyze + register + rewrite step every bundler plugin runs per source file, now defined once in `plugin.ts`; `@verbaly/vite` and `@verbaly/unplugin` consume it.
- **`PluginOptions`** (`@verbaly/compiler`): the shared bundler-plugin options shape (`VerbalyConfig` + `failOnMissing`). `ViteVerbalyOptions` and `UnpluginVerbalyOptions` are now aliases of it; `NextVerbalyOptions` extends it. Same shapes as before, defined once.
- **`verbalyModule.getOptions`** (`@verbaly/nuxt`): typed options resolver on the module function. It performs the same merge as the module body, and it is the anchor Nuxt's generated `.nuxt/types/modules.d.ts` needs to infer `VerbalyNuxtOptions` for the `verbaly` key in `nuxt.config.ts` (the plain call signature alone degrades the inference to `Record<string, any>`). Verified with a type-level test that mirrors Nuxt's generated conditional exactly.

### Changed

- **Breaking (`@verbaly/compiler`): `generateDts` and `writeDts` take a `Catalog`** (`Record<string, string>`) instead of `Map<string, string>`. Every production call site was already converting a record into a `Map` just to satisfy the signature. Only affects direct API consumers; CLI and plugins are wrappers over the same calls.
- **`writeDts` skips unchanged writes** (`@verbaly/compiler`): content-compared before writing, mirroring the `.verbaly/` convention in `@verbaly/next`.
- **`runBuildGate(cfg, registry, failOnMissing?)`** (`@verbaly/compiler`): the `failOnMissing === false` opt-out moved inside the gate; vite, unplugin and next stop re-implementing the comparison.
- **CLI and error messages drop the em dash** (all packages): every user-facing string now uses a colon, comma or parentheses (`no config file, running on defaults` · `[verbaly] doctor: 6 checks` · `x7Ka9q2f: "Hello world"` · `ghost.key (used in app.ts)` · help header `verbaly · i18n compiler`). Cosmetic, but scripts grepping exact CLI output will notice.
- **Quality pass, compiler**: `handleTrans` builds its `TaggedMessage` in one place; the AST `walk` loop no longer allocates an entries array per node (hottest loop in extract/check); `exportCatalogs` computes the untranslated set once; `doctor`'s helper params no longer shadow the imported `check()`; `renderParamType` dedupes union members.
- **Quality pass, core**: devtools drops dead `Bound` fields and an unreachable observer branch; `setLocale`/`pendingLoader` lose duplicated loader checks; `bindDom` unifies its three per-element attribute caches behind one `fromCache` helper and `renderRich` reads each link once; `parseTags` reuses the module regex instead of allocating one per call; the ICU number-style mapping collapses to one expression.
- **Quality pass, integrations**: `@verbaly/vite`'s `unlink` handler uses `isTransformTarget` (the one definition of "source file") and its catalog watcher drops a dead optional param; `@verbaly/next` extracts the dev-phase sync/write pipeline into one `syncAndWrite` used by `withVerbaly` and the watcher, and the webpack rule reuses the module-level `SOURCE_PATH_RE` instead of respelling it.
- **Dev tooling**: tsdown 0.22.5 → 0.22.7, typescript-eslint 8.63.0 → 8.64.0 (validated: build, tests, typecheck, lint all green).

### Notes

- **`@nuxt/kit` decision (backlog item closed): staying kit-free.** Reviewed against the dependency rule (layer c): `defineNuxtModule` would delete only the manual merge and the `.meta` line, while its `defu` merge concatenates arrays (a semantic regression for `locales`/`include`, where inline should win), it adds a 20-transitive-dependency package, couples the module to kit majors, and forces test machinery. The one real gap it closed (typed `nuxt.config.ts`) is now closed kit-free via `getOptions`. Revisit only if the module needs DevTools metadata or compatibility gating.
- 526 tests (core 186 · compiler 201 · next 30 · nuxt **21** · svelte 23 · vite 18 · vue 13 · react 12 · sveltekit 12 · unplugin 10), was 525: +1 nuxt (type-level mirror of Nuxt's `modules.d.ts` inference; a typo in the config must be rejected, so a future signature change that degrades the inference fails the suite).
- Review method: three parallel adversarial reviewers (compiler dense files, core runtime, plugins/adapters) with the project invariants as ground rules; findings verified against the code before applying, borderline ones rejected (the canonical/og:url branches in `render` and the currency/unit cases in `format` stay explicit on purpose; browser detection stays duplicated because deduping changes `navigator.languages` semantics).
- Verified end-to-end with the built CLI over a scratch project: init → extract → check → doctor → stray-flag rejection, new message formats rendering correctly, exit codes intact.
- Bench re-run (ritual): lookup **31.7×**, interpolation **11.1×**, plural **4.6×**, currency **5.1×** vs i18next 26, in family with 0.20.0 (36.4×/10.6×/4.8×/5.4×).
- Bundle check: tree-shaken `createVerbaly` **3.28 KB** min+gzip (was 3.30), full core surface **5.21 KB** (was 5.24), `verbaly/devtools` **1.60 KB** (was 1.63). The cleanups pay for themselves.
- `pnpm outdated` clean after the two dev-tooling bumps; zero new dependencies.
- Competitive seal 0.21.0 (2026-07-14): i18next 26.3.6 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · **Paraglide 2.22.0** (was 2.21.0, minor bump, still key-based at the source) · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 · svelte-i18n 4.0.1 · vue-i18n 11.4.6. Territory unchanged: nobody extracts natural source text from `.svelte`/`.vue` markup; the table stands.

### Docs impact (synced)

- **`docs/frameworks/vue` `#nuxt` section**: one line after the module setup: the `verbaly` key in `nuxt.config.ts` is fully typed since 0.21.0 (autocomplete + typo checking).
- **CLI output mirrors**: any snippet on the web that mirrors CLI output with an em dash (`✗ [en] x7Ka9q2f — 1 missing` style) must re-mirror the new formats (`[es] x7Ka9q2f: "Hola {name}"` · `ghost.key (used in app.ts)` · `[verbaly] doctor: 6 checks`). The web PLAN's rule-3 exception for verbatim CLI output can be retired afterwards.
- **`docs/reference/api`**: only if `generateDts`/`writeDts` appear there (they are compiler internals; likely absent), update the signature to take the catalog object.
- **`/changelog`** (`releases.ts`): 0.21.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.21.0` + `@verbaly/compiler@^0.21.0`, **`pnpm install` only after the npm publish**.

---

## [0.20.0] — 2026-07-13

**Write your text in `.svelte` and `.vue` files too.** The write-in-source promise now covers single-file components: `` t`…` `` (and Svelte's `` $t`…` ``) is extracted, keyed and typed straight from `.svelte` and `.vue` files, script blocks and markup alike. Until now the compiler only read `.js/.ts/.jsx/.tsx`, so Svelte and Vue components had to fall back to hand-written keys. This closes the most visible DX gap on the road to 1.0. No breaking changes.

### Highlights

- **Natural text in Svelte and Vue components.** Write `` <h1>{$t`Hello ${name}`}</h1> `` in a `.svelte` file, or ``{{ t`Hello ${name}` }}`` in a `.vue` template, and the compiler does the rest: stable key, typed params, per-locale catalogs. Works in script blocks, markup, template interpolations and attribute bindings.
- **Svelte's store form is understood.** In Svelte components `t` is a store, so you use it as `$t`. The extractor recognizes `` $t`…` ``, `$t('key')` and `` $t.id('key')`…` `` everywhere in a `.svelte` file.
- **Live in dev, gated in build.** Save a `.svelte`/`.vue` file with new text and the catalogs plus `verbaly.d.ts` update on the spot (Vite). Missing translations still block the build.
- **Readable keys and runtime keys work in markup too**: `` t.id('home.title')`…` `` extracts under your key, and `t('key')` calls count as used keys for `check` and `extract --prune`.
- **`verbaly extract` scans more by default.** The default `include` now covers `.svelte`/`.vue` files and the `app/` folder (where Nuxt 4 and the Next.js App Router live), next to `src/`. Your own `include` config still wins.

### Added

- **SFC extraction** (`@verbaly/compiler`): new `analyzeFile(code, file)` dispatcher (exported, with `analyzeSfc` and `SFC_FILE_RE`): `.svelte`/`.vue` files are analyzed in two passes. (a) **Script blocks** (`<script>`, `<script setup>`, `<script context="module">`) parse with the same Babel analyzer, offsets shifted to file coordinates. (b) **Markup** is scanned after blanking scripts, styles and HTML comments (length-preserving, so offsets stay honest): each strict candidate (`t` immediately followed by `` ` ``, `(` or `.id(`; `$t` accepted in `.svelte`) has its exact expression extent found by a balanced scanner (nested `${…}`, strings, nested templates and paren groups) and that slice goes through the real Babel analyzer. No candidate, no parse; prose can never become a key.
- **`AnalyzeOptions.tNames`** (`@verbaly/compiler`): `analyze(code, file, { tNames })` accepts extra identifiers treated as the `t` tag; the SFC path passes `['t', '$t']` for Svelte.
- **Vite/unplugin transform `.svelte`/`.vue`** (`@verbaly/vite`, `@verbaly/unplugin`): `SOURCE_FILE_RE`/`isTransformTarget` now match both extensions (query-suffixed sub-requests like `?vue&type=style` stay excluded), both plugins analyze via `analyzeFile`, and the Vite `unlink` watcher drops messages of deleted `.svelte`/`.vue` files. Both plugins run `enforce: 'pre'`, so the rewrite happens on the raw SFC source before the framework compiles it.

### Changed

- **Markup rewrites quote with `'`** (`@verbaly/compiler` transform): a rewrite inside a double-quoted attribute (`` :title="t`…`" `` in Vue) must not emit `"`; SFC-markup messages carry a `singleQuote` flag and `transformCode` emits `t('key', { 'name': name })` for them. JS/TS output is unchanged (`t("key", { "name": name })`).
- **Default `include`** (`@verbaly/compiler` config): `src/**/*.{js,jsx,ts,tsx,mjs,mts}` → `{src,app}/**/*.{js,jsx,ts,tsx,mjs,mts,svelte,vue}`. Additive only (more files scanned); explicit `include` configs are untouched. `app/` covers Nuxt 4's `srcDir` and Next.js App Router projects without `src/`, which the old default silently missed for the CLI path.

### Notes

- 525 tests (core 186 · compiler **201** · next 30 · nuxt 20 · svelte 23 · vite **18** · vue 13 · react 12 · sveltekit 12 · unplugin 10), was 501: +23 compiler (`sfc.test.ts`: svelte script/markup/`$t`/`t.id`/attributes/comments/prose-safety/nested-braces/unterminated-EOF, vue script-setup/interpolation/directive/style, transform quote matrix), +1 vite (`.svelte` + `.vue` through the real plugin transform, catalog fed).
- Design decisions: markup candidates are **strict** (no whitespace between `t` and `` ` ``/`(`): a stray `t(` in prose parses to nothing (non-literal first arg), and an accidental used key would make `check` fail, so the scanner errs on the side of missing over inventing. Comments are blanked before scanning: commented-out code never reaches the catalogs. A malformed segment skips silently instead of failing the file (mirror of `errorRecovery` in the JS path). `.svelte.ts`/`.svelte.js` rune modules keep the plain JS path (they are not SFCs).
- Verified end-to-end with the built CLI over a scratch project (svelte + vue, `src/` + `app/`): 6 messages extracted (script, markup with params, explicit `t.id` key, vue setup/interpolation/attribute), svelte comment and vue `<style>` ignored, `$t('runtime.key')` registered as used key, `en` scaffolded with `''`.
- Bench re-run (ritual): lookup **36.4×**, interpolation **10.6×**, plural **4.8×**, currency **5.4×** vs i18next 26, in family with 0.19.0 (32.8×/11.3×/4.6×/5.4×; the runtime is untouched this release).
- Bundle check: tree-shaken `createVerbaly` **3.30 KB** min+gzip, full core surface **5.24 KB**, `verbaly/devtools` **1.63 KB** (all unchanged from 0.19.0; core has zero code changes).
- publint **All good** ×10 · attw: compiler/vite/unplugin keep the ESM-only profile (CJS-consumer warning by design), dual packages untouched. Compiler tarball verified (0.20.0, peer `verbaly` rewritten, only `dist/` + LICENSE + README).
- `pnpm outdated` clean (deps already at latest stable; no new dependencies this release).
- Competitive seal 0.20.0 (2026-07-13): i18next 26.3.6 · react-i18next 17.0.9 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.21.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1, identical to the 0.19.0 seal; table stands. This release's territory: **no competitor extracts natural source text from `.svelte`/`.vue` markup.** Lingui's macros cover JSX (Vue needs a separate extractor setup, Svelte has no first-class story); Paraglide, typesafe-i18n, svelte-i18n 4.0.1 and vue-i18n 11.4.6 are key-based at the source. Verbaly's angle: the same `` t`…` `` everywhere you write UI text.

### Docs impact (synced)

- **`docs/frameworks/svelte`**: after the stores example, add a short **write-in-source** block: `` $t`Hello ${name}` `` works directly in `.svelte` markup and script since 0.20.0 (extracted, keyed and typed on save; `` $t.id('key')`…` `` for readable keys). Mirror the package README snippet.
- **`docs/frameworks/vue`**: same addition for `.vue`: ``{{ t`Hello ${name}` }}`` in templates and `` :title="t`…`" `` in bindings extract since 0.20.0. Mirror the package README snippet.
- **`docs/frameworks/vite`**: if the page lists config fields or the default `include`, update it to `{src,app}/**/*.{js,jsx,ts,tsx,mjs,mts,svelte,vue}`; note that `.svelte`/`.vue` are transformed too.
- **`docs/guide/cli`**: the `extract` description scans `.svelte`/`.vue` as well; mention the new default include if the page names it.
- **`docs/init/what-is`** / landing copy: anywhere write-in-source is framed as JS/TS-only, it now covers Svelte and Vue components; optional one-line callout.
- **`/changelog`** (`releases.ts`): 0.20.0 entry, theme + Highlights above in plain language.
- Bump web to `verbaly@^0.20.0` + `@verbaly/compiler@^0.20.0`, **`pnpm install` only after the npm publish**.

---

## [0.19.0] — 2026-07-13

**Next.js joins the family — the cycle is complete.** The third and last big meta-framework integration: **`@verbaly/next`** brings the write→ship cycle to the Next.js App Router — Server Components translate with `await getT()`, Client Components use the familiar React hooks, and every request negotiates its own locale (cookie → `Accept-Language` → fallback) with flash-free hydration. Works on **Turbopack** (the Next 16 default) and webpack. Also fixes a long-standing rich-text limitation: messages can now display literal markup like `<html lang>` (HTML entities decode in text runs). No breaking changes.

### Highlights

- **New package `@verbaly/next`** — Next.js App Router in two steps: wrap your config with `withVerbaly()` in `next.config.ts` and drop `<VerbalyProvider>` into the root layout. Server Components translate with `await getT()`; Client Components keep using `useT`/`<Trans>` (re-exported from `@verbaly/react`).
- **Turbopack and webpack, both first-class** — the `` t`…` `` compiler runs as a loader under `turbopack.rules` and under webpack; catalogs stay code-split per locale. `next dev` extracts your messages live; `next build` blocks on missing translations.
- **Per-request negotiation, zero locale leaks** — cookie → `Accept-Language` → fallback resolved once per request via React `cache()`; concurrent visitors never see each other's language, and hydration renders exactly what the server sent (no flash of untranslated text).
- **`useSwitchLocale()`** — switches the client instantly, persists the cookie the server reads, and re-renders Server Components through `router.refresh()`.
- **Rich messages can show literal markup** — `parseTags` now decodes `&lt;`, `&gt;` and `&amp;` in text runs, so a message can display "`<html lang>`" as visible text instead of a broken escape.

### Added

- **`@verbaly/next` package** (new, dual ESM+CJS root): (a) **`withVerbaly(nextConfig, options?)`** — config wrapper that runs the initial extraction, writes the runtime module as **real files in `.verbaly/`** (Turbopack has no virtual-module API — `turbopack.resolveAlias` points `virtual:verbaly` at the generated file; webpack gets a `NormalModuleReplacementPlugin` because webpack 5 treats `virtual:` as a URI scheme and `resolve.alias` never fires), registers the transform loader on both bundlers, starts a debounced re-extract watcher in `next dev` (catalogs + `verbaly.d.ts` + `.verbaly/` stay fresh; content-compared writes so identical output never retriggers the bundler) and runs the **build gate** on `next build` (`failOnMissing: false` opts out); (b) **`@verbaly/next/server`** — `getT()`/`getVerbaly()`/`getRequestLocale()`/`getVerbalyProps()`, deduped per request via React `cache()`, negotiating with core's `resolveRequestLocale` over `await cookies()`/`headers()` and building the instance with `createRequestInstance` (never the singleton); (c) **`@verbaly/next/client`** — `<VerbalyProvider locale messages>` seeds the instance synchronously from the serialized catalog (hydration matches the server byte-for-byte, and `messages` is omitted when the locale is the source — it ships inline in the client bundle) and follows out-of-band locale changes; `useSwitchLocale()` = core `switchLocale` + `router.refresh()`; `Trans`/`useT`/`useLocale`/`useVerbaly` re-exported; (d) **`@verbaly/next/loader`** — the `` t`…` ``/`<Trans>` transform as a webpack/Turbopack loader (async: the ESM-only compiler loads via dynamic `import()`). Options: `cookie` (default `verbaly-locale`, `false` = header-only) and `fallback` ride the generated module as `requestOptions`; every `VerbalyConfig` field passes through. Dependency: `@verbaly/compiler`; peers: `verbaly`, `@verbaly/react`, `react ^18||^19`, `next ^15||^16`.
- **`loadMessages(locale)`** (`@verbaly/compiler` codegen → `virtual:verbaly`): returns the raw catalog for a locale (source inline, rest lazy) — the primitive SSR integrations use to serialize the active catalog across the client boundary. Declared in `verbaly.d.ts`.
- **`generateRuntimeModule(cfg, options?)`** (`@verbaly/compiler`): new `RuntimeModuleOptions` — `localeImport` (custom locale-module specifiers; `@verbaly/next` points them at real files) and `extraExports` (extra module code; `requestOptions` rides it). Loaders now live in a shared `localeLoaders` const consumed by both `createInstance` and `loadMessages`.

### Fixed

- **HTML entities decode in rich text runs** (`verbaly`): `parseTags` now decodes `&lt;`/`&gt;`/`&amp;` in text (post-tokenize, so `&lt;em&gt;` renders as literal text and never becomes a real tag; single-pass, so `&amp;lt;` decodes exactly once). A rich message can finally display `<html lang>` as visible text — it used to render escaped in bound locales (hit real verbaly-web keys like `docs_guide.li_render_lang`, which had to be reworded around it). `verbaly render` re-escapes text runs when serializing, so pre-rendered HTML round-trips idempotently. All `<Trans>` components and `bindDom` treat text runs as text nodes — no injection surface.

### Notes

- 501 tests (core **186** · compiler **178** · **next 30** · nuxt 20 · svelte 23 · vite 17 · vue 13 · react 12 · sveltekit 12 · unplugin 10) — was 464; +30 next (compose/merge with user config, phases, build gate + opt-out, codegen idempotence + stale-locale cleanup, loader transform/passthrough/node_modules, server negotiation matrix + props serialization, client provider hydration + switch + server-driven locale change, type-level `NextConfig` compat), +5 core (entity decode suite), +2 compiler (`loadMessages` + runtime-module options).
- Verified end-to-end against a real **Next.js 16.2.10** app installed from the packed tarballs, on **both bundlers**: Turbopack production build (gate blocks missing translations with the actionable message, then passes), full negotiation matrix (q-values, `es-MX`/`pt-BR`/`es-PE` narrowing, cookie beats header, unsupported cookie falls to header, `q=0` excluded, no-match → fallback), **60 concurrent requests with zero locale leak**, clean hydration (0 console messages), live `useSwitchLocale` (client + Server Component text, cookie, `<html lang>`) persisting across reload, `next dev` live extraction (a new `` t`…` `` lands in catalogs + `verbaly.d.ts` + `.verbaly/` and renders with `''`-fallback semantics), and the **webpack path** (`next build --webpack`) serving the same translations.
- Turbopack lessons (encoded in code comments and tests): (1) a bare extension glob in `turbopack.rules` also matches Next's internal App Router entry and panics reading a directory — the rule is `'*'` restricted by `condition: { all: [{ not: 'foreign' }, { path: /\.[cm]?[jt]sx?$/ }] }`, and a user's `'*'` rule is preserved by merging into an array; (2) MagicString sourcemaps carry an empty `sources` entry that Turbopack resolves to the module's directory and panics — the loader anchors `map.sources = [resourcePath]`; (3) `resolveAlias` accepts the `virtual:verbaly` specifier under Turbopack, but webpack 5 parses `virtual:` as a URI scheme (`UnhandledSchemeError`) — `NormalModuleReplacementPlugin` (via the `webpack` instance Next passes to the config fn) does the job there, with the alias kept as fallback.
- Windows caveat (upstream Turbopack, not ours): projects in **very deep directories** can exceed `MAX_PATH` under `next dev` (chunk filenames embed module paths). Normal project paths are unaffected.
- Bench re-run (ritual): lookup **32.8×**, interpolation **11.3×**, plural **4.6×**, currency **5.4×** vs i18next 26 — in family with 0.18.0 (30.8×/10.0×/4.4×/5.1×; hot path untouched by the entity decode — it lives in `parseTags`, not `t()`).
- Bundle check: tree-shaken `createVerbaly` **3.29 KB** min+gzip (was 3.33; esbuild variance), full core surface **5.24 KB** (was 5.18; +0.06 = entity decode), `verbaly/devtools` **1.63 KB** (unchanged).
- publint **All good** ×10 · attw: `@verbaly/next` root entry 🟢 across node10/node16 CJS+ESM/bundler (dual — `next.config.ts` is often transpiled to CJS, so the root loads from `require` and reaches the ESM-only compiler via dynamic `import()`, preserved in the CJS output); `./server`+`./client` are ESM-only by design (Next bundles them; node10 💀 known-OK like other subpaths); `./loader` ships a **hand-written `export =` d.cts** (the runtime is `module.exports = fn` — the loader-runner contract; a generated ESM-default d.cts mismatches) — 🟢 node16/bundler. Tarball verified (deps/peers → `^0.19.0`; `dist/` + `loader.d.cts` + LICENSE + README).
- Competitive seal 0.19.0 (2026-07-13): i18next 26.3.6 · react-i18next 17.0.9 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.21.0 · next-intl 4.13.2 · @nuxtjs/i18n 10.4.1 — identical to the 0.18.0 seal; table stands. This release's territory: **next-intl is the incumbent** — it also serializes messages through a provider, but requires `[locale]` URL routing + `proxy.ts` middleware setup and its own `i18n/request.ts` config file; Verbaly's angle: no URL restructuring (cookie + `Accept-Language`), write-in-source messages, compiled type-safe catalogs, and the same `t` across all ten packages.
- **First-publish caveat** (repo process): `@verbaly/next` doesn't exist on npm yet — no Trusted Publisher until it does. If the workflow's OIDC publish fails for it, publish once manually (`pnpm --filter @verbaly/next publish --access public --no-git-checks`), configure its TP, re-run the workflow (per-package resume skips the rest).
- New devDeps (next package only): `next` 16.2.10, `react`/`react-dom` 19.2.7, `@types/react`/`@types/react-dom` — the type-compat test and unit tests. **Zero new runtime dependencies** (the package's one dependency is `@verbaly/compiler`, build-time layer).
- Repo: root README packages table gains the `@verbaly/next` row; `pnpm-workspace.yaml` allows the `sharp` build script (transitive of the `next` devDep).

### Docs impact (synced)

- **`docs/frameworks/react`**: add a **`#next` section** at the end (mirror of the SvelteKit-inside-Svelte / Nuxt-inside-Vue precedent): `withVerbaly` in `next.config.ts`, provider wiring in the root layout (`getVerbalyProps` + `<VerbalyProvider>` + `<html lang>` via `getRequestLocale`), `await getT()` in Server Components, client hooks from `@verbaly/next/client`, `useSwitchLocale`, options table (`cookie`, `fallback`, `failOnMissing`, `VerbalyConfig` passthrough), Turbopack + webpack support note, and the SSG note (negotiation reads headers → dynamic rendering; prefer `verbaly render` for fully static output). Mirror the package README.
- **`docs/guide/server`**: the "Meta-frameworks" section names SvelteKit and Nuxt — add Next.js with a link to `frameworks/react#next`. Next.js leaves the "roadmap" wording (`p_meta` copy).
- **`docs/frameworks/vite`**: the `virtual:verbaly` panel gains the `loadMessages(locale)` row.
- **`docs/init/what-is`** / cycle copy: anywhere the meta-framework story says "SvelteKit + Nuxt", it's now "SvelteKit, Nuxt and Next.js" (punto muerto 1 closed).
- **`frameworks.ts`**: do NOT add Next.js as a separate integration chip (precedent: SvelteKit lives inside Svelte's page, Nuxt inside Vue's; Next lives inside React's) — verify hero/dropdown copy still reads correctly.
- **`/changelog`** (`releases.ts`): 0.19.0 entry — theme + Highlights above.
- Landing compare table: seal identical, no cell changes — but if any row copy names "SvelteKit/Nuxt" as the SSR story, add Next.js.
- Optional (unblocked by the parseTags fix): `docs_guide.li_render_lang` and similar keys can now say `<html lang>` literally (`&lt;html lang&gt;` in the catalog) instead of the "atributo lang" rewording.
- Bump web to `verbaly@^0.19.0` + `@verbaly/compiler@^0.19.0` — **`pnpm install` only after the npm publish**.

---

## [0.18.0] — 2026-07-13

**Nuxt joins the family.** The second meta-framework integration: **`@verbaly/nuxt`** is a zero-config Nuxt module — one line in `nuxt.config` wires the Vite plugin, negotiates the locale per request (cookie → `Accept-Language` → fallback), awaits the catalog before render and keeps `<html lang>` in sync, so pages arrive translated and hydrate flash-free. Built entirely on the 0.16/0.17 primitives (`resolveRequestLocale`, `createRequestInstance`) with **zero dependency on `nuxt` or `@nuxt/kit`**. `switchLocale()` moves to core so both SSR integrations share it (`@verbaly/sveltekit` re-exports — nothing breaks). No breaking changes.

### Highlights

- **New package `@verbaly/nuxt`** — Nuxt SSR in one line: `modules: ['@verbaly/nuxt']`. The module wires `@verbaly/vite` (live extraction + `virtual:verbaly`), negotiates the visitor's language per request and hydrates the client with the same locale and catalog — no flash of untranslated text, no hydration mismatch, no locale leaking between concurrent users.
- **Zero framework lock** — no `@nuxt/kit`, no `nuxt` peer: the module is typed structurally (same approach that keeps `@verbaly/sveltekit` free of `@sveltejs/kit`), verified against the real `NuxtModule` type and a real Nuxt 4 app.
- **`switchLocale()` is now a core export** — the client-side language switch (catalog first, then locale, then cookie + `<html lang>`) lives once in `verbaly` and serves SvelteKit, Nuxt and hand-rolled setups. `@verbaly/sveltekit` re-exports it: existing imports keep working unchanged.
- **Client-only apps covered too** — with `ssr: false` the module still resolves the locale in the browser (cookie → `navigator.languages` → fallback).
- **Support Verbaly** — GitHub Sponsors is live: [github.com/sponsors/AronSoto](https://github.com/sponsors/AronSoto).

### Added

- **`@verbaly/nuxt` package** (new, ESM-only): a plain-function Nuxt module (configKey `verbaly`, inline options win) that (a) pushes a **fresh `@verbaly/vite` instance per Vite build** via the `vite:extendConfig` hook — client and server builds never share plugin state — with `root` pinned to the project dir (Nuxt's Vite root is `srcDir`, where no `verbaly.config` lives); (b) prepends a runtime plugin that negotiates via core's `resolveRequestLocale` over `ssrContext.event.headers`, transfers the result to the client through `useState` (the payload — hydration renders exactly the server's locale), awaits `createRequestInstance(locale)` **before** render (the no-FOUC contract), installs `@verbaly/vue`'s `verbalyPlugin` and keeps `<html lang>` reactive via `useHead`; (c) exposes `cookie` (default `verbaly-locale`, `false` = header-only) and `fallback` (default: source locale) module options riding `runtimeConfig.public`, plus full `ViteVerbalyOptions` passthrough. Actionable error when `locales` is missing. Dependency: `@verbaly/vite`; peers: `verbaly`, `@verbaly/vue`, `vue ^3.4`.
- **`switchLocale(instance, locale, { cookie?, maxAge? })`** (`verbaly`): moved from `@verbaly/sveltekit` — awaits `loadLocale` before `setLocale` (no flash), writes the cookie SSR integrations read (`path=/`, `samesite=lax`, 1y default), syncs `<html lang>`, SSR-safe no-op without a DOM. `SwitchLocaleOptions` exported. Tree-shakes out of bundles that don't import it.

### Changed

- **`@verbaly/sveltekit` re-exports `switchLocale`/`SwitchLocaleOptions` from core** — identical API and behavior; the package shrinks to `verbalyHandle` + `LOCALE_COOKIE` + the re-export. No consumer change.

### Notes

- 464 tests (core **181** · compiler 176 · **nuxt 20** · sveltekit **12** · svelte 23 · vue 13 · react 12 · unplugin 10 · vite 17) — was 443; +20 nuxt (module wiring/merge/fresh-plugin-per-build, negotiation cookie/header/narrowing/fallback, payload hydration, `cookie: false`/custom cookie, per-request isolation, reactive `<html lang>`, missing-locales guard, client-only cookie/navigator paths, type-level `NuxtModule` compat vs `@nuxt/schema`), +6 core (`switchLocale` browser suite + SSR-safe order test), −5 sveltekit (the `switchLocale` behavioral tests moved to core with the code).
- Verified end-to-end against a real **Nuxt 4.4.8** app installed from the packed tarballs: production `nuxt build` + Nitro server (Accept-Language q-values, `pt-BR`→pt / `es-PE`→es narrowing, cookie beats header, unsupported cookie falls to header, `es-MX` cookie narrows, no-match → fallback), **60 concurrent requests with zero locale leak**, clean hydration (0 console messages), live `switchLocale` (text + `<html lang>` + cookie) with persistence surviving reload, and `nuxt dev` (SSR negotiation + `verbaly.d.ts` written at the project root).
- New devDep (nuxt package only): `@nuxt/schema` for the type-level module-compat test — mirror of sveltekit's `Handle` assertion. Zero new runtime dependencies.
- Deps refreshed (release ritual, `pnpm outdated`): `@babel/parser` 8.0.4 (compiler, runtime dep — patch) · dev: i18next 26.3.6, vite 8.1.4, eslint 10.7.0, prettier 3.9.5, tsdown 0.22.5, @anthropic-ai/sdk 0.111.0. Full suite re-validated green after the update.
- Bench re-run (ritual): lookup **30.8×**, interpolation **10.0×**, plural **4.4×**, currency **5.1×** vs i18next 26 — in family with 0.17.0 (34.9×/11.2×/5.3×/4.5×; hot path untouched).
- Bundle check: tree-shaken `createVerbaly` **3.33 KB** min+gzip (was 3.40 — `switchLocale` tree-shakes out; minor esbuild variance), full core surface **5.18 KB** (was 5.08; +0.10 KB = `switchLocale`), `verbaly/devtools` **1.63 KB** (unchanged).
- publint **All good** ×9 · arethetypeswrong core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10) · `@verbaly/nuxt` main entry 🟢 across node10/node16/bundler, ESM-only CJS-consumer profile like compiler/vite/sveltekit (its `dist/runtime/plugin.js` ships without a subpath export — the module registers it by file path; its ambient imports `#imports`/`virtual:verbaly` must never ship as declarations). Tarballs verified (nuxt dep `@verbaly/vite` → `^0.18.0`, peers → `^0.18.0`; only `dist/` + LICENSE + README).
- Competitive seal 0.18.0 (2026-07-13): i18next 26.3.6 · react-i18next 17.0.9 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.21.0 · next-intl 4.13.2 — identical to the 0.17.0 seal; table stands. New reference for this release's territory: **@nuxtjs/i18n 10.4.1** (the Nuxt incumbent — powerful but config-heavy: lazy-load setup, per-file locale registration, its own message format). Verbaly's angle: compiled catalogs, type-safe params and a one-line module.
- **First-publish caveat** (repo process): `@verbaly/nuxt` doesn't exist on npm yet — no Trusted Publisher until it does. If the workflow's OIDC publish fails for it, publish once manually (`pnpm --filter @verbaly/nuxt publish --access public --no-git-checks`), configure its TP, re-run the workflow (per-package resume skips the rest).
- Repo: **GitHub Sponsors enabled** — `.github/FUNDING.yml` + a branded Sponsor section in the root README (icon reused from verbaly-web). Root README packages table gains the `@verbaly/nuxt` row.

### Docs impact (synced)

- **`docs/frameworks/vue`**: add a **`#nuxt` section** at the end (mirror of the SvelteKit-inside-Svelte pattern decided in 0.16.0): the one-line module setup, options table (`cookie`, `fallback`, `ViteVerbalyOptions` passthrough), components use `@verbaly/vue` as usual, language switch with `switchLocale` from `verbaly` + `useVerbaly`, `ssr: false` behavior, and the SSG note (prefer `verbaly render` for `nuxi generate`). Mirror the package README.
- **`docs/reference/api`**: new row `switchLocale(instance, locale, options?)` (core) next to `persistLocale`; note that `@verbaly/sveltekit` re-exports it.
- **`docs/frameworks/svelte#sveltekit`**: no code change needed (the `@verbaly/sveltekit` import keeps working) — optionally note `switchLocale` is a core export now.
- **`docs/guide/server`**: the "Meta-frameworks" section mentions SvelteKit — add Nuxt with a link to `frameworks/vue#nuxt`.
- **`docs/init/what-is`** / cycle copy: if any copy says "SvelteKit is the only meta-framework integration", update to SvelteKit + Nuxt.
- **`frameworks.ts`**: do NOT add Nuxt as a separate integration chip (0.16.0 precedent: SvelteKit lives inside Svelte's page; Nuxt lives inside Vue's) — but verify the dropdown/hero copy still reads correctly.
- **`/changelog`** (`releases.ts`): 0.18.0 entry — theme + Highlights above.
- Landing compare table: no cell changes (same-day competitor versions, table stands).
- Playground: no preset changes (message format untouched).
- Bump web to `verbaly@^0.18.0` + `@verbaly/compiler@^0.18.0` — **`pnpm install` only after the npm publish**.

---

## [0.17.0] — 2026-07-11

**Robust inside, for real.** The hardening release: a full-code audit of all eight packages fixed every sharp edge it found — a catalog string can no longer inject a `javascript:` URL through attribute translation, a bad currency code or date style degrades with a warning instead of crashing `t()`, the CLI rejects flags that belong to another command instead of silently ignoring them, and the SSR story gets its missing piece: `createRequestInstance()` in `virtual:verbaly` gives you a per-request instance with the catalog already loaded, in one call. **One breaking change**: `inspect()` renames its `locale` field to `from` (see Changed).

### Highlights

- **Attribute translation is now XSS-safe end to end** — `data-verbaly-attr` runs URL attributes (`href`, `src`, `action`…) through the same `safeHref` guard as rich links and blocks `style`/`srcdoc` entirely. A malicious or compromised catalog can't inject scripts.
- **`t()` never crashes on bad format arguments** — an invalid currency code (`{v:currency/US}`), date or time style now warns once and renders the plain value, matching how `unit` and `relative` already behaved.
- **`createRequestInstance(locale)` in `virtual:verbaly`** — the SSR per-request pattern in one call: fresh instance, catalog awaited, no flash. SvelteKit today, Nuxt next.
- **The CLI fails loudly on misplaced flags** — `verbaly translate --locale es` used to silently translate *all* locales; now it errors with "did you mean `--locales`?". Plus `--dry-run` for `extract --prune`.
- **`normalizeLink()` and `resolveRequestLocale()` in core** — the link sanitizer and the cookie→`Accept-Language` negotiation now live once in core; every adapter and SSR integration shares them.
- **Breaking:** `instance.inspect(key)` now returns `{ from, source }` instead of `{ locale, source }` — one name for one concept across the observability API (`ResolveInfo.from`).

### Added

- **`normalizeLink(link)`** (`verbaly`): normalizes `RichLink` (string or `{ href, target, rel }`) and applies `safeHref` — exported so react/vue/svelte `<Trans>` and `bindDom` share one sanitizer (was five copies).
- **`resolveRequestLocale({ supported, cookie, header, fallback })`** (`verbaly`): the per-request negotiation (cookie value → `Accept-Language` → fallback) extracted from `@verbaly/sveltekit` so Nuxt/hand-rolled servers reuse it. Tree-shaken out of browser bundles.
- **`LOCALE_STORAGE_KEY`** (`verbaly`): the `'verbaly-locale'` identity is a public export; `@verbaly/sveltekit`'s `LOCALE_COOKIE` now derives from it instead of duplicating the string.
- **`createRequestInstance(locale)`** (`@verbaly/compiler` codegen → `virtual:verbaly`): async factory that creates a request-scoped instance and awaits its catalog before returning — the no-FOUC contract codified. Declared in `verbaly.d.ts`.
- **`failOnMissing` option** (`@verbaly/vite`): the build gate can now be opted out (`ViteVerbalyOptions`), matching `@verbaly/unplugin`.
- **`--dry-run` on `verbaly extract`** (`@verbaly/compiler`): previews prune removals and additions without writing catalogs or types — prune was the only destructive command without a preview.
- **Shared plugin primitives** (`@verbaly/compiler`): `resolveVirtualId`, `loadVirtualModule`, `isTransformTarget`, `runBuildGate`, `RESOLVED_VIRTUAL_ID`, `LOCALE_MODULE_PREFIX`, `SOURCE_FILE_RE`, plus `targetLocales(cfg, override?)` — the code `@verbaly/vite` and `@verbaly/unplugin` used to copy now lives once.

### Changed

- **Breaking — `inspect()` returns `{ from, source }`** (`verbaly`): the origin-locale field is named `from`, matching `ResolveInfo.from`. Renaming after 1.0 would be worse; devtools already reads the new shape. Migration: `info.locale` → `info.from`.
- **BCP-47 narrowing is progressive everywhere** (`verbaly`): `resolveLocale`/`negotiateLocale` now narrow `zh-Hant-TW` → `zh-Hant` → `zh` like the runtime fallback chain always did (they used to jump straight to the base subtag). One shared helper; bootstrap and runtime can no longer disagree.
- **`data-verbaly-attr` hardening** (`verbaly`): URL attributes sanitized via `safeHref`, `style`/`srcdoc` blocked (on top of the existing `on*` block). Attribute maps are also now cached per element like args/links.
- **The pseudo QA catalog never auto-becomes a target** (`@verbaly/compiler`): `en-XA.json` in the locales dir no longer joins `cfg.locales` by discovery — running `verbaly pseudo` used to permanently turn the pseudo locale into a translate/render/check target. Explicit `locales: ['en-XA']` still wins.
- **Nested `` t`…` `` templates bail safely** (`@verbaly/compiler`): a tagged template inside another extracted message (`` t`hola ${cond ? t`x` : y}` `` or inside `<Trans>`) used to crash the transform with overlapping rewrites; now the outer bails (runtime template) and the inner extracts normally.
- **`useT()` keeps `t.id`** (`@verbaly/vue`): the reactive wrapper now preserves the tagged-template surface — `useT().id(...)` worked in react/svelte but was `undefined` in vue.
- **CLI flags are validated per command** (`@verbaly/compiler`): a flag owned by another command exits 1 with an actionable message instead of being ignored (`--locale` on `translate` hints `--locales`).

### Fixed

- **`{v:currency/BAD}`, `{v:date/bogus}`, `{v:time/bogus}` no longer throw** (`verbaly`): they warn once and fall back to the plain value — a single bad catalog entry used to crash the whole render with an uncaught `RangeError`.
- **Flaky sveltekit cookie test** (repo): value-specific assertion; an expired leftover cookie in happy-dom occasionally tripped it.

### Notes

- 443 tests (core **175** · compiler **176** · sveltekit 17 · svelte **23** · vue **13** · react **12** · unplugin **10** · vite **17**) — was 404; +16 core (attr XSS, formatter guards, narrowing, `normalizeLink`, `resolveRequestLocale`, AST-cache cap), +17 compiler (**`cli.test.ts` is new — the command layer had zero tests**: dispatch, exit codes, stray flags, extract/prune/dry-run, check; plus nested-template and pseudo-locale discovery), +2 vite (unknown-keys gate, `failOnMissing`), +1 unplugin (unknown-keys gate), +1 vue/react/svelte each (`useT().id`).
- New module `packages/compiler/src/plugin.ts` (shared plugin primitives) and `src/run.ts` (`runCli(args)` — the CLI body, now testable; `cli.ts` is a thin bin wrapper). Zero new dependencies.
- Bench re-run (ritual): lookup **34.9×**, interpolation **11.2×**, plural **5.3×**, currency **4.5×** vs i18next 26 — in family with 0.16.0 (35.6×/11.9×/7.3×/5.5×; hot path untouched).
- Bundle check: tree-shaken `createVerbaly` **3.40 KB** min+gzip (was 3.27 — +0.13 KB is the never-crash formatter guards; pillar 3 buys it), full core surface **5.08 KB** (was 4.81 — +0.27 KB = `normalizeLink` + `resolveRequestLocale` + attr hardening), `verbaly/devtools` **1.63 KB** (unchanged).
- publint **All good** ×8 · arethetypeswrong core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10). Tarballs verified (core 0.17.0, only `dist/` + LICENSE + README; sveltekit peer `verbaly` → `^0.17.0`).
- **Deliberate pre-1.0 decisions recorded this release**: (a) `stableKey` stays sha256/base64url/8 chars (48 bits) — fine at catalog scale; the registry's same-key-different-message warning is the collision tripwire; widening later is breaking, decided consciously. (b) ICU `offset:` remains parsed-but-ignored (documented limitation). (c) Svelte `<Trans>` keeps no `components` prop by design (fragile across Svelte 4/5 — re-evaluate when the Svelte 4 peer drops).
- Competitive seal 0.17.0 (2026-07-11): same-day as the 0.16.0 seal — i18next 26.3.6 · react-i18next 17.0.9 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.21.0 · next-intl 4.13.2. No changes; the comparison table stands.

### Docs impact (synced)

- **`docs/reference/api`**: `inspect()` row — return shape is now `{ from, source }` (**breaking**, flag it); new rows for `normalizeLink(link)`, `resolveRequestLocale(options)` and `LOCALE_STORAGE_KEY` next to `negotiateLocale`.
- **`docs/frameworks/vite`** (where `virtual:verbaly` is documented): add `createRequestInstance(locale)` — the recommended SSR path (one call replaces createInstance + await loadLocale); mention `failOnMissing` in the plugin options.
- **`docs/frameworks/svelte#sveltekit`**: simplify the `+layout.ts` snippet to use `createRequestInstance` from `virtual:verbaly`.
- **`docs/guide/server`**: mention `resolveRequestLocale` as the cookie+header negotiation helper for hand-rolled servers (it's what `verbalyHandle` uses).
- **`docs/guide/cli`**: `--dry-run` now also applies to `extract` (prune preview); note that misplaced flags now error instead of being ignored.
- **`docs/frameworks/dom`** (attribute translation section): note that URL attributes are sanitized and `style`/`srcdoc` are blocked — worth a security callout.
- **`/changelog`** (`releases.ts`): 0.17.0 entry — theme + Highlights above.
- Landing compare table: no cell changes (same-day seal).
- Playground: no preset changes (message format untouched).
- Bump web to `verbaly@^0.17.0` + `@verbaly/compiler@^0.17.0` — **`pnpm install` only after the npm publish**.

---

## [0.16.0] — 2026-07-11

**Server-side rendering, for real.** The first meta-framework integration: **`@verbaly/sveltekit`** renders every page in the visitor's language on the server — negotiated per request from their cookie or `Accept-Language` header — and the client hydrates with the same locale and the same catalog, so there's no flash of untranslated text and no hydration mismatch. Built on two framework-agnostic pieces (core's `negotiateLocale` and the new `createInstance` factory in `virtual:verbaly`) that Nuxt/Next integrations will reuse. No breaking changes, no API removals, no new dependencies.

### Highlights

- **New package `@verbaly/sveltekit`** — SvelteKit SSR in three wires: `verbalyHandle()` in your server hooks, one `+layout` load, and `%verbaly.lang%` in `app.html`. Pages arrive translated; hydration is flash-free.
- **Per-request locale negotiation** — cookie → `Accept-Language` (with q-values and `es-PE` → `es` narrowing) → fallback. Concurrent requests never leak each other's language.
- **`switchLocale()`** — client-side language switch that loads the catalog first, then persists the choice in the cookie the server reads, so the next SSR request already matches.
- **`negotiateLocale()` in core** — the `Accept-Language` matcher is a public, framework-agnostic export; use it in any Node server today.
- **`createInstance()` in `virtual:verbaly`** — build a fresh, request-scoped instance sharing your compiled catalogs and loaders; the old singleton stays for SPAs. Also new: `locales` and `sourceLocale` exports.

### Added

- **`@verbaly/sveltekit` package** (new, ESM-only): `verbalyHandle({ locales, fallback?, cookie? })` — SvelteKit `handle` hook factory that resolves the request locale (cookie → `Accept-Language` → fallback), sets `event.locals.verbalyLocale` and fills every `%verbaly.lang%` placeholder via `transformPageChunk`; throws an actionable error if `locales` is missing/empty (e.g. an outdated `@verbaly/vite` whose virtual module lacks the export). `switchLocale(instance, locale, { cookie?, maxAge? })` — awaits `loadLocale` **before** `setLocale` (no flash), writes the cookie (`path=/`, `samesite=lax`, 1y default) and syncs `<html lang>`; SSR-safe no-op without a DOM. `LOCALE_COOKIE` (`'verbaly-locale'`, same identity as core's storage key). **Typed structurally — zero dependency on `@sveltejs/kit`** (compat asserted against the real `Handle` type in tests); only peer is `verbaly`.
- **`negotiateLocale(header, supported, fallback?)`** (`verbaly`): RFC-style `Accept-Language` negotiation — q-values (invalid → 1, `q=0` excluded, ties keep header order), case-insensitive exact match then BCP-47 base narrowing, `*` ignored, garbage-safe. Tree-shaken out of browser bundles that don't import it.
- **`virtual:verbaly` gains SSR exports** (`@verbaly/compiler` codegen): `createInstance(options?)` (fresh instance with the same inlined source catalog + lazy loaders; options spread on top — the module singleton is now built from it), `locales`, `sourceLocale`. `verbaly.d.ts` declares all three.

### Changed

- **`Release` workflow resumes per package** (repo process): the publish step now checks each package on npm individually instead of gating on `verbaly@V` — a partially failed run (or a manual first publish of a new package, which can't have a Trusted Publisher until it exists) resumes cleanly.

### Notes

- 404 tests (core **159** · compiler **159** · **sveltekit 17** · svelte 22 · vue 12 · react 11 · unplugin 9 · vite 15) — was 373; +13 core (`negotiateLocale` in locale/server suites), +1 compiler (codegen SSR exports), +17 sveltekit (handle negotiation/cookie/placeholder/kit-type-compat + switchLocale order/cookie/lang, happy-dom).
- Verified end-to-end against a real SvelteKit app (Kit 2.69.2 + Vite 8 + Svelte 5) installed from the packed tarballs: SSR negotiation (`es-PE`→es, fr→fallback, cookie beats header), concurrent es/en requests with zero cross-request leak, clean hydration (no console errors), live `switchLocale` + cookie persistence surviving reload.
- Bench re-run (ritual): lookup **35.6×**, interpolation **11.9×**, plural **7.3×**, currency **5.5×** vs i18next 26 — in family with 0.15.0 (29.3×/10.5×/5.2×/4.9×; machine variance, runtime hot path untouched).
- Bundle check: tree-shaken `createVerbaly` **3.27 KB** min+gzip (3.32 in 0.15.0 — `negotiateLocale` tree-shakes out), full core surface **4.81 KB** (was 4.63; +0.18 KB = the new helper), `verbaly/devtools` **1.62 KB** (unchanged).
- publint **All good** ×8 · arethetypeswrong core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10) · `@verbaly/sveltekit` ESM-only (same CJS-consumer profile as compiler/vite). Tarballs verified (sveltekit peer `verbaly` → `^0.16.0`; vite dep `@verbaly/compiler` → `0.16.0`; only `dist/` + LICENSE + README).
- Competitive seal 0.16.0 (2026-07-11): i18next 26.3.6 · react-i18next 17.0.9 · Lingui 6.5.0 · typesafe-i18n 5.27.1 · Paraglide 2.21.0 · next-intl 4.13.2 — identical to the 0.15.0 seal (one day apart). This release starts closing dead-end #1 (SSR hydration), the gap next-intl represents.
- **First-publish caveat** (repo process): `@verbaly/sveltekit` doesn't exist on npm yet, so it can't have a Trusted Publisher before the release. If the workflow's OIDC publish fails for it, publish it once manually (`pnpm --filter @verbaly/sveltekit publish --access public --no-git-checks`), configure its Trusted Publisher, then re-run the workflow — the per-package resume skips what's already on npm.

### Docs impact (synced)

- **New docs page `docs/sveltekit`** (Integrations group): the six wires (vite plugin → `app.html` placeholder → `hooks.server.ts` + `app.d.ts` Locals → `+layout.server.ts` → `+layout.ts` with `createInstance` + awaited `loadLocale` → `provideVerbaly` in `+layout.svelte`) + `switchLocale` for the language picker + the no-FOUC/no-mismatch guarantee. Mirror the package README.
- **`frameworks.ts` + `docs-nav.ts`**: add SvelteKit to the integrations source (devicon `svelte`… check if devicon has a SvelteKit glyph; otherwise reuse Svelte's) — it propagates to the home hero grid, `docs/what-is` grid and the Integrations sidebar/dropdown.
- **`docs/api`**: new row `negotiateLocale(header, supported, fallback?)` next to `resolveLocale`/`persistLocale`.
- **`docs/vite`** (or wherever `virtual:verbaly` is documented): document the new `createInstance`/`locales`/`sourceLocale` exports (SSR: one instance per request; the singleton is browser/SPA-only).
- **`docs/server`**: add the "meta-framework" path — link to `docs/sveltekit`; mention `negotiateLocale` as the header matcher for hand-rolled Node servers.
- **`/changelog`** (`releases.ts`): 0.16.0 entry — theme + Highlights above.
- Landing compare table: no cell changes (competitor versions identical to 0.15.0 seal); the SSR row of "dead ends" narrative improves — check `docs/what-is` copy if it mentions "no SSR story".
- Bump web to `verbaly@^0.16.0` + `@verbaly/compiler@^0.16.0` — **`pnpm install` only after the npm publish**.

---

## [0.15.0] — 2026-07-10

**Your translators can work now.** The write→ship cycle opens up to humans: `verbaly export` writes translator-ready XLIFF 2.0 or CSV files (source text + current translation per entry) and `verbaly import` fills the catalogs back — validating every entry the way `translate` does, so a translator's typo in a `{param}` or an `<em>` tag never reaches your UI. Flat JSON stays the native format (most TMS platforms ingest it directly); export/import is the round-trip for everything else. No breaking changes, no API removals, no new dependencies.

### Highlights

- **`verbaly export`** — one translator-ready file per locale, XLIFF 2.0 (TMS standard) or CSV (spreadsheets), with the source text next to each translation. `--missing` exports only what's untranslated.
- **`verbaly import`** — reads translated XLIFF 2.0/1.2 or CSV back into your catalogs. Every entry is structure-validated: translations that drop a `{param}`, a plural variant or a tag are rejected and reported instead of breaking your UI.
- Existing translations are kept unless you pass `--overwrite`; `--dry-run` previews the whole import.
- No TMS needed for the simple case: catalogs are plain flat JSON — Crowdin, Lokalise, Phrase and friends ingest them natively.

### Added

- **`verbaly export` command** (`@verbaly/compiler`): writes one file per target locale to `verbaly-export/` (`--out` to change) with source + current target per entry. Formats: **XLIFF 2.0** (`<unit id>` per key, `state="translated|initial"`, XML-escaped, default) and **CSV** (RFC 4180, header `key,source,target`, quoted fields). `--missing` exports only untranslated entries; `--locales` filters targets; entries whose source is `''` are skipped (nothing to translate yet). New exports: `exportCatalogs` + types `ExchangeFormat`, `ExportOptions`, `ExportResult`, `ExportedFile`.
- **`verbaly import <files…>` command** (`@verbaly/compiler`): fills catalogs from translated files. Reads **XLIFF 2.0** (`trgLang`, `<unit>`) **and 1.2** (`target-language`, `<trans-unit>`, CDATA, numeric entities) plus **CSV** (locale from filename, `--locale` override). Per entry: unknown keys are ignored and reported; empty targets skipped; existing translations kept unless `--overwrite`; and **every entry passes the same structural validation as `translate`** (`structureMatches` — params/variants/tags must survive verbatim) or it's rejected and reported. `--dry-run` previews without writing. Guards: refuses the source locale as target, and rejects garbage locales from renamed files (`es (1).csv`) with a `--locale` hint. New exports: `importCatalogs`, `parseExchangeFile` + types `ImportOptions`, `ImportResult`.

### Changed

- **GitHub Release notes are now short** (repo process, not API): the `Release` workflow publishes only the entry's theme + the new **Highlights** section, with an auto-appended link to this changelog — which remains the full record. This is the first entry in the new format.
- **Community docs pass** (repo): SECURITY.md opens with the one-line security model before the technical detail; CONTRIBUTING.md's PR checklist got scannable bold leads. No policy changes.

### Notes

- 373 tests (core 146 · compiler **158** · svelte 22 · vue 12 · react 11 · unplugin 9 · vite 15) — was 359; +14 compiler (`exchange.test.ts`: XLIFF/CSV round-trip, escaping, 1.2 + CDATA + numeric entities, rejection/skip/overwrite/dry-run semantics, source-locale and garbage-locale guards).
- Bench re-run (ritual): lookup **29.3×**, interpolation **10.5×**, plural **5.2×**, currency **4.9×** vs i18next 26 — in family with 0.14.5 (31.2×/10.6×/4.3×/4.5×; machine variance). The core runtime is untouched this release.
- Bundle check: tree-shaken `createVerbaly` **3.32 KB** min+gzip, full core surface **4.63 KB**, `verbaly/devtools` **1.62 KB** — same code as 0.14.5 (deltas are measurement variance, core unchanged).
- publint **All good** ×7 · arethetypeswrong core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10). Tarballs verified (compiler: `workspace:*` → `0.15.0`; vite peer `verbaly` → `^0.15.0`; only `dist/` + LICENSE + README).
- New module `packages/compiler/src/exchange.ts` — zero new dependencies (XLIFF written/parsed with no XML lib; CSV parser is ~40 lines of RFC 4180). Import validation reuses `structureMatches` from `translate` — one source of truth for "the structure survived".

### Docs impact (synced)

- **New docs page `docs/translators`** ("Work with translators", Guides group in `docs-nav.ts` → sidebar + dropdown): the three paths — (1) TMS ingests `locales/*.json` natively, (2) `export`/`import` round-trip (XLIFF for TMS, CSV for spreadsheets), (3) `translate` for machine translation. Shows the export → translator → import cycle with the rejection report; covers `--missing`, `--overwrite`, `--dry-run` and the validation guarantee. +14 keys ×3 catalogs (`docs_translators.*`).
- **`docs/cli`**: two new rows in the Commands table (`verbaly export`, `verbaly import`) + "Translators & TMS" section linking the new page. +4 keys ×3 catalogs.
- `/changelog` (`releases.ts`): 0.15.0 entry — export/import round-trip, structure-validated imports, shorter release notes.
- Bumped web to `verbaly@^0.15.0` + `@verbaly/compiler@^0.15.0` — **`pnpm install` only after the npm publish**.
- **Fix found during sync** (pre-existing, `docs_server.p_html`): a literal `<a href>` inside a catalog rich message renders as escaped text in es/pt — hrefs never come from messages by design. Rewrote it (and the two new link-bearing messages) to the named-link pattern: `<cli>…</cli>` in the message + `data-verbaly-links` on the element — first real dogfood of 0.11's rich links. Verified live (es runtime) and in the pre-rendered `dist/es` mirror (render == runtime holds).
- No changes to existing examples/presets (runtime API untouched).

---

## [0.14.5] — 2026-07-10

**Revision of 0.14.0 — the review release.** A hard audit of what 0.14.0 shipped found three real defects, all fixed here: the devtools overlay froze the page (its own MutationObserver re-triggered on its own panel writes — infinite microtask loop), `''` catalog entries were treated inconsistently across the toolchain (the runtime rendered them as blank holes while extract/check/render call them untranslated — and render's `''` handling silently did nothing for nested catalogs), and the new hreflang alternates were being voided by cross-locale canonicals (mirrored pages kept the source page's `<link rel="canonical">`, which search engines prefer over hreflang). Ready to publish. **One behavior change** (`''` now falls back — see Changed), no API removals, no new dependencies.

### Fixed

- **Devtools freeze** (`verbaly/devtools`): `attachDevtools`'s MutationObserver re-fired on its own `panel.innerHTML`/tooltip writes — in a real browser the microtask queue never drained and the tab hung the moment the overlay mounted. The observer now ignores mutations originating inside its own panel/tip. Regression test drains the observer microtasks and asserts the scan count settles (the 0.14.0 tests were synchronous and couldn't see the loop).
- **`renderHtml` `''` handling with nested catalogs** (`@verbaly/compiler`): the "`''` counts as untranslated → fall back" cleanup iterated only top-level entries, so with nested catalogs (verbaly-web's shape) it silently kept `''` and the static output diverged from the runtime. The cleanup is deleted — the core lookup now implements the semantics (see Changed), nested or flat, and **render output == post-hydration output** is guaranteed again. `RenderHtmlOptions.catalogs` is officially widened to accept nested trees (`Catalogs | Record<string, MessageTree>`).
- **Cross-locale canonical voided hreflang** (`@verbaly/compiler`): mirrored locale pages carried the source page's `<link rel="canonical">` (and `og:url`) — a canonical pointing at another locale tells search engines to fold the page into it, neutralizing the hreflang set 0.14.0 introduced. `renderHtml` now rewrites `rel="canonical"` hrefs and `og:url` content to the locale's own URL when they match the source URL (alternates present). A canonical deliberately pointing elsewhere is left untouched; source-locale pass and re-runs are no-ops (idempotent).

### Changed

- **`''` = untranslated, now everywhere** (`verbaly` core — behavior change, call it out): the lookup chain skips empty-string entries and keeps falling back (`es: ''` → `en` source text; `''` in every locale of the chain → miss: warn + key). **Why:** `extract` scaffolds new keys as `''` and `check` counts `''` as missing — the runtime was the one place that treated `''` as a valid message and rendered a blank hole in the UI. Standard i18n behavior (source text beats invisible content) and the render/runtime FOUC divergence disappears. **If you relied on `''` to intentionally render nothing**, use a single space `' '` or restructure the key (verbaly-web does exactly this — see Docs impact). `has()`/`inspect()` follow the same rule.
- **`packages/core/src/types.ts` is a text file again** (internal, no API change): the type-level message parser used two raw NUL bytes as its escape sentinel, which made git treat the file as **binary** since the initial commit (no reviewable diffs — how the audit had to find this the hard way). The raw bytes are now the `\u0000` escape sequence — identical type semantics, verified by typecheck + the full suite.

### Notes

- 359 tests (core **146** · compiler **144** · svelte 22 · vue 12 · react 11 · unplugin 9 · vite 15) — was 353; +3 core (`''` fallback ×2, devtools loop regression), +3 compiler (nested `''`, canonical/og:url rewrite ×2).
- Bench re-run (ritual): lookup **31.2×**, interpolation **10.6×**, plural **4.3×**, currency **4.5×** vs i18next 26 — in family with 0.14.0 (27.9×/11.0×/5.0×/5.1×; machine variance). The `''` check (`if (msg)` vs `!== undefined`) costs nothing on the hot path.
- Bundle check: tree-shaken `createVerbaly` runtime **3.28 KB** min+gzip (flat), full core surface **4.61 KB** (was 4.63), `verbaly/devtools` **1.62 KB** (was 1.58 — the observer guard).
- publint **All good** ×7 + arethetypeswrong core/react/vue node16 CJS/ESM 🟢 (known-OK: `verbaly/devtools` node10 view, predates subpath exports). Tarballs verified (core ships `dist/devtools.*`; `@verbaly/vite` `workspace:*` → `0.14.5`, peer `verbaly` → `^0.14.5`).
- API surface: no additions, no removals. `RenderHtmlOptions.catalogs` type widened (accepts what already worked at runtime). No new dependencies.

### Docs impact (synced)

- **verbaly-web catalogs**: `hero.claim_line1_end` is `''` in es/pt (intentional empty tail) — under the new `''` semantics it would fall back to the English `"text."`. Use the documented escape hatch: `claim_line1_end` becomes `' '` (single space) in es/pt — pixel-identical (the `.w` spans carry `margin-left`, so moving the period over would add a visible gap). Verify the hero visually in all three locales.
- **Rebuild the site** (`pnpm build`): the mirrored `dist/es|pt` pages should now carry per-locale `<link rel="canonical">` + `og:url` (was: the en URL — spot-check one page per locale).
- `docs/api` (createVerbaly options / messages row or the `onMissing` row): one line noting `''` entries count as untranslated and fall back (matches `check`).
- `docs/cli` (Static rendering): one line — render rewrites `canonical`/`og:url` per locale when `render.baseUrl` is set.
- `/changelog` (`releases.ts`): 0.14.5 entry — devtools freeze fix, `''` unified, canonical rewrite.
- No new pages, no nav changes. Bump web to `verbaly@^0.14.5` — **`pnpm install` only after the npm publish**.

---

## [0.14.0] — 2026-07-10

**Ships translated, and now you can see why.** Three fronts, one theme — closing dead points on the road to 1.0: the SSG renderer grows real multi-locale SEO (hreflang alternates + i18n sitemap + stale cleanup) and is **dogfooded into verbaly-web's own build** (the FOUC is dead for real, measured on the live site); the runtime gains **observability** — an `onResolve` hook and an opt-in `verbaly/devtools` inspector that answers "what key is this text?" in the browser; and **server-side use in Node** is hardened and locked with tests. Ready to publish. One behavior change (locale auto-detection now requires a DOM — see Changed), no API removals.

### Added

- **hreflang + i18n SEO in `verbaly render`** (`@verbaly/compiler`): `renderSite` now emits reciprocal `<link rel="alternate" hreflang>` (incl. `x-default`) into every page's `<head>` for the whole locale set, and optionally a locale-aware sitemap (`sitemap-i18n.xml`, one `<url>` per locale with `<xhtml:link>` alternates). URLs derive from the built path (directory-style: `index.html` → `/`). New config `render.{baseUrl, hreflang, sitemap, clean, site, attribute}` and matching `RenderSiteOptions`; `hreflang` defaults on when `baseUrl` is set. Injection is **idempotent** (marker-delimited, re-runs are byte-stable). New exported type `Alternate`.
- **Stale cleanup** (`@verbaly/compiler`): `render --clean` (or `render.clean`) removes existing `dist/<locale>/` dirs before mirroring, so pages deleted from the source no longer linger in locale mirrors.
- **Wider `render` CLI**: `--attribute`, `--base-url`, `--sitemap`, `--clean` (previously only `--site`/`--locales`; `attribute`/`baseUrl` were programmatic-only).
- **Runtime observability — `onResolve` hook** (`verbaly` core): `createVerbaly({ onResolve })` fires once per `t(key)` call with `{ key, locale, value, status, from? }` where `status` is `'hit' | 'fallback' | 'miss'` and `from` is the locale that actually provided the message. Zero cost when unset (optional-chained; the hot path is unchanged — bench flat). New exported types `ResolveInfo`, `ResolveStatus`.
- **`instance.inspect(key)`** (`verbaly` core): returns `{ locale, source }` (the resolved locale + raw source message) for a key, or `undefined` if missing — the read-side primitive devtools uses without going through `t()`.
- **`verbaly/devtools` — opt-in in-browser inspector** (new **subpath export**, core's first): `attachDevtools(instance, { root?, attribute?, hotkey?, catalogDir? })` mounts a vanilla-DOM overlay — a floating panel with ok/fallback/missing counts and a **missing-keys list that names the exact catalog file to fix** (doctor's actionable-errors ethos, now at runtime), plus hold-`Alt`+hover to see any bound element's key, resolve status, source-locale and text. Zero deps, `sideEffects: false`, **tree-shaken out of the core runtime** — a separate 1.58 KB gzip chunk paid only when imported. Exported type `DevtoolsOptions`.

### Changed

- **Locale auto-detection now requires a DOM** (`verbaly` core — behavior change, call it out): `detectLocale` (used by `createVerbaly` with no `locale`) and `resolveLocale`'s navigator step now gate on `typeof document !== 'undefined'`, not just `navigator`. **Why:** Node 21+ exposes a global `navigator` whose `language` is the *server's* OS locale — under the old guard, `createVerbaly()` on the server silently adopted the machine's locale (a real SSR footgun found while hardening server-side use). Now non-DOM contexts (Node/SSR) deterministically fall back to `'en'` / the configured `fallback`; **browsers are unaffected** (both globals present). Server code should pass `locale` explicitly per request (documented in the new server-side guide).
- **Comparison table re-sealed** (pillar 5, 2026-07-10): competitor versions re-verified — i18next 26.3.6, react-i18next 17.0.9, Lingui 6.5.0, typesafe-i18n 5.27.1 (still one release since 2023 — sporadic), Paraglide 2.21.0, next-intl 4.13.1. No figures changed since 0.13.0's seal (one day prior).

### Notes

- 353 tests (core **143** · compiler **141** · svelte 22 · vue 12 · react 11 · unplugin 9 · vite 15) — was 335; +8 core (observability + devtools + server-side), +5 compiler (hreflang/sitemap/clean).
- Bench re-run (ritual): lookup **27.9×**, interpolation **11.0×**, plural **5.0×**, currency **5.1×** vs i18next 26 — flat vs 0.13.0 (the `onResolve` guard adds nothing to the hot path when unset).
- Bundle check: tree-shaken `createVerbaly` runtime **3.28 KB** min+gzip (was 3.26), full core surface **4.63 KB** (flat), `verbaly/devtools` **1.58 KB** as its own chunk (not in the runtime path).
- publint **All good** ×7 + arethetypeswrong **no problems** (core/react/vue node16 CJS/ESM 🟢). Known-OK: `verbaly/devtools` fails attw's node10 view — node10 predates subpath exports (same category as `@verbaly/svelte/Trans.svelte`); it resolves 🟢 under node16/bundler. Tarballs verified (core ships `dist/devtools.*`; `@verbaly/vite` `workspace:*` → `0.14.0`, peer `verbaly` → `^0.14.0`).
- New public API — core: `VerbalyOptions.onResolve`, `ResolveInfo`, `ResolveStatus`, `Verbaly.inspect`; subpath `verbaly/devtools`: `attachDevtools`, `DevtoolsOptions`. compiler: `RenderConfig.{site,attribute,baseUrl,hreflang,sitemap,clean}`, `RenderSiteOptions.{baseUrl,hreflang,sitemap,clean}`, `Alternate`. All additive. No new dependencies anywhere.
- **Dogfood (dead point #3, closed):** `verbaly render` run against verbaly-web's real `dist` — 12 pages × 3 locales, **zero missing keys**, `dist/es/…`/`dist/pt/…` ship pre-translated with `<html lang>`, reciprocal hreflang and a 36-URL `sitemap-i18n.xml`; `data-verbaly` attributes remain so client switching still works; re-run idempotent. This is what the web build wires in post-publish (Docs impact).

### Docs impact (synced)

- **New page `docs/server`** — "Server-side & SSR (Node)": create a request-scoped `createVerbaly({ locale })` (always pass `locale` — auto-detection is browser-only now), `t()`/`renderHtml` without a DOM, what works today vs. what doesn't (SSR **hydration** / meta-framework integrations remain dead point #1 — say so). Add to Guides nav (`docs-nav.ts` → sidebar + dropdown).
- **New "Observability / Devtools" section** (in `docs/dom` or a new `docs/devtools`): `onResolve` hook (`ResolveInfo`, statuses), `instance.inspect`, and `verbaly/devtools` `attachDevtools` (options, hotkey, missing-panel, import from the subpath). Note it's dev-only and tree-shaken.
- `docs/cli` (Static rendering section): document the SEO flags — `--base-url` (enables hreflang), `--sitemap`, `--clean`, `--attribute` — and the `render.{baseUrl,hreflang,sitemap,clean,site,attribute}` config keys.
- `docs/api`: rows for `onResolve`/`ResolveInfo`/`inspect` and the `verbaly/devtools` export; note the DOM-gated detection change under `resolveLocale`.
- `/changelog` (`releases.ts`): 0.14.0 entry — render SEO + devtools + server-side as the three highlights.
- Landing: the site now **ships translated** (render dogfooded into the build) — optional comparison-table row "in-browser devtools / observability" (no competitor has it) and an SEO/hreflang mention.
- **Build wiring (the dogfood):** verbaly-web `build` = `astro build && verbaly render` with a `verbaly.config` (`dir: src/i18n/locale`, `sourceLocale: en`, `locales: [en,es,pt]`, `render.baseUrl`, `render.sitemap: true`); reference `sitemap-i18n.xml` from `robots.txt`. Bump web to `verbaly@^0.14.0` — **`pnpm install` only after the npm publish**.

---

## [0.13.1] — 2026-07-10

**README refresh: readable on npm dark mode.** Docs-only patch — the seven package READMEs get dark-safe code blocks and a friendlier pass; MIT license re-affirmed after evaluating protective options. No code changes (git diff vs 0.13.0: markdown only). First release published through the automatic `Release` workflow (npm provenance).

### Changed

- **Dark-safe code blocks** (all 7 package READMEs): npmjs's dark theme paints syntax-highlight string tokens in light-theme colors — template literals and quoted strings were near-invisible (Aron's report, screenshot-confirmed). Fix: language hints stripped from every code fence in npm-facing READMEs, so npm renders plain readable text in both themes. The repo root README keeps ` ```ts ` fences (GitHub themes tokens correctly).
- **Friendlier READMEs** (all 7 + root): emoji section headers (🚀 install, ✨ rich text, 🧰 CLI…), core gets a "Try it in 30 seconds" framing, the ecosystem table gains the missing `@verbaly/unplugin` row, and a "Coming from i18next?" link to the new migration guide. Bench range corrected to the 0.13.0 numbers (5–35×).
- **Static gzip badge** (core + root README): the bundlephobia badge showed "rate limited by upstream service" on npm — replaced with a static shields badge (`gzip ~3KB`, re-verified against the measured 3.26KB each release).

### Notes

- **License decision (Aron, 2026-07-10): MIT re-affirmed.** Protective options evaluated and rejected: copyleft (GPL/AGPL) would contaminate consumers' bundles and kill adoption (the product route); source-available (BUSL/FSL) breaks the OSS trust the comparison table sells. MIT's attribution requirement, npm name ownership, provenance and iteration speed are the real protection. Already-published MIT versions are irrevocable either way. Recorded in PLAN → Decisiones.
- No `packages/*/src` changes — 0.13.0 test counts (335), bench (34.7×/16.5×/5.2×/5.5×) and sizes (3.26KB/4.63KB) stand. Suite re-run green on the bump; publint All good (core); core tarball inspected (new README ships).

### Docs impact (none)

- Web docs unaffected — READMEs live in the npm tarballs. Optional: none.
- Bump web to `verbaly@^0.13.1` + `pnpm install` post-publish (lockfile alignment only).

---

## [0.13.0] — 2026-07-09

**`verbaly doctor` + adoption & trust.** Setup diagnostics with the exact fix per finding, the i18next migration guide on the docs site, a coverage push (274→335 tests), and releases now publish from GitHub Actions with **npm provenance** (OIDC). Ready to publish. No breaking changes; runtime packages untouched in behavior.

### Added

- **`verbaly doctor`** (`@verbaly/compiler` CLI): diagnoses the whole setup in one command — config file found, catalogs dir + every locale file (present, valid JSON, flat key→string), bundler plugin wiring (`detectBundler` + `@verbaly/vite`/`@verbaly/unplugin` in deps), `verbaly.d.ts` freshness (regenerates and byte-compares), orphan keys (in catalog, not referenced) and translation completeness (reuses `check`). Every warn/error carries the **exact fix command** (pillar 3: actionable errors); `ok`/`warn`/`error` levels, exit 1 only on errors. Exported API: `doctor(cfg)`, types `DoctorEntry`/`DoctorResult`; also new `findConfigFile(root)` (config, dedupes the search list `init` used).
- **Automatic release workflow with npm provenance** (repo): `.github/workflows/release.yml` triggers on every push to develop — a `packages/core` version with no `vX.Y.Z` tag yet runs the full suite, publishes all 7 with `pnpm -r publish --provenance` via OIDC (registry attestations — Socket supply-chain score lever) and creates the tag + GitHub Release from the changelog entry (up to Notes). No bump = no-op; `workflow_dispatch` = resumable re-run (skips publish if the version is already on npm). Requires one-time Trusted Publisher setup per package on npmjs.com. Local `pnpm release` stays as fallback (no provenance). *(0.13.0 itself shipped via the fallback — provenance starts with the next version published through the workflow.)*
- **`codecov.yml`** (repo): project target 90% (threshold 1%), patch informational — stable badge.

### Changed

- **Coverage push** (all packages): claude translate provider 31→~100% (mocked SDK; `loadSdk` gained an injectable loader seam — internal, not re-exported), `@verbaly/vite` 57→~98% (fake dev server: watcher events, HMR invalidation, self-write dedupe, unlink), plus branch-edge tests in core (parse/ICU/format/locale/instance), compiler (registry/extract/catalog/check) and adapters (react provider-throw, svelte context hooks via new test fixtures, unplugin id branches). Project: 81.9%→~91% branches, 91%→~98% lines.
- **Comparison table re-sealed** (pillar 5, README + web landing): i18next 26.3.6 core is **~13.5KB gzip** (+9.4KB react-i18next) — the old "~25KB" overstated the core; typesafe-i18n is "sporadic maintenance" (one release in 2½ years: 2023-08 → 2026-02), not "unmaintained"; Lingui 6.5 / Paraglide 2.21 / next-intl 4.13 verified active.
- Drift fixes: root README (tsup→tsdown, test count), `verbaly-package-dev` skill (per-version changelog files → single `CHANGELOG.md`).

### Notes

- 335 tests (core 130 · **compiler 136** · svelte 22 · vue 12 · react 11 · unplugin 9 · vite 15) — was 274; +50 coverage push, +11 `doctor`.
- Bench re-run (ritual): lookup **34.7×**, interpolation **16.5×**, plural **5.2×**, currency **5.5×** vs i18next 26 — no regression.
- Bundle check: tree-shaken `createVerbaly` runtime **3.26KB** min+gzip, full core surface 4.63KB — flat vs 0.12.0 (runtime untouched).
- publint **All good** ×7 + arethetypeswrong **no problems** (core/react/vue, node16 CJS/ESM 🟢); tarballs verified (compiler + core: `workspace:*` → `0.13.0`, only `dist/` + `LICENSE` + README).
- New public API — compiler: `doctor`, `DoctorEntry`, `DoctorResult`, `findConfigFile`. All additive. No new dependencies.
- E2E verified: `verbaly doctor` exercised against a broken scratch project (missing plugin, stale types, orphan, unknown key, missing translations → exit 1 with fixes) and a healthy one (all ✓, exit 0).

### Docs impact (synced)

- `docs/cli`: **`verbaly doctor`** row in Commands (after `init`) + new "Health check" section (sample output, checks list, exit codes); `<Docs>` description updated.
- **New page `docs/migrate`** — "Migrate from i18next": mapping table (init/t/interpolation/plurals/formatting/detector/backend/hooks/Trans/changeLanguage/gate), catalog port (flatten + merge plural suffixes, before/after JSON), runtime swap (react-i18next → @verbaly/react before/after), locale bootstrap, incremental strategy, structural-validation callout. Nav: new "Migrate from i18next" item in Guides (docs-nav.ts → sidebar + dropdown). +26 keys per catalog (en/es/pt): `docs_migrate.*`, `docs_nav.migrate`, `docs_cli.{td_doctor,h_doctor,p_doctor,p_doctor_checks}`.
- Landing compare table (`table.ts`): i18next size cell → "~14 KB (+9 KB react)".
- `/changelog` (`releases.ts`): 0.13.0 entry — doctor + migration guide + provenance/coverage as highlights.
- `docs/api`: no changes (doctor is CLI/compiler surface; the low-level API table doesn't list compiler internals).
- Bump web to `verbaly@^0.13.0` — **`pnpm install` only after the npm publish** (pnpm deps-check fails until 0.13.0 exists). Site verified against 0.12.0 installed: astro check 0 errors, build 11 pages (was 10), eslint clean (2 pre-existing `.astro` TS-generics parse errors fixed in passing: VDropdown, index).

---

## [0.12.0] — 2026-07-09

**`verbaly init` + the TypeScript 7 toolchain.** One command scaffolds a working setup (config, catalogs, bundler detection) — the zero-config pillar now starts at minute zero. Under the hood the whole monorepo moved to **tsdown** (rolldown) and **TypeScript 7** (native compiler, GA 2026-07-08): typecheck of all 7 packages runs in ~3s. Ready to publish. No breaking changes; published `dist/` layout, exports and sizes are identical.

### Added

- **`verbaly init`** (`@verbaly/compiler` CLI): scaffolds a project in one command. Writes `verbaly.config.ts` (`satisfies VerbalyConfig`) when a `tsconfig.json` exists, else `verbaly.config.mjs` (JSDoc-typed); creates `locales/<sourceLocale>.json` plus one `{}` catalog per `--locales` entry; **detects the bundler** from package.json (`vite` → suggests `@verbaly/vite`; webpack/rollup/rspack/esbuild → `@verbaly/unplugin`; none → CLI flow) and prints numbered next steps. **Never overwrites**: an existing config or catalog is reported as "kept (already there)" and left byte-identical. Honors `--root`, `--dir`, `--source`, `--locales`; source locale deduped from `--locales`. Exported API: `init(options)`, `detectBundler(root)`, types `InitOptions`/`InitResult`.

### Changed

- **Build tool: tsup → tsdown** (all 7 packages). tsup has been unpublished-stale since Nov 2025 and its dts step injected `baseUrl` (removed in TS 7). tsdown (rolldown) builds the same ESM+CJS+dts matrix; `fixedExtension: false` keeps the published filenames (`index.js`/`index.cjs`/`.d.ts`/`.d.cts`) byte-compatible with every `exports` map — no consumer-visible change. CLI shebang preserved; the lazy Claude provider now code-splits into its own chunk (ESM dynamic import, same behavior).
- **TypeScript 7** (repo toolchain): `tsc` is now the native Go compiler (`@typescript/native` = `typescript@^7.0.2` alias) — typecheck of the whole monorepo dropped to **~3s**. The `typescript` package name resolves to **`@typescript/typescript6`** (bin `tsc6`) — Microsoft's official side-by-side package — because typescript-eslint (peer `<6.1.0`) and tsdown's dts emit still need the JS compiler API (stable native API lands in TS 7.1). Collapse tracked in PLAN → Deuda técnica.
- **`ignoreDeprecations: "6.0"` removed** from `tsconfig.base.json` — it only existed to silence the `baseUrl` that tsup's dts injected; tsdown doesn't. Debt closed.
- Patch bumps: vitest 4.1.10, typescript-eslint 8.63.0, i18next 26.3.5 (bench devDep). New root devDeps: `tsdown`, `unrun` (tsdown's TS-config loader).

### Notes

- 274 tests (core 105 · **compiler 112** · svelte 20 · vue 12 · react 10 · unplugin 8 · vite 7) — was 266; +8 for `init`.
- Bench re-run (ritual, on the rolldown-built dist): lookup **33.5×**, interpolation **9.7×**, plural **4.0×**, currency **5.8×** vs i18next 26 — no regression from the bundler swap.
- Bundle check: tree-shaken `createVerbaly` runtime **3.24KB** min+gzip, full core surface 4.61KB — both at or under the 0.11.0 numbers.
- publint **All good** + arethetypeswrong **no problems** (node16 CJS/ESM 🟢) on all packages; tarballs verified (`workspace:*` → `0.12.0`, only `dist/` + `LICENSE` + README).
- New public API — compiler: `init`, `detectBundler`, `InitOptions`, `InitResult`. All additive. Runtime packages untouched in behavior.
- CI unchanged (script-driven); lockfile carries the TS7 native binaries per platform.

### Docs impact (synced)

- `docs/start` (Quickstart): lead with `npx verbaly init` as step 1 — it replaces the "create config + locales by hand" prose. Show the generated `verbaly.config.ts` and the bundler-detection next steps.
- `docs/cli`: new **`verbaly init`** row in Commands + short section (flags `--dir`/`--source`/`--locales`, TS vs mjs config choice, never-overwrites guarantee, bundler detection table vite→@verbaly/vite / others→@verbaly/unplugin).
- `docs/api` (compiler section): rows for `init`/`detectBundler` if the low-level API table lists compiler exports.
- `/changelog` (`releases.ts`): 0.12.0 entry — init + tsdown/TS7 toolchain as the two highlights.
- Landing: no copy changes required (zero-config claim just got truer; optional: quickstart snippet could show `verbaly init`).
- Bump web to `verbaly@^0.12.0` post-publish (`pnpm install`). No runtime API changes — site code needs no migration.

---

## [0.11.0] — 2026-07-08

**Rich links + the full modern `Intl` surface.** Named links (`<a>`) land across the whole rich-text pipeline — DOM interpreter, `<Trans>` in React/Vue/Svelte and the SSG renderer — with hrefs always provided by the caller, never by messages. The message format gains relative time, lists and units (still zero dependencies). License switched to **MIT**. Ready to publish. No breaking changes.

### Added

- **Named rich links** (`verbaly` core): `bindDom(v, { richLinks })` + per-element `data-verbaly-links` (JSON, merges over the global map). A message like `'Read the <docs>guide</docs>'` renders a real `<a>` when `docs` is in the map — `string` shorthand or `{ href, target, rel }`. Security model unchanged: hrefs/attributes come from the **caller** (code, config or your own markup), never from messages; `javascript:`/`data:`/`vbscript:` schemes are blocked by the new exported `safeHref` (warn + href omitted). Link names win over the phrasing whitelist; unknown names still unwrap to inert text. Exported: `RichLink` type, `safeHref`.
- **`links` prop on `<Trans>`** (`@verbaly/react`, `@verbaly/vue`, `@verbaly/svelte`): same map, renders `<a href target rel>` without hand-writing components/render functions. In React/Vue an entry in `components` wins over `links` for the same tag name. Svelte's `<Trans>` gets its first link story (it has no `components` map by design).
- **Links in the SSG renderer** (`@verbaly/compiler`): `renderHtml`/`renderSite` accept `richLinks`; the CLI reads the new config section `render.links` (`verbaly.config.*`); per-element `data-verbaly-links` in the built HTML merges over it. Href/target/rel are attribute-escaped. New exported type `RenderConfig`.
- **Relative time** (`verbaly` core): `{when:relative}` with a `Date` auto-picks the unit vs now (`Intl.RelativeTimeFormat`, `numeric: 'auto'` → "yesterday"/"ayer"); `{n:relative/day}` formats a number in an explicit unit. Invalid units warn once and fall back to `String(value)`.
- **Lists** (`verbaly` core): `{xs:list}` → localized conjunction ("a, b y c"), `{xs:list/or}` → disjunction, `{xs:list/unit}` → unit type (`Intl.ListFormat`); items are auto-formatted per locale. Non-arrays fall back to `String(value)`.
- **Units** (`verbaly` core): `{n:unit/kilometer}` → `Intl.NumberFormat` `style: 'unit'` ("3 km"). Invalid units warn once and fall back.

### Changed

- **License: Apache-2.0 → MIT** (repo + all 7 packages: `LICENSE` files, `license` fields, READMEs; `NOTICE` removed). Versions ≤0.10.0 on npm remain Apache-2.0; MIT applies from this release.
- **Hardening** (`verbaly` core): all `Intl` formatter caches (number/date/plural + new relative/list) now share a **200-entry FIFO cap** — dynamic locales/options can't grow memory unbounded (same reasoning as the 0.5.0 AST-cache cap). Unknown formats (`{v:frobnicate}`) and invalid units now **warn once** instead of failing silently to `String(value)`.
- **README (repo)**: Socket supply-chain badge replaces the static dependencies badge (version-pinned — bump on each release, noted in the release skill); `Intl` bullet + named-links bullet; bench range updated.

### Notes

- 266 tests (core 105 · compiler 104 · svelte 20 · vue 12 · react 10 · unplugin 8 · vite 7) — was 238.
- Bench re-run (ritual): lookup **43.6×**, interpolation **9.8×**, plural **4.0×**, currency **6.8×** vs i18next 26.
- Bundle: full core surface 4.67KB min+gzip (was 3.97KB — links + 2 new `Intl` wrappers); tree-shaken `createVerbaly`-only runtime stays at **3.24KB**. `sideEffects: false` means non-DOM users don't pay for `bindDom`/links.
- New public API — core: `RichLink`, `safeHref`, `BindDomOptions.richLinks`, formats `relative`/`list`/`unit`; react/vue/svelte: `TransProps.links`; compiler: `RenderHtmlOptions.richLinks`, `RenderSiteOptions.richLinks`, `RenderConfig` (`render.links` in config). All additive.
- No new dependencies anywhere.

### Docs impact (synced)

- `docs/format`: new **"Relative time, lists & units"** section — `{when:relative}` (Date auto-unit + `relative/day`), `{xs:list}`/`list/or`/`list/unit`, `{n:unit/kilometer}`; fallback + warn-once behavior.
- `docs/dom`: **"Named links"** section — `richLinks` option, `data-verbaly-links` attribute, merge order, `safeHref` blocking, "hrefs never come from messages" security note.
- `docs/frameworks`: `links` prop on the three `<Trans>` sections (React/Vue/Svelte); note that `components` wins over `links` in React/Vue.
- `docs/cli` (Static rendering section): `render.links` config + per-element merge.
- `docs/api`: rows for `richLinks`, `RichLink`, `safeHref`; format table gains relative/list/unit.
- Playground: optional new preset "Relative time" or "Lists" (nice demo material — `{xs:list}` with the site's own locales).
- Landing: footer/license mentions — verify nothing says Apache; comparison table could add an "Intl relative/list/unit built-in" row.
- `/changelog`: 0.11.0 entry. Bump web to `verbaly@^0.11.0` post-publish (`pnpm install`).
- **Dogfooding candidates**: verbaly-web's footer "Built with…" prose or nav could use `richLinks` instead of slot keys where links appear mid-sentence.

---

## [0.10.0] — 2026-07-07

**Static sites ship translated + Verbaly beyond Vite.** `verbaly render` pre-fills built HTML per locale (the SSG FOUC fix, flagship), new `@verbaly/unplugin` package brings the compiler to webpack/Rollup/esbuild/Rspack, `<Trans>` lands in Svelte, and `verbaly pseudo` adds i18n QA. Ready to publish. No breaking changes; core runtime untouched in behavior (~3KB intact).

### Added

- **SSG per-locale output — `verbaly render`** (`@verbaly/compiler` CLI): walks the built site (`--site <path>`, default `dist`) and pre-fills every `data-verbaly` element **per locale** with the real runtime (`createVerbaly` per locale — plurals, `Intl` formatting, `data-verbaly-args`, attribute translation via `data-verbaly-attr` with the `on*` block, `data-verbaly-rich` with the same phrasing whitelist). Source locale is filled in place; every other locale is mirrored to `dist/<locale>/…` with `<html lang>` set. Static HTML ships already translated — **no flash of untranslated content** — and the runtime attributes stay, so client-side switching keeps working. Exported API: `renderHtml(html, opts)` / `renderSite(cfg, opts)` (+ option/result types). Safety: message text is HTML-escaped (no injection), `""` entries fall back to source, missing keys are reported and left untouched, comments/`<script>`/`<style>` bodies are opaque to the scanner, nested same-name elements handled. Idempotent — re-runs exclude locale subdirs. Zero new deps (magic-string + tinyglobby already there).
- **New package `@verbaly/unplugin`**: the compiler wrapped with [unplugin](https://github.com/unjs/unplugin) — same `virtual:verbaly` module, tagged-template transform and **missing-translation build gate** (`failOnMissing: false` opts out) on **webpack 5, Rollup, esbuild and Rspack**. Build-focused: run `verbaly extract` in the dev loop/CI; live extraction + HMR remain `@verbaly/vite`'s value. ESM-only (like compiler/vite — use `webpack.config.mjs`). Deps: `unplugin ^3.3.0`, `@verbaly/compiler`; peer `verbaly`.
- **`<Trans>` for Svelte** (`@verbaly/svelte`): raw `.svelte` components shipped in `dist` under the subpath `@verbaly/svelte/Trans.svelte` (`svelte` export condition + hand-written `.d.ts` — no svelte-package), legacy syntax compatible with Svelte 4 **and** 5. Renders message tags as real elements via `<svelte:element>` against the **same whitelist as `data-verbaly-rich`** (unknown tags unwrap to inert text; `richTags` prop overrides; `instance` prop or `provideVerbaly` context; `values` for params; re-renders on locale change, unsubscribes on unmount). No `components` map in v1 — passing components across Svelte 4/5 is fragile (roadmap note).
- **Pseudo-localization — `verbaly pseudo`** (`@verbaly/compiler` CLI): regenerates a QA catalog (default `en-XA`, `--locale <id>` to change) from the source locale: accented letters, `⟦…⟧` markers, ~33% `~` padding — exposes hardcoded strings, clipped layouts and concatenation bugs. Params, variant blocks, tags and escape sequences survive verbatim, guaranteed by the same `structureMatches` validation as `translate`. Exported: `pseudoLocalize`, `pseudoCatalogs`, `PSEUDO_LOCALE`.
- **Coverage** (repo): root `pnpm coverage` (vitest projects + `@vitest/coverage-v8`, lcov). CI now runs coverage instead of plain tests and uploads to Codecov; coverage badge in the README. (~90% lines at cut.)

### Changed

- **Packaging: node16-clean dual packages** (`verbaly`, `@verbaly/react`, `@verbaly/vue`): `exports` split into `import`/`require` conditions, each with its own `types` (`.d.cts` for CJS — tsup already emitted it). Fixes publint's "types interpreted as ESM under require" warning and arethetypeswrong's **"Masquerading as ESM"** (node16-from-CJS now 🟢). No runtime change.
- **`verbaly` (core)**: `RICH_TAGS` (the phrasing whitelist behind `data-verbaly-rich`) is now exported — single source of truth reused by the compiler's static renderer. Additive.
- **README (repo)**: "How it compares" table (vs i18next/Lingui/Paraglide/typesafe-i18n), CI + coverage badges, unplugin row, SSG/QA bullets. Core `package.json` keywords expanded (npm SEO).

### Notes

- 238 tests (core 88 · compiler 99 · svelte 18 · vue 10 · react 8 · unplugin 8 · vite 7) — was 197.
- Bench re-run (ritual): lookup **36.2×**, interpolation **16.8×**, plural **5.5×**, currency **5.2×** vs i18next 26.
- publint + arethetypeswrong green on core/react/vue (dual) and compiler/unplugin (ESM-only). `@verbaly/svelte/Trans.svelte` shows attw node10 "resolution failed" — expected: `.svelte` files resolve via bundler (🟢), which is the only way Svelte components are consumed.
- New devDeps: `@vitest/coverage-v8` (root), `@sveltejs/vite-plugin-svelte` + `happy-dom` (svelte tests). Svelte tests need `resolve.conditions: ['browser']` (else Svelte 5 resolves its server build under vitest).
- Codecov: the badge/upload go live once Aron authorizes the repo on codecov.io (GitHub login; tokenless upload works for public repos).
- Seven aligned packages now — `@verbaly/unplugin` joins at 0.10.0.

### Docs impact (synced)

- `docs/cli`: add `pseudo` and `render` command rows + a **"Static rendering (SSG)"** section (per-locale output, `--site`, in-place source fill, `<html lang>`, FOUC fix, idempotency) + a **"Pseudo-localization"** section (`en-XA`, what survives verbatim, `--locale`).
- `docs/frameworks`: **Svelte `<Trans>`** section (import from `@verbaly/svelte/Trans.svelte`, whitelist semantics = `data-verbaly-rich`, `values`/`instance`/`richTags` props, Svelte 4/5). Mirror of the React/Vue `<Trans>` sections.
- `docs/vite` (or a new bundlers note): `@verbaly/unplugin` — webpack/Rollup/esbuild/Rspack usage, `verbaly extract` in the dev loop, `failOnMissing`, "use @verbaly/vite on Vite".
- Landing: add the **"How it compares"** comparison as a landing section (Aron approved 2026-07-07); packages count is now **7**; any "6 packages"/test-count mentions refresh (238).
- `/changelog`: 0.10.0 entry. Bump web to `verbaly@^0.10.0` post-publish (`pnpm install`).
- Post-publish dogfooding (roadmap): wire `verbaly render` into verbaly-web's Astro build to kill its own FOUC.

---

## [0.9.0] — 2026-07-06

**Machine translation closes the loop.** `verbaly translate` fills the `""` holes `check` reports — pluggable provider interface with Claude as the reference implementation. Ready to publish. No breaking changes; no runtime impact (core untouched, ~3KB intact).

### Added

- **`verbaly translate`** (`@verbaly/compiler` CLI): fills missing translations per target locale, batched (default 20 per request, `translate.batchSize` in config). Flags: `--dry-run` (list what would be translated, write nothing), `--locales es,pt` (target filter), `--model` (override for the claude provider). The full flow is now write → `extract` → `translate` → `check` green → build passes.
- **Provider interface, no lock-in**: `translate.provider` in `verbaly.config.{ts,js}` accepts a function `({ sourceLocale, targetLocale, messages }) => Promise<Record<key, translation>>`. Exported: `translateCatalogs`, `structureMatches`, types `TranslateProvider`/`TranslateRequest`/`TranslateOptions`/`TranslateResult`/`TranslateConfig`.
- **Claude reference provider** (`claudeProvider`, also exported): official `@anthropic-ai/sdk` as an **optional peerDependency** (lazy-loaded with an install hint, same pattern as esbuild for TS configs). Default model `claude-sonnet-5` — balanced quality/cost for a translation workload (`translate.model` or `--model` to override), thinking disabled (translation needs no reasoning); **structured outputs** (`output_config.format` with a per-batch JSON schema) guarantee a valid key→translation map. Auth via `ANTHROPIC_API_KEY` (or an `ant auth login` profile — the SDK resolves it).
- **Structural validation post-translation**: params (`{name}`, variant blocks) and tags (`<em>`) must survive verbatim — a translation that renames/drops them is rejected and the entry stays `""`, so `check` keeps reporting it. Rejections are listed in the CLI output.

### Notes

- New deps: `@anthropic-ai/sdk >=0.110.0` (optional peer + devDep `^0.110.0`). Zero impact when unused — the provider module lazy-imports it.
- Catalog writes only touch locales that got translations; source catalog never modified.
- 197 tests (core 88 · compiler 75 · vue 10 · svelte 9 · react 8 · vite 7). Bench re-run: lookup 30.7×, interpolation 12×, plural 4.9×, currency 4.5× vs i18next.

### Docs impact (synced)

- `docs/cli`: `translate` command row + "Machine translation" section (provider config, claude default, `--dry-run`/`--locales`/`--model`, validation contract with `check`).
- `/changelog`: 0.9.0 entry. Bump web to `verbaly@^0.9.0` post-publish (no runtime changes — `pnpm install` only).

---

## [0.8.0] — 2026-07-06

**Readable keys + lazy catalogs.** Opt-in readable message ids (`t.id`, `<Trans id>` extraction) and lazy catalog loading in the core runtime — both born from dogfooding. Ready to publish. No breaking changes.

### Added

- **Readable keys, opt-in** (`@verbaly/compiler` + `verbaly`): hashed keys stay the zero-config default; explicit ids are per-message opt-in. Dotted ids (`inbox.title`) are the namespace convention — catalogs stay flat JSON.
  - `` t.id('inbox.title')`Hello ${name}` `` → extracted under the explicit key, rewritten to `t("inbox.title", { name })` (member receivers preserved: `i18n.t.id(…)` → `i18n.t(…)`). Dynamic ids (`t.id(someVar)`) are left untouched.
  - `<Trans id="inbox.title">Hello {user.name}</Trans>` (id + children, no other props) → extracted under the explicit id with the same write-in-place machinery (values/components, JSX whitespace semantics, safe bails → falls back to used-key). `<Trans id>` without children stays runtime-first, unchanged.
  - Runtime `t.id(key)` returns a template tag that formats the inline source — identical to `` t`…` `` pre-compile, so code runs before extraction.
  - Duplicate explicit ids with different texts surface through the existing key-collision warning.
- **Lazy catalog loaders** (`verbaly` core): `createVerbaly({ loaders: { es: () => import('./locales/es.json') } })`.
  - `loadLocale(locale)` — BCP-47 narrowing (`es-MX` → `es`), in-flight dedupe, unwraps module `default`, idempotent; rejects propagate and retry is possible.
  - `setLocale` auto-loads a pending catalog (fire-and-forget: UI shows fallback, re-renders when the catalog lands; warn-once on load failure). Flash-free switch: `await v.loadLocale('es'); v.setLocale('es')`.
  - `locales` getter now returns loaded ∪ loadable locales — switchers can list languages before any catalog loads.

### Changed

- **Virtual module** (`@verbaly/vite` codegen): per-locale `import()`s now flow through core `loaders`; generated `setLocale` = `await v.loadLocale(l); v.setLocale(l)` (same behavior, less generated code). Generated `verbaly.d.ts` types `t.id`.

### Notes

- New public API: `VerbalyOptions.loaders` (+ exported `LocaleLoader` type), `Verbaly.loadLocale`, `TFunction.id`. `locales` getter behavior extended (loaded ∪ loadable) — additive, not breaking.
- `@verbaly/vite` 0.8.0 requires `verbaly` 0.8.0 (peer `workspace:^` rewrites to `^0.8.0` on publish).
- Dogfooding origin: `verbaly-web` hand-rolled lazy catalogs (`ensure()` + loaded `Set` in `scripts/i18n.ts`) — that pattern is now core, like 0.4.0's rich text.
- 187 tests (core 88 · compiler 65 · vue 10 · svelte 9 · react 8 · vite 7). Bench re-run: lookup 38×, interpolation 10.6×, plural 4.7×, currency 4.9× vs i18next.

### Docs impact (synced)

- `docs/cli`: readable-keys section — `t.id('…')` + dotted-namespace convention, dynamic-id bail.
- `docs/frameworks`: `<Trans>` section gains the explicit-id write-in-place variant (`<Trans id="…">children</Trans>`).
- `docs/api`: `loaders` option, `loadLocale`, `setLocale` auto-load note, `locales` = loaded ∪ loadable, `LocaleLoader` type, `t.id`.
- `docs/dom` (Locale bootstrap): lazy-loaders pattern replaces hand-rolled `ensure()`.
- `/changelog`: 0.8.0 entry. Bump web to `verbaly@^0.8.0` post-publish; optionally migrate `scripts/i18n.ts` + `messages.ts` to core loaders (dogfooding).

---

## [0.7.0] — 2026-07-04

**Svelte joins the ecosystem.** New `@verbaly/svelte` adapter — six packages now, aligned. Published. No breaking changes. (Release-process cleanup shipped alongside: Changesets removed, changelog consolidated into this single file.)

### Added

- **`@verbaly/svelte`** (new package, 9 tests, ESM-only — Svelte 5 dropped CJS; peer `svelte ^4 || ^5`): idiomatic **stores** over the reactive core, `$` auto-subscription just works.
  - `provideVerbaly(instance)` / `useVerbaly()` — context (call in a root component/layout).
  - `useT()` → `Readable<TFunction>` (re-emits on every locale/messages change; function values always invalidate in Svelte, so `{$t('key')}` re-renders).
  - `useLocale()` → `Writable<string>` — `bind:value={$locale}` on a select works out of the box.
  - `tStore(instance)` / `localeStore(instance)` — the same stores **without context**, for app-level singletons (svelte-i18n style).
  - Rich text: no `<Trans>` component in v1 (would require shipping `.svelte` sources / svelte-package tooling — noted for later). The core's `bindDom` + `data-verbaly-rich` path works in any Svelte app and is the documented alternative.

### Changed (repo/process, not shipped code)

- **Changesets removed**: `changeset version` escalated pre-1.0 peer bumps to major (0.3.0 → 1.0.0, observed), its per-package changelogs duplicated this curated one, and its git tags duplicated Aron's manual `vX.Y.Z` GitHub Release. `pnpm release` now = `pnpm build && pnpm -r publish --access public --no-git-checks` (pnpm rewrites `workspace:*` itself; no auto-tags — the manual GitHub Release is the single tag).
- **Changelog consolidated**: per-version `changelog/X.Y.Z.md` files merged into this `CHANGELOG.md` (detailed entry per version; 0.x will archive when 1.0 ships).

### Notes

- 169 tests (core 80 · compiler 55 · react 8 · vue 10 · svelte 9 · vite 7). Bench re-run: 27×/10×/4.7×/5× vs i18next.
- Aligned versioning now spans **6** packages.

### Docs impact (synced)

- `docs/frameworks`: add a Svelte section (provide/use + stores + `bind:value`, factories without context, rich-text-via-bindDom note).
- Landing/README ecosystem tables: add `@verbaly/svelte`.
- `/changelog`: 0.7.0 entry. Bump web to `verbaly@^0.7.0`.

---

## [0.6.0] — 2026-07-04

**The compiler understands your whole codebase.** JSX `<Trans>` extraction + `verbaly.config.ts`. Published (all 5 aligned). No breaking changes.

### Added

- **JSX `<Trans>` extraction, write-in-place** (`@verbaly/compiler`): write the source text inline — `<Trans>Read the <a href="/terms">terms</a>, {name}</Trans>` — and the compiler extracts the message (`Read the <a>terms</a>, {name}`), generates the stable key, syncs catalogs/types and rewrites to `<Trans id="…" values={{ name }} components={{ "a": <a href="/terms" /> }} />`.
  - Child element **attributes preserved** in `components` (self-closed source slice); component tags lowercased (`<Break/>` → `<break/>`); colliding names suffixed (`a`, `a2`).
  - Params named like tagged templates (`{user.name}` → `{name}`, dedupe, positional `_i`).
  - **React-faithful whitespace**: extraction produces exactly what React renders — a line break between an element and text yields no space; the `{' '}` idiom works. Matches Babel's JSX text semantics.
  - **Safe bails** (element untouched): existing props, fragments/spread children, member-expression tags, nested `<Trans>`, tagged templates inside children.
- **`verbaly.config.ts` / `.mts`** via `bundle-require` (lazy-loaded). `esbuild` is an **optional peerDependency** with a clear install hint when missing. Precedence: `js`/`mjs` → `ts`/`mts` → `json`. CLI and Vite plugin inherit it.

### Fixed

- `<Trans id="x">` now counts as a **used key** — before, `check` flagged those catalog entries unknown and `--prune` deleted them.

### Notes

- New compiler exports: `TaggedMessage.jsx?`, `type TransComponent`. New deps: `bundle-require` (dependency), `esbuild >=0.18` (optional peer).
- Vue SFC templates are not JSX — extraction applies to `.jsx/.tsx`; Vue `<Trans>` stays runtime-first.
- 160 tests (core 80 · compiler 55 · react 8 · vue 10 · vite 7). Bench re-run: lookup 33×, interpolation 11×, plural 5.4×, currency 5× vs i18next.

### Docs impact (synced)

- `docs/frameworks`: `<Trans>` section rewritten to the write-in-place flow + JSX whitespace note. `docs/cli`: config list gains `ts`/`mts` + esbuild note. `/changelog`: 0.6.0 entry.

---

## [0.5.0] — 2026-07-04

**Hardening + performance, with receipts.** Defensibility audit of 0.4.0 — every finding fixed — plus published benchmarks. Published. No breaking changes, no new user-facing API.

### Changed

- **Perf (core): fallback chain memoized** — `chain()` (BCP-47 narrowing + fallbacks) was recomputed and re-allocated on *every* `t()` call; now cached, invalidated on `setLocale`. Biggest hot-path win.
- **Perf (core): DOM args cached per element** — `bindDom` re-ran `JSON.parse` on `data-verbaly-args` for every element on every re-render; now a per-binder `WeakMap` with raw-string comparison (attribute edits still re-parse).
- **Robustness (core): AST cache capped** at 2000 entries — dynamic/CMS messages via `addMessages` can no longer grow it unbounded.

### Fixed

- `resolveLocale` narrows a **stored** regional locale (`es-PE` persisted with `supported: ['es']` was silently ignored; now exact→base matching applies to storage and navigator alike).
- `@verbaly/vite`: **stale self-write entries swallowed external catalog edits** — the watcher dedupe skipped reloads without comparing content, so a missed FS event ate the next real user edit until restart. Now checked against disk; `add` events share the path.

### Added

- **`pnpm bench`** in core (Vitest bench; i18next as devDependency, never shipped). Node 22 numbers: plain lookup **31×**, interpolation **9.8×**, plural **5.1×**, currency **4.5×** faster than i18next 26. Release ritual: re-run every version.

### Notes

- Project pillars written down in PLAN → "La innovación" (fast · light · simple-but-robust · modern strategies · competitive watch).
- 143 tests. Adapters audited clean (`useSyncExternalStore`/`onScopeDispose`, unbound `setLocale` safe).

### Docs impact (synced)

- `/changelog`: 0.5.0 entry (the bench numbers are quotable). No docs-page changes — no API changed.

---

## [0.4.0] — 2026-07-04

**The DOM interpreter catches up with the frameworks.** 100% dogfooding release — every feature fixes a real friction found integrating verbaly into its own docs site. Published. No breaking changes.

### Added

- **Rich text in `bindDom`** (core): elements marked `data-verbaly-rich` render tagged messages (`'The build <em>gate</em>'`) as real elements via the shared `parseTags` tokenizer. Safety model: **whitelist of phrasing tags** (em, strong, code, b, i, u, s, small, mark, sub, sup, span, kbd, abbr, br, wbr), elements built programmatically (`createElement` + text nodes — never `innerHTML`), **attributes never come from the message**, non-whitelisted tags unwrap to inert text (`<script>alert(1)</script>` → the text, no element). Whitelist overridable via `bindDom(v, { richTags })`. Opt-in per element — 0.3 behavior untouched.
  - Why: without it, any sentence with inline markup forces "slot keys" — 3 fragmented keys per sentence, translations without context, word order locked by markup.
- **`resolveLocale({ supported, fallback?, storageKey? })` + `persistLocale(locale, storageKey?)`** (core): the bootstrap every app repeats — storage → `navigator.languages` (BCP-47 narrowing) → fallback; persist writes storage and syncs `<html lang>`. SSR-safe, tree-shakeable, default key `verbaly-locale`, `storageKey: false` disables storage.
- **`locales` getter** on the instance — loaded locales (reflects `addMessages`); feeds language switchers from one source of truth.

### Notes

- `<a>` intentionally not whitelisted (useless without `href`; attributes from messages are banned by design). FOUC on static sites stays open (compiler/SSR territory).
- 141 tests (core 57→78). Other packages: version-aligned release only.

### Docs impact (synced)

- `docs/dom`: "Rich text" + "Locale bootstrap" sections. `docs/api`: `locales` + helpers. `/changelog`: 0.4.0 entry. The site itself migrated (slot keys → rich messages, hand-written detection → helpers, `VLocale` fed from `locales`).

---

## [0.3.0] — 2026-07-03

**ICU escape-hatch + robustness.** Opt-in ICU MessageFormat (zero-dep) plus fixes from a full codebase analysis. Published. No breaking changes.

### Added

- **ICU escape-hatch** (core): a message with an ICU argument (`{count, plural, one {#} other {#}}`, `select`, `selectordinal`, `{n, number/date/time, style}`) is auto-detected and parsed into the **same `MessageNode` AST** as the native format — the formatter is unchanged. Recursive-descent parser in `icu.ts`, zero dependencies. Supports `#`, `=N` exact, nesting, ICU `'…'` apostrophe quoting; `selectordinal` uses real ordinal plural rules.
- **`parseTags` + `TagNode`** core exports — the named-tag tokenizer behind `<Trans>`, shared and hardened (unclosed tags keep inner content; stray closes render literal).

### Changed

- `@verbaly/react` + `@verbaly/vue` `<Trans>` now share the core tokenizer — deduped ~30 lines, malformed input hardened in one place. Behavior unchanged for well-formed messages.

### Fixed

- **Key-collision detection** (`@verbaly/compiler`): two different source texts hashing to the same key now **warn at build time** instead of silently dropping one.
- `@verbaly/vite`: `MessageRegistry.remove` wired to the watcher's `unlink` — deleting a source file no longer leaves ghost keys until restart. Dev `vite` bumped to 8.1.3.

### Notes

- ICU is opt-in by syntax — no new call-site API. 120 tests (core 57).

### Docs impact (synced)

- `docs/format`: "ICU escape-hatch" section. `/changelog`: 0.3.0 entry. `<Trans>` docs unchanged.

---

## [0.2.0] — 2026-07-03

**Ecosystem goes public + rich text.** First npm publish of compiler, Vite plugin and adapters; `<Trans>` for rich text in React/Vue. Published — **aligned versioning starts here: all 5 packages ship the same number.**

### Added

- **`<Trans>`** in `@verbaly/react` (8 tests) and `@verbaly/vue` (10 tests): interpolate elements/links inside a translated sentence with named tags (`Read the <terms>terms</terms>`). React: `components` as `Record<string, ReactElement>` via `cloneElement`; Vue: render functions (idiomatic). Nesting supported; unknown tags degrade to inner text. Runtime-first design — no compiler change (write-in-place extraction landed in 0.6.0).
- **First publish** of `@verbaly/compiler`, `@verbaly/vite`, `@verbaly/react`, `@verbaly/vue` (the `@verbaly` org). Core republished at 0.2.0 with its npm README.

### Notes

- ICU escape-hatch deferred to 0.3.0. 106 tests. Packed manifests verified (`workspace:*` → real versions, peer `verbaly` → `^0.2.0`).

### Docs impact (synced)

- `docs/frameworks`: `<Trans>` sections (React + Vue). `/changelog`: 0.2.0 entry. Install snippets got copy buttons.

---

## [0.1.0] — 2026-07-02

**First public release.** Minimal usable compiler + runtime i18n: write natural text, the build plugin extracts stable keys, types and per-locale catalogs; tiny tree-shakeable runtime. `verbaly` core published (scoped packages followed in 0.2.0).

### Added

- **Core (`verbaly`)** — 43 tests · ~3.1KB gzip · zero deps · dual ESM+CJS:
  - Message format backed by `Intl`: `{name}` auto-format, `{v:fmt/arg}` (number/integer/percent/currency/date/time + custom), `{v | one: … | other: # …}` unifying plural (Intl.PluralRules) and select/gender. Escapes `{{ }} || ##`.
  - Reactive locale store (subscribe/notify), fallback chain + BCP-47 narrowing. `version` getter for framework reactivity.
  - Dual `t`: `t(key, params)` type-safe (`FlatKeys`) + tagged template `` t`…` ``. `addMessages`, `has`, `onMissing`, warn-once.
  - DOM interpreter `bindDom`: `data-verbaly` + `-args` + `-attr` (blocks `on*`), `MutationObserver`, `textContent`-only, clean unbind.
  - Type-level required params (`ParamNames`/`TArgs` via template-literal types).
- **Compiler (`@verbaly/compiler`)** — AST extraction (@babel/parser 8) of `` t`…` `` into stable sha256-base64url 8-char keys; transform via magic-string + sourcemaps; flat JSON catalogs with auto-sync; `check` (missing + unknown); codegen `virtual:verbaly` (per-locale code-split) + typed `verbaly.d.ts`; CLI `verbaly extract | check | --prune`; config `verbaly.config.{js,mjs,json}`.
- **Vite (`@verbaly/vite`)** — zero-config plugin: virtual modules, live extraction (debounced + HMR invalidation), auto `verbaly.d.ts`, **build blocked while translations are missing**.
- **Adapters** — `@verbaly/react` (Provider + `useT`/`useLocale`, `useSyncExternalStore`); `@verbaly/vue` (plugin + composables, `onScopeDispose`).

### Docs impact (synced)

- Baseline: the whole landing/docs (start, format, cli, vite, dom, frameworks, api) + real-runtime playground.
