# Changelog

Historial de versiones del paquete **Verbaly**. Resumen por versión; el **detalle completo del desarrollo** de cada una vive en su archivo hermano `X.Y.Z.md` (ej. [`0.1.0.md`](./0.1.0.md)).

El formato sigue [Keep a Changelog](https://keepachangelog.com/) y [Semantic Versioning](https://semver.org/). Pre-1.0: la API aún puede romper entre minors (se anota explícitamente).

---

## [0.1.0] — 2026-07-02
Primer release público. i18n compilador+runtime: escribes texto natural, un plugin de build extrae keys estables, tipos y catálogos por locale. Runtime diminuto y tree-shakeable. → [detalle](./0.1.0.md)

### Added
- `verbaly` (core): formato de mensaje con `Intl`, locale store reactivo, `t` dual (key + tagged template), DOM interpreter `bindDom`, params type-safe.
- `@verbaly/compiler`: extracción AST, keys estables, catálogos JSON, `check`/`extract`/`--prune`, CLI, codegen tipado.
- `@verbaly/vite`: virtual modules, HMR, build bloqueado si faltan traducciones.
- `@verbaly/react` + `@verbaly/vue`: adapters finos sobre el core.

---

## Convención (cómo se llena esto)
1. Cada versión publicada/mejorada → una entrada resumen aquí **y** un `X.Y.Z.md` con el detalle por paquete (Added/Changed/Simplified/Removed, API, breaking changes, impacto en docs, tests).
2. Al cerrar una versión, avisar a **`verbaly-web`** para sincronizar docs/playground (ver `.claude/PLAN.md` → Reglas → Alineación). Skill: `verbaly-changelog`.

### Plantilla de `X.Y.Z.md`
```md
# vX.Y.Z — <título corto>
Fecha: YYYY-MM-DD · Estado: publicado | en desarrollo

## Resumen
## Por paquete
### verbaly (core)   — Added / Changed / Simplified / Removed
### @verbaly/compiler
### @verbaly/vite
### @verbaly/react · @verbaly/vue
## Breaking changes
## API nueva / firmas
## Impacto en docs (para verbaly-web)
## Tests / verificación
```
