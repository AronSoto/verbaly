---
name: verbaly
description: Internationalize an app with Verbaly (write-in-source i18n, no hand-written keys). Use when adding translations, wrapping hardcoded text, running the extract/check/translate cycle, wiring a framework adapter, or fixing missing-translation build failures in a project that uses verbaly.
---

# Verbaly for coding agents

Verbaly inverts the i18n flow: you write natural text in the source and the compiler extracts it, generates stable keys, per-locale catalogs and types. Never invent or hand-write catalog keys.

## The cycle

1. **Write text in the source**, wrapped in a tagged template:
   ```ts
   t`Hello ${name}, you have ${count} messages`;
   ```
   In markup it must sit in expression context: JSX ``{t`…`}``, Vue ``{{ t`…` }}`` or ``:title="t`…`"``, Svelte ``{$t`…`}``, Astro ``{t`…`}``. Display-only text is never extracted.
2. **Extract**: `npx verbaly extract` scans sources, fills `locales/<locale>.json` and refreshes the generated types. With a bundler plugin (`@verbaly/vite`, `@verbaly/unplugin`, or the framework integrations) dev-mode extraction is automatic.
3. **Check**: `npx verbaly check` exits 1 while translations are missing; builds with the plugin fail the same way (`failOnMissing`). This is the CI gate.
4. **Translate**: `npx verbaly translate` fills gaps with the configured provider (default Claude, needs `ANTHROPIC_API_KEY`). Machine output is saved as drafts; a human accepts them with `npx verbaly review --approve`. Human files round-trip via `verbaly export` / `verbaly import` (XLIFF, CSV, gettext PO). A batch the provider does not answer is retried, then reported with its keys, and everything that did answer is written: re-run to ask only for what is left.

`npx verbaly status` shows coverage per locale at any time; `npx verbaly doctor` diagnoses a broken setup. To onboard an existing JSX/TSX codebase, `npx verbaly wrap` reports hardcoded text and `--write` wraps it.

Prefer the MCP server when available: `claude mcp add verbaly -- npx -y @verbaly/mcp` exposes the cycle as six tools (`verbaly_doctor`, `verbaly_wrap`, `verbaly_extract`, `verbaly_status`, `verbaly_missing`, `verbaly_translate`), each answering with structured output as well as text. Approving a draft is not one of them, and never will be.

## Rules that keep the cycle safe

- **Keys are generated** (hash of the message). To reference one in code, keep writing the `` t`…` `` template; the build transform turns it into `t('<key>', params)`. Use `` t.id('my.key')`…` `` only when a stable human key is required.
- **`""` in a catalog means untranslated** (falls back to the source language). Intentional empty text is `' '`.
- **Params and tags must survive translation**: `{name}` placeholders and `<em>…</em>` tags stay verbatim in every locale, or the entry is rejected.
- **Rich text is whitelisted**: messages may carry phrasing tags (`<em>`, `<strong>`, `<code>`…); links go through named tags plus a links map, never literal `<a href>` in a message.
- Config lives in `verbaly.config.{js,ts,json}` (`locales`, `include`, `dir`); `npx verbaly init` scaffolds it and detects the bundler.
- **Terms that must not be translated go in `translate.glossary`**, never fixed by hand after the fact: `{ Verbaly: 'Verbaly', checkout: { es: 'pago' } }`. Tone and address form go in `translate.instructions`.

## Framework wiring (one-liners)

| Stack      | Setup                                                       |
| ---------- | ----------------------------------------------------------- |
| Vite SPA   | `verbaly()` from `@verbaly/vite` in `vite.config`           |
| React      | `@verbaly/react`: `VerbalyProvider` + `useT()` + `<Trans>`  |
| Vue        | `@verbaly/vue`: `verbalyPlugin` + `useT()` + `<Trans>`      |
| Svelte 5   | `@verbaly/svelte`: context + `$t` store + `<Trans>`         |
| SvelteKit  | `verbalyHandle` from `@verbaly/sveltekit` in `hooks.server` |
| Nuxt       | `modules: ['@verbaly/nuxt']`                                |
| Next.js    | `withVerbaly` from `@verbaly/next` + `/server` + `/client`  |
| Astro      | `verbaly()` from `@verbaly/astro` in `astro.config`         |
| Plain HTML | `bindDom` + `data-verbaly` attributes                       |

Full docs: https://verbaly-web.vercel.app/docs
