<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Svelte bindings for Verbaly — stores over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/svelte"><img src="https://img.shields.io/npm/v/@verbaly/svelte?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/svelte?color=blue" alt="Apache-2.0" /></a>
</p>

---

Idiomatic Svelte stores (4 and 5) over the [Verbaly](https://github.com/AronSoto/verbaly) core — the `$` auto-subscription just works, re-rendering on every locale switch.

## Install

```bash
pnpm add @verbaly/svelte
```

## Usage

```svelte
<!-- +layout.svelte -->
<script>
  import { provideVerbaly } from '@verbaly/svelte';
  import { verbaly } from 'virtual:verbaly';

  provideVerbaly(verbaly);
</script>
```

```svelte
<!-- Inbox.svelte -->
<script>
  import { useT, useLocale } from '@verbaly/svelte';

  const t = useT();
  const locale = useLocale(); // writable — bind it to a select
</script>

<p>{$t('inbox', { count: 3 })}</p>
<select bind:value={$locale}>
  <option value="es">Español</option>
  <option value="en">English</option>
</select>
```

No component tree? The store factories work with any instance:

```ts
import { createVerbaly } from 'verbaly';
import { localeStore, tStore } from '@verbaly/svelte';

export const verbaly = createVerbaly({/* … */});
export const t = tStore(verbaly);
export const locale = localeStore(verbaly);
```

## `<Trans>` — rich text

Messages with tags (`'The <em>build</em> gate'`) render as real elements — same phrasing-tag whitelist as `data-verbaly-rich`, unknown tags unwrap to inert text, XSS-safe:

```svelte
<script>
  import Trans from '@verbaly/svelte/Trans.svelte';
</script>

<Trans id="home.title" />
<Trans id="greet" values={{ name: 'Aron' }} />
```

Uses the instance from `provideVerbaly` (or pass `instance={verbaly}` explicitly; `richTags` overrides the whitelist). Alternatively the core's DOM interpreter works in any Svelte app — mark elements with `data-verbaly`/`data-verbaly-rich` and call `bindDom`.

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
