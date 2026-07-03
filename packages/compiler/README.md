<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Message extraction, type-safe codegen and CLI for Verbaly.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/compiler"><img src="https://img.shields.io/npm/v/@verbaly/compiler?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/compiler?color=blue" alt="Apache-2.0" /></a>
</p>

---

The compiler behind [Verbaly](https://github.com/AronSoto/verbaly): AST extraction of `t\`...\`` into stable hashed keys, flat JSON catalog sync, and typed codegen. It also ships the **`verbaly` CLI**.

> Most projects don't install this directly — [`@verbaly/vite`](https://www.npmjs.com/package/@verbaly/vite) wraps it with zero config. Reach for it when scripting extraction/checks yourself.

## CLI

```bash
npx verbaly extract        # sync catalogs + types
npx verbaly check          # exit 1 if anything is missing (CI)
npx verbaly extract --prune  # drop orphaned keys
```

Reads `verbaly.config.{js,mjs,json}`. Generates `locales/<locale>.json` (flat, portable — no proprietary format) and `verbaly.d.ts` with params typed per key.

📖 Docs: **https://verbaly-web.vercel.app/docs/cli**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
