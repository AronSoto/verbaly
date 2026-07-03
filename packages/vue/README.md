<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo-light.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Vue 3 bindings for Verbaly — composables over the reactive core.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/vue"><img src="https://img.shields.io/npm/v/@verbaly/vue?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/vue?color=blue" alt="Apache-2.0" /></a>
</p>

---

Vue 3 composables for [Verbaly](https://github.com/AronSoto/verbaly) — a thin layer over the reactive core with per-component cleanup (`onScopeDispose`).

## Install

```bash
pnpm add verbaly @verbaly/vue
```

```ts
// main.ts
import { verbalyPlugin } from '@verbaly/vue';
import { verbaly } from 'virtual:verbaly';

app.use(verbalyPlugin(verbaly));
```

```vue
<script setup>
import { useT, useLocale } from '@verbaly/vue';
const t = useT();
const locale = useLocale(); // writable: locale.value = 'en'
</script>

<template>
  <p>{{ t('inbox', { count: 3 }) }}</p>
</template>
```

### Rich text — `<Trans>`

```vue
<script setup>
import { Trans } from '@verbaly/vue';
import { h } from 'vue';
const components = { terms: (c) => h('a', { href: '/terms' }, c) };
</script>

<template>
  <Trans id="agree" :components="components" />
</template>
```

📖 Docs: **https://verbaly-web.vercel.app/docs/frameworks**

> ⚠️ Early development (`0.x`) — API not stable yet.

## License

[Apache-2.0](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
