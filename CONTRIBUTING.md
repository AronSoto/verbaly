# Contributing to Verbaly

Thanks for your interest! Verbaly is in early development (`0.x`): the API may still change between minors, and the project is currently maintained by one person. Small, focused contributions are the easiest to review and land.

## Before you start

- **Bugs**: open an issue with a minimal reproduction (a failing snippet or repo). If you can, say which package (`verbaly`, `@verbaly/compiler`, `@verbaly/vite`, …) and version.
- **Features**: open an issue first. Verbaly deliberately keeps a small surface: every addition is measured against "does this remove friction from the write→ship cycle?", so a quick discussion saves you from building something that won't be merged.
- **Security issues**: please do **not** open a public issue; see [SECURITY.md](SECURITY.md).

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
├─ sveltekit/ · nuxt/ · next/       (SSR meta-framework integrations)
├─ astro/      → @verbaly/astro     (Astro integration + per-locale SSG)
└─ mcp/        → @verbaly/mcp       (MCP server: the cycle as tools for agents)
```

## Pull requests

- Target the `develop` branch.
- **Every behavior change needs a test.** Suites run per package: `pnpm --filter verbaly test`.
- **The core stays dependency-free, and its weight is gated.** `pnpm --filter verbaly size` measures four surfaces against budgets; a PR that adds a dependency to `verbaly` core won't be merged, and one that pushes a budget over needs a reason in the changelog.
- **Adapters stay thin.** `react`/`vue`/`svelte` only bridge the core's reactivity. If an adapter needs real logic, it probably belongs in core.
- **Don't bump versions.** The twelve packages release together; releases are cut by the maintainer.
- Match the existing style: Prettier and ESLint run in CI, and comments are sparse on purpose.

## What makes a good first contribution

- A failing-case test for a bug you found (even without the fix).
- Docs fixes on [verbaly-web](https://github.com/AronSoto/verbaly-web).
- Reproductions and feedback on real-world usage: the project is actively looking for early adopters.
