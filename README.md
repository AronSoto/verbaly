# Verbaly

**Effortless i18n.** Write natural text — ship type-safe, tree-shakeable translations.

> ⚠️ Early development. `v0.1` in progress — API not stable yet.

## Why Verbaly

- **Zero config** — one Vite plugin. No giant `init()`, no macros, no proprietary formats.
- **Compiler-powered** — stable keys, generated types and per-locale bundles, automatically.
- **Dynamic-friendly** — a real runtime path for CMS/dynamic content, plus a DOM interpreter for plain HTML.
- **Missing translations fail the build** — raw keys never reach production.

## Packages

| Package | Description |
|---------|-------------|
| [`verbaly`](packages/core) | Core runtime — `t`, locale store, formatting, DOM interpreter |
| [`@verbaly/compiler`](packages/compiler) | Message extraction, type-safe codegen and CLI |
| [`@verbaly/vite`](packages/vite) | Zero-config Vite plugin with HMR |
| [`@verbaly/react`](packages/react) | React hooks — `useT`, `useLocale` |
| [`@verbaly/vue`](packages/vue) | Vue 3 composables — `useT`, `useLocale` |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

[Apache-2.0](./LICENSE)
