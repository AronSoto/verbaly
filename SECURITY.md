# Security Policy

## Supported versions

Verbaly is pre-1.0: only the **latest published `0.x` release** receives security fixes. All twelve packages share one version number and are patched together:

`verbaly` · `@verbaly/compiler` · `@verbaly/vite` · `@verbaly/unplugin` · `@verbaly/react` · `@verbaly/vue` · `@verbaly/svelte` · `@verbaly/sveltekit` · `@verbaly/nuxt` · `@verbaly/next` · `@verbaly/astro` · `@verbaly/mcp`

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use **GitHub private vulnerability reporting**: [Security → Report a vulnerability](https://github.com/AronSoto/verbaly/security/advisories/new). You'll get a response as soon as possible (this is a solo-maintained project, usually within a few days).

Please include the affected package, a proof-of-concept or reproduction, and the impact as you understand it.

## What counts as a vulnerability

Verbaly's security model in one line: **translated content stays inert**. A catalog is untrusted input. If a translated message can execute script, inject markup outside the whitelist, or control a URL, that is a vulnerability and we want to hear about it.

How the runtime enforces this today:

- Rich text builds DOM from a **phrasing-tag whitelist**, never `innerHTML`; unknown tags become plain text.
- Attribute values that come from a message pass one guard (`safeAttribute`): `on*` handlers and `style`/`srcdoc` are refused outright.
- Link hrefs come only from your code, never from catalogs, and `javascript:`, `data:` and `vbscript:` URLs are rejected.
- A catalog value that is not text never reaches the renderer: `flatten` is the single door and it treats what arrives from a lazy loader, `addMessages` or a CMS as hostile.

The build side has its own gate: `verbaly check` fails on a translation that no longer renders what its source renders, so a tampered catalog does not pass CI quietly.

## Supply chain

- Releases are published from CI with **npm provenance** (SLSA v1 attestations). A Verbaly version on npm **without** a provenance attestation is suspect: verify with `npm view <pkg>@<version> dist.attestations`.
- The published runtime has **zero dependencies**. The compiler's are build-time only and never reach your app's bundle.
- Every release is cut from a tagged commit by the `Release` workflow; nothing is published from a laptop.
