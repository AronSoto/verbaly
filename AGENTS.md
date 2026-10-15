# Verbaly

i18n where you write the text in your code: a compiler extracts stable keys, types and one module per locale, and a runtime of about 3 KB with zero dependencies renders it. Thirteen packages in one pnpm monorepo, released together under one version. Human contributors: [CONTRIBUTING.md](CONTRIBUTING.md) says the same in fewer words.

## Commands

```bash
pnpm install
pnpm build                     # tsdown, every package
pnpm test                      # each package's suite (scripts/test.mjs), what the Release workflow runs
pnpm coverage                  # the root vitest projects, what CI runs
pnpm typecheck                 # TypeScript 7 native (tsc)
pnpm lint                      # eslint, including the one-line comment rule
pnpm format                    # prettier; CI runs pnpm format:check
pnpm --filter verbaly size     # the core's weight against its budgets, gated in CI
pnpm --filter <package> test   # one package
```

## Layout

- `packages/<name>/{src,test}`: one folder per published package.
- `changelog/CHANGELOG.md`: one entry per version, newest first.
- `skills/verbaly/SKILL.md`: the Agent Skill Verbaly ships to its users, not instructions for working on this repo.
- `scripts/`: the test runner, the first-contact check and the lint rule for comments.

| Folder                               | Package                                             | What it is                                                                                            |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `core`                               | `verbaly`                                           | The runtime: `createVerbaly`, `t`, formats, locale helpers, `bindDom`. Zero dependencies, ESM and CJS |
| `compiler`                           | `@verbaly/compiler`                                 | Extraction (Babel), codegen, validation and the `verbaly` CLI. ESM only                               |
| `vite`, `unplugin`                   | `@verbaly/vite`, `@verbaly/unplugin`                | Bundler plugins (unplugin covers webpack, Rollup, esbuild and Rspack)                                 |
| `react`, `vue`, `svelte`             | `@verbaly/react`, `@verbaly/vue`, `@verbaly/svelte` | Thin adapters: the core's reactivity plus `<Trans>`                                                   |
| `sveltekit`, `nuxt`, `next`, `astro` | `@verbaly/<name>`                                   | Framework integrations                                                                                |
| `mcp`, `studio`                      | `@verbaly/mcp`, `@verbaly/studio`                   | The MCP server for agents, and the local review server                                                |

## Rules every change keeps

- **The core ships zero dependencies, and its size is gated.** Logic an adapter needs moves to the core; adapters only bridge reactivity.
- **The public surface is pinned by tests.** A new export from `verbaly` or `@verbaly/compiler` edits `packages/core/test/index.test.ts` or `packages/compiler/test/surface.test.ts` in the same change.
- **A catalog is untrusted input.** It reaches the runtime only through `flatten`; in the compiler, every map keyed by catalog keys starts as `emptyCatalog()` and is read through `own()`.
- **Nothing crashes on bad data, and nothing degrades in silence.** Every fallback warns once through `warnOnce`, naming the message and never the value.
- **One path per job.** `analyzeFile` reads every file type, `syncProject` writes the catalogs, `shippedCatalogs` reads the text that ships, `gatePasses` decides what fails, `writeDts` writes the types, `safeAttribute` guards attributes. Extend the path; never add a second one.
- **`verbaly check` is the strict gate.** A build lists what is missing or broken and finishes, unless the project sets `failOnMissing: true`. Anything that builds and renders is a warning, never an error.
- **Generated keys never change**: the first 8 characters of the text's sha256 in base64url. A new scheme would re-key every user's catalogs.
- **`""` means untranslated** everywhere, and the core's `lookup` is the single source of that rule.
- **Every behavior change has a test, and a test that guards a fix was seen failing** with the fix reverted before it is trusted.
- **Package shape:** `sideEffects: false`; only `dist/` and `LICENSE` ship; `fixedExtension: false` in tsdown. The core, react and vue are dual ESM and CJS, and so is the root entry of `@verbaly/next`, because `next.config.ts` is often CommonJS; the rest are ESM only.

## Writing

- **A comment is one line of at most 100 characters**, and only for a constraint the code cannot show. `pnpm lint` enforces it; the longer why goes to the changelog.
- **No em dash and no en dash** in anything written here: code, comments, error messages, READMEs, the changelog. Use a comma, a colon, parentheses or a new sentence. A hyphen in a compound word (`type-safe`) is fine.
- **No raw control characters or byte order marks in source**: write them as `\u` escapes. A text file that `git diff --stat` shows as `Bin` has one.
- **Counts live in one place.** Never write the number of tests, exports or MCP tools in prose: the list, or the test that pins it, is the count. Measured numbers go in the changelog entry.
- Messages people read (errors, CLI output, READMEs) are plain English in short sentences, and a message that names a command only names one that exists (`cli.test.ts` checks).

## Pull requests

- Target `develop`. Don't bump versions: the thirteen packages are released together by the maintainer, who also writes the changelog entry.
- New dependencies: the latest stable (`npm view <package> version`), with the whole suite green, and never in what the core ships.
- TypeScript runs side by side on purpose: `tsc` is TypeScript 7 native for the typecheck, and the `typescript` package is the TypeScript 6 API that eslint and tsdown need.
