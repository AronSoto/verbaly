<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>React bindings for Verbaly: hooks over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/react"><img src="https://img.shields.io/npm/v/@verbaly/react?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/react?color=blue" alt="MIT" /></a>
</p>

---

React hooks for [Verbaly](https://github.com/AronSoto/verbaly): a thin layer (React 18/19) over the reactive core via `useSyncExternalStore`.

**Preact works too**, through `preact/compat`, with no extra package and no configuration of ours: the test suite runs a second time with React resolved to `preact/compat` (hooks, locale switching, `<Trans>` and server rendering), so this is measured, not assumed.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/react
```

```tsx
import { VerbalyProvider, useT, useLocale } from '@verbaly/react';
import { verbaly } from 'virtual:verbaly';

<VerbalyProvider instance={verbaly}>
  <App />
</VerbalyProvider>;

function Inbox() {
  const t = useT();
  return <p>{t('inbox', { count: 3 })}</p>;
}
```

**Keys are typed.** `useT()` checks every key and its params against your source catalog, through the types Verbaly generates (`src/verbaly.d.ts` in a Vite app): a key no catalog has does not compile. A key that comes from data, like `t(item.key)`, passes as it is; declare it with `defineKeys` from `virtual:verbaly` when you want `check` to verify it exists.

`useT()` hands out a new `t` whenever the language changes or a catalog arrives, so a `useMemo`, `useCallback` or effect keyed on `t` runs again in the new language. While nothing changes it stays the same function.

### ✨ Rich text: `<Trans>`

Write the source text in place and the compiler extracts it (key, catalogs, props):

```tsx
import { Trans } from '@verbaly/react';

// you write:
<Trans>Read the <a href="/terms">terms</a> before continuing</Trans>
// the compiler rewrites it to:
<Trans id="x7Ka9q2f" components={{ "a": <a href="/terms" /> }} />
```

Both forms type-check: children in your source, `id` at runtime. A `<Trans>` the compiler never saw (no plugin, or a file outside `include`) renders its children as written, like an uncompiled `` t`…` ``. Runtime-first still works: pass `id` (+ `values`/`components`) yourself and nothing is touched. Whitelisted phrasing tags in a message (`<em>`, `<code>`…) render as real elements, same whitelist as `data-verbaly-rich` (`richTags` overrides it); unknown tags unwrap to inert text. JSX whitespace rules apply: a line break between an element and text renders no space (use `{' '}`).

Named links without custom components; hrefs come from your code, never from messages (`javascript:` blocked):

```tsx
// message: 'Read the <docs>guide</docs>'
<Trans id="cta" links={{ docs: { href: '/docs', target: '_blank', rel: 'noopener' } }} />
```

### React Server Components: `@verbaly/react/server`

A Server Component has no provider to read and no hooks to call, so this entry renders `<Trans>` from an instance you pass, with the same contract as the client one:

```tsx
import { Trans } from '@verbaly/react/server';

<Trans id="agree" instance={verbaly} components={{ terms: <a href="/terms" /> }} />;
```

In Next.js, `@verbaly/next/server` exports a `<Trans>` that finds the request's instance itself.

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks/react**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
