# Changelog

Version history of **Verbaly** — one file, full detail per version, newest first. The seven packages share one version number (aligned releases).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly). Each entry ends with a **Docs impact** note — the contract `verbaly-web` syncs against.

> Length control: when 1.0 ships, the 0.x entries move to `changelog/archive-0.x.md`.

---

## [0.13.0] — 2026-07-09

**`verbaly doctor` + adoption & trust.** Setup diagnostics with the exact fix per finding, the i18next migration guide on the docs site, a coverage push (274→335 tests), and releases now publish from GitHub Actions with **npm provenance** (OIDC). Ready to publish. No breaking changes; runtime packages untouched in behavior.

### Added

- **`verbaly doctor`** (`@verbaly/compiler` CLI): diagnoses the whole setup in one command — config file found, catalogs dir + every locale file (present, valid JSON, flat key→string), bundler plugin wiring (`detectBundler` + `@verbaly/vite`/`@verbaly/unplugin` in deps), `verbaly.d.ts` freshness (regenerates and byte-compares), orphan keys (in catalog, not referenced) and translation completeness (reuses `check`). Every warn/error carries the **exact fix command** (pillar 3: actionable errors); `ok`/`warn`/`error` levels, exit 1 only on errors. Exported API: `doctor(cfg)`, types `DoctorEntry`/`DoctorResult`; also new `findConfigFile(root)` (config, dedupes the search list `init` used).
- **Release workflow with npm provenance** (repo): `.github/workflows/release.yml`, `workflow_dispatch`-only (Aron triggers with the version as input; guard against `packages/core/package.json`). Runs the full suite and publishes all 7 with `pnpm -r publish --provenance` via OIDC — packages get registry attestations (Socket supply-chain score lever). Requires one-time Trusted Publisher setup per package on npmjs.com. Local `pnpm release` stays as fallback (no provenance).
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
