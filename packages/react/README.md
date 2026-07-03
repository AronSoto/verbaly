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

Interpolate elements with named tags in the message:

```tsx
import { Trans } from '@verbaly/react';

// message: Read the <terms>terms</terms> first
<Trans id="agree" components={{ terms: <a href="/terms" /> }} />;
```

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
