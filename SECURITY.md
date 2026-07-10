# Security Policy

## Supported versions

Verbaly is pre-1.0: only the **latest published `0.x` release** receives security fixes. All seven packages (`verbaly`, `@verbaly/compiler`, `@verbaly/vite`, `@verbaly/unplugin`, `@verbaly/react`, `@verbaly/vue`, `@verbaly/svelte`) share one version and are patched together.

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use **GitHub private vulnerability reporting**: [Security → Report a vulnerability](https://github.com/AronSoto/verbaly/security/advisories/new). You'll get a response as soon as possible (this is a solo-maintained project — usually within a few days).

Please include the affected package, a proof-of-concept or reproduction, and the impact as you understand it.

## Scope notes

Verbaly's runtime is designed to keep translated content inert:

- Rich text (`data-verbaly-rich`, `<Trans>`) builds DOM from a **phrasing-tag whitelist** via a real parser — never `innerHTML`. Unknown tags unwrap to plain text.
- Attributes are never sourced from messages; attribute translation blocks `on*` handlers.
- Link hrefs always come from the caller (`richLinks`), never from catalogs, and `javascript:`/`data:`/`vbscript:` URLs are rejected (`safeHref`).

Anything that lets a **translated message** (catalog content) execute script, inject non-whitelisted markup, or control a URL is a vulnerability — report it. Releases are published from CI with **npm provenance** (OIDC); a package version on npm without a provenance attestation should be treated as suspect and reported too.
