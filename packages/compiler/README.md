<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Message extraction, type-safe codegen and CLI for Verbaly.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/compiler"><img src="https://img.shields.io/npm/v/@verbaly/compiler?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/compiler?color=blue" alt="Apache-2.0" /></a>
</p>

---

The compiler behind [Verbaly](https://github.com/AronSoto/verbaly): AST extraction of `t\`...\``**and JSX`<Trans>` children** into stable hashed keys — or **readable keys** via `` t.id('inbox.title')`…` `` and `<Trans id="inbox.title">…</Trans>` — flat JSON catalog sync, and typed codegen. It also ships the **`verbaly` CLI**.

> Most projects don't install this directly — [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) wraps it with zero config. Reach for it when scripting extraction/checks yourself.

## CLI

```bash
npx verbaly extract        # sync catalogs + types
npx verbaly check          # exit 1 if anything is missing (CI)
npx verbaly extract --prune  # drop orphaned keys
npx verbaly translate      # fill missing translations via Claude (or your provider)
```

Reads `verbaly.config.{js,mjs,ts,mts,json}` (TS configs need `esbuild` installed). Generates `locales/<locale>.json` (flat, portable — no proprietary format) and `verbaly.d.ts` with params typed per key.

## Machine translation

`verbaly translate` fills the `""` holes `check` reports. The default provider uses Claude via the official SDK — install it as a dev dependency (translation is a build-time step, not an app runtime dependency): `pnpm add -D @anthropic-ai/sdk` (or `npm i -D`), plus `ANTHROPIC_API_KEY`. Default model is `claude-sonnet-5` (balanced quality/cost); override with `translate.model` in config or `--model <id>`. Placeholders, variants and tags are validated after translation — anything not preserved verbatim stays `""` so `check` keeps failing. Plug your own provider in `verbaly.config.ts`:

```ts
translate: { provider: async ({ sourceLocale, targetLocale, messages }) => ({ ...translated }) }
```

📖 Docs: **https://verbaly-web.vercel.app/docs/cli**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
