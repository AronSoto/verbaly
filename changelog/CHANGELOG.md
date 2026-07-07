# Changelog

Version history of **Verbaly** — one file, full detail per version, newest first. The seven packages share one version number (aligned releases).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly). Each entry ends with a **Docs impact** note — the contract `verbaly-web` syncs against.

> Length control: when 1.0 ships, the 0.x entries move to `changelog/archive-0.x.md`.

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
