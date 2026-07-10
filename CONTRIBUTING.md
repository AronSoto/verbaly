# Contributing to Verbaly

Thanks for your interest! Verbaly is in early development (`0.x`) — the API may still change between minors, and the project is currently maintained by one person. Small, focused contributions are the easiest to review and land.

## Before you start

- **Bugs**: open an issue with a minimal reproduction (a failing snippet or repo). If you can, say which package (`verbaly`, `@verbaly/compiler`, `@verbaly/vite`, …) and version.
- **Features**: open an issue first. Verbaly deliberately keeps a small surface — every addition is measured against "does this remove friction from the write→ship cycle?", so a quick discussion saves you from building something that won't be merged.
- **Security issues**: please do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node ≥ 20 and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/AronSoto/verbaly
cd verbaly
pnpm install

pnpm build       # tsdown, all packages
pnpm test        # vitest, all packages
pnpm typecheck   # TypeScript 7 native
pnpm lint        # eslint
```

The monorepo layout:

```
packages/
├─ core/       → verbaly            (runtime)
├─ compiler/   → @verbaly/compiler  (extraction + codegen + CLI)
├─ vite/       → @verbaly/vite
├─ unplugin/   → @verbaly/unplugin  (webpack/Rollup/esbuild/Rspack)
├─ react/ · vue/ · svelte/          (adapters)
```

## Pull requests

- Target the `develop` branch.
- **Every behavior change needs a test.** Suites are per package (`pnpm --filter verbaly test`).
- Keep the runtime lean: the core budget is ~3 KB gzip tree-shaken with **zero dependencies** — PRs that add a dependency to `verbaly` core will not be merged.
- Match the existing code style (Prettier + ESLint run in CI); comments are sparse and short on purpose.
- Adapters (`react`/`vue`/`svelte`) stay thin: they bridge the core's reactivity, they never reimplement formatting or caching. If an adapter needs logic, it probably belongs in core.
- The seven packages share one version and release together — don't bump versions in a PR; releases are cut by the maintainer.

## What makes a good first contribution

- A failing-case test for a bug you found (even without the fix).
- Docs fixes on [verbaly-web](https://github.com/AronSoto/verbaly-web).
- Reproductions and feedback on real-world usage — the project is actively looking for early adopters.
