<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Svelte bindings for Verbaly: stores over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/svelte"><img src="https://img.shields.io/npm/v/@verbaly/svelte?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/svelte?color=blue" alt="MIT" /></a>
</p>

---

Idiomatic Svelte 5 stores over the [Verbaly](https://github.com/AronSoto/verbaly) core: the `$` auto-subscription just works, re-rendering on every locale switch.

## 🚀 Install

```bash
pnpm add @verbaly/svelte
```

## ⚡ Usage

```html
<!-- +layout.svelte -->
<script>
  import { provideVerbaly } from '@verbaly/svelte';
  import { verbaly } from 'virtual:verbaly';

  provideVerbaly(verbaly);
</script>
```

<!-- prettier-ignore -->
```html
<!-- Inbox.svelte -->
<script>
  import { useT, useLocale } from '@verbaly/svelte';

  const t = useT();
  const locale = useLocale(); // writable, bind it to a select
</script>

<p>{$t('inbox', { count: 3 })}</p>
<select bind:value={$locale}>
  <option value="es">Español</option>
  <option value="en">English</option>
</select>
```

Or skip the keys entirely: write the source text in place and the compiler extracts it, right in your `.svelte` files (script and markup):

```html
<h1>{$t`Hello ${name}, you have ${count} messages`}</h1>
```

No component tree? The store factories work with any instance:

```ts
import { createVerbaly } from 'verbaly';
import { localeStore, tStore } from '@verbaly/svelte';

export const verbaly = createVerbaly({/* … */});
export const t = tStore(verbaly);
export const locale = localeStore(verbaly);
```

## ✨ `<Trans>`: rich text

Messages with tags (`'The <em>build</em> gate'`) render as real elements, same phrasing-tag whitelist as `data-verbaly-rich`, unknown tags unwrap to inert text, XSS-safe:

```html
<script>
  import Trans from '@verbaly/svelte/Trans.svelte';
</script>

<Trans id="home.title" />
<Trans id="greet" values={{ name: 'Aron' }} />

<!-- message: 'Read the <docs>guide</docs>' → a real <a>; hrefs from you, never from messages -->
<Trans id="cta" links={{ docs: { href: '/docs', target: '_blank', rel: 'noopener' } }} />

<!-- or map a tag to your own component; it receives the tag content as children -->
<Trans id="cta" components={{ docs: DocsLink }} />
```

Uses the instance from `provideVerbaly` (or pass `instance={verbaly}` explicitly; `richTags` overrides the whitelist, `links` maps tag names to hrefs with `javascript:` blocked, `components` wins over both). Alternatively the core's DOM interpreter works in any Svelte app: mark elements with `data-verbaly`/`data-verbaly-rich` and call `bindDom`.

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks**

> ⚠️ Early development (`0.x`): API not stable yet.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
