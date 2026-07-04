<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>React bindings for Verbaly — hooks over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/react"><img src="https://img.shields.io/npm/v/@verbaly/react?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/react?color=blue" alt="Apache-2.0" /></a>
</p>

---

React hooks for [Verbaly](https://github.com/AronSoto/verbaly) — a thin layer (React 18/19) over the reactive core via `useSyncExternalStore`.

## Install

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

### Rich text — `<Trans>`

Write the source text in place — the compiler extracts it (key, catalogs, props):

```tsx
import { Trans } from '@verbaly/react';

// you write:
<Trans>Read the <a href="/terms">terms</a> before continuing</Trans>
// the compiler rewrites it to:
<Trans id="x7Ka9q2f" components={{ "a": <a href="/terms" /> }} />
```

Runtime-first still works — pass `id` (+ `values`/`components`) yourself and nothing is touched. JSX whitespace rules apply: a line break between an element and text renders no space (use `{' '}`).

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
