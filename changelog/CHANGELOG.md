# Changelog

Version history of the **Verbaly** package. This file is a per-version summary; the **full development detail** of each version lives in its sibling `X.Y.Z.md` file (e.g. [`0.1.0.md`](./0.1.0.md)).

Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/). Pre-1.0: the API may still break between minors (called out explicitly).

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
