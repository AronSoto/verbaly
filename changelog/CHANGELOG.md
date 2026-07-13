# Changelog

Version history of **Verbaly** — one file, full detail per version, newest first. The nine packages share one version number (aligned releases).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly). Each entry ends with a **Docs impact** note — the contract `verbaly-web` syncs against. Since 0.15.0, entries open with a short **Highlights** section — the `Release` workflow publishes it (plus the theme line) as the GitHub Release notes; the full detail lives here.

> Length control: when 1.0 ships, the 0.x entries move to `changelog/archive-0.x.md`.

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
