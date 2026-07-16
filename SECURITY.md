# Security Policy

## Supported versions

Verbaly is pre-1.0: only the **latest published `0.x` release** receives security fixes. All seven packages (`verbaly`, `@verbaly/compiler`, `@verbaly/vite`, `@verbaly/unplugin`, `@verbaly/react`, `@verbaly/vue`, `@verbaly/svelte`) share one version and are patched together.

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use **GitHub private vulnerability reporting**: [Security → Report a vulnerability](https://github.com/AronSoto/verbaly/security/advisories/new). You'll get a response as soon as possible (this is a solo-maintained project — usually within a few days).

Please include the affected package, a proof-of-concept or reproduction, and the impact as you understand it.

## What counts as a vulnerability

Verbaly's security model in one line: **translated content (catalogs) must stay inert**. If a translated message can execute script, inject markup outside the whitelist, or control a URL — that's a vulnerability. Report it.

How the runtime enforces this today:

- Rich text builds DOM from a **phrasing-tag whitelist**, never `innerHTML` — unknown tags become plain text.
- Attributes never come from messages, and `on*` handlers are blocked.
- Link hrefs come only from your code, never from catalogs; `javascript:`/`data:`/`vbscript:` URLs are rejected.

One more thing worth reporting: releases are published from CI with **npm provenance**, so a Verbaly version on npm _without_ a provenance attestation is suspect.
