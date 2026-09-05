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

Prefer the MCP server when available: `claude mcp add verbaly -- npx -y @verbaly/mcp` exposes the cycle as tools, in the order you meet a project: `verbaly_init`, `verbaly_doctor`, `verbaly_wrap`, `verbaly_extract`, `verbaly_status`, `verbaly_missing`, `verbaly_translate`, `verbaly_drafts`. Each answers with structured output as well as text. **Approving a draft is not one of them, and never will be**: `verbaly_drafts` shows you each machine translation next to its source so a human can decide, and accepting one is `verbaly review --approve`, run by them.

It also serves two **resources**, which is how you read the project without spending a tool call: `verbaly://config` (source locale, every locale, catalog directory, url mode) and `verbaly://catalog/{locale}` (every message of one locale, flattened the way the runtime sees it). Reading a message's text is what these are for: no tool returns it.

## Rules that keep the cycle safe

- **Keys are generated** (hash of the message). To reference one in code, keep writing the `` t`…` `` template; the build transform turns it into `t('<key>', params)`. Use `` t.id('my.key')`…` `` only when a stable human key is required.
- **`""` in a catalog means untranslated** (falls back to the source language). Intentional empty text is `' '`.
- **Two message features are weight the compiler decides for you**: the ICU parser (544 B) and the relative-time formatter (318 B) ship only when a catalog actually uses them. Never hand-wire either. If messages reach the app after the build (a CMS, a fetched catalog) and may use them, set `icu: true` or `relative: true` in the config; otherwise such a message degrades with a warning that names what is missing.
- **Params and tags must survive translation**: `{name}` placeholders and `<em>…</em>` tags stay verbatim in every locale, or the entry is rejected.
- **Rich text is whitelisted**: messages may carry phrasing tags (`<em>`, `<strong>`, `<code>`…); links go through named tags plus a links map, never literal `<a href>` in a message.
- **`routing` says where the language lives in the URL** and is normally not written at all: a project with a `render` section is `'prefix-except-source'`, one without is `'no-prefix'`, and `'prefix-all'` exists for when no language is the default. **To switch languages, call `switchLocale` from `virtual:verbaly`**, never assemble it by hand: it is bound to the project and does the right thing in either mode (navigate, or swap in place), remembers the choice in both the cookie and storage, and sets `<html lang>`/`<html dir>`. Pass `{ navigate }` to use your framework's router. `localePath` and `localeFromPath` come from there too.
- **On a server, the URL decides the language when it carries one, and the cookie is not consulted.** Pass `routing` to the integration so it can: `verbalyHandle({ locales, routing })` in SvelteKit (plus `verbalyReroute` in `hooks.ts`, so one route tree serves every language), nothing to write in Nuxt, and `setRequestLocale(locale)` from `@verbaly/next/server` in the `[locale]` layout for Next. **Next needs that call to stay statically rendered**: without it Verbaly reads request headers, and that read makes the route dynamic. In Astro's own i18n routing, build the instance with `await createRequestInstance(Astro.currentLocale ?? sourceLocale)`.
- **`alternateLinks` builds the hreflang set** (one entry per locale plus `x-default`) for a translated head on a server; `verbaly render` already writes it for static output. Under `no-prefix` it is empty on purpose: one URL cannot carry every hreflang.
- **Bind the head, not just the body.** A translated page with an English `<title>` and `<meta name="description">` is a half translation, and those two are most of what a search result shows: `<title data-verbaly="key">` and `<meta data-verbaly-attr='{"content":"key"}'>`. At runtime `bindDom` needs `{ root: document }` to reach them; its default root is the body.
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
