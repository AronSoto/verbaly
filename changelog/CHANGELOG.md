# Changelog

Version history of the **Verbaly** package. This file is a per-version summary; the **full development detail** of each version lives in its sibling `X.Y.Z.md` file (e.g. [`0.1.0.md`](./0.1.0.md)).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly).

---

## [0.4.0] — 2026-07-04
Dogfooding release: rich text in the DOM interpreter + locale bootstrap helpers. No breaking changes. → [details](./0.4.0.md)

### Added
- **Rich text in `bindDom`** (core): `data-verbaly-rich` renders tagged messages (`'The build <em>gate</em>'`) as real elements — phrasing-tag whitelist, built programmatically (never `innerHTML`), attributes never come from messages; non-whitelisted tags unwrap to inert text. `richTags` option to override.
- `resolveLocale({ supported, fallback?, storageKey? })` + `persistLocale(locale, storageKey?)` (core): storage → `navigator.languages` (BCP-47 narrowing) → fallback, and persistence + `<html lang>` sync. SSR-safe.
- `locales` getter on the instance — loaded locales for language switchers.

---

## [0.3.0] — 2026-07-03
Opt-in ICU MessageFormat support (zero-dep) + robustness fixes. No breaking changes. → [details](./0.3.0.md)

### Added
- **ICU escape-hatch** (core): write `{count, plural, one {#} other {#}}` / `select` / `selectordinal` / `{n, number, …}` and it's parsed into the native AST — auto-detected, zero dependencies.
- `parseTags` + `TagNode` core exports — the shared, hardened `<Trans>` tokenizer.

### Changed
- `@verbaly/react` + `@verbaly/vue` `<Trans>` now share the core tokenizer (deduped, hardened for malformed tags).

### Fixed
- Key-collision detection warns at build time (`@verbaly/compiler`) instead of silently dropping a message.
- `@verbaly/vite` clears keys on file delete (watcher `unlink`); dev `vite` bumped to 8.1.3.

---

## [0.2.0] — 2026-07-03
Ecosystem goes public + rich text. First npm publish of the compiler, Vite plugin and framework adapters; `<Trans>` for rich-text translation in React/Vue. Aligned versioning — all packages at 0.2.0. → [details](./0.2.0.md)

### Added
- `@verbaly/react` + `@verbaly/vue`: `<Trans>` — interpolate elements/links inside a translated message via named tags (`Read the <terms>terms</terms>`).
- First npm publish of `@verbaly/compiler`, `@verbaly/vite`, `@verbaly/react`, `@verbaly/vue`.
- npm README for the `verbaly` core.

### Changed
- All packages aligned at `0.2.0`.

---

## [0.1.0] — 2026-07-02
First public release. Compiler + runtime i18n: write natural text, a build plugin extracts stable keys, types, and per-locale catalogs. Tiny, tree-shakeable runtime. → [details](./0.1.0.md)

### Added
- `verbaly` (core): message format backed by `Intl`, reactive locale store, dual `t` (key + tagged template), `bindDom` DOM interpreter, type-safe params.
- `@verbaly/compiler`: AST extraction, stable keys, flat JSON catalogs, `check`/`extract`/`--prune`, CLI, typed codegen.
- `@verbaly/vite`: virtual modules, HMR, build blocked when translations are missing.
- `@verbaly/react` + `@verbaly/vue`: thin adapters over the core.

---

## Convention (how this is maintained)
1. Every published/improved version → one summary entry here **and** an `X.Y.Z.md` with the per-package detail (Added/Changed/Simplified/Removed, API, breaking changes, docs impact, tests).
2. When a version closes, signal **`verbaly-web`** to sync docs/playground (see `.claude/PLAN.md` → Rules → Alignment). Skill: `verbaly-changelog`.

### `X.Y.Z.md` template
```md
# vX.Y.Z — <short title>
Date: YYYY-MM-DD · Status: published | in development

## Summary
## Per package
### verbaly (core)   — Added / Changed / Simplified / Removed
### @verbaly/compiler
### @verbaly/vite
### @verbaly/react · @verbaly/vue
## Breaking changes
## New API / signatures
## Docs impact (for verbaly-web)
## Tests / verification
```
