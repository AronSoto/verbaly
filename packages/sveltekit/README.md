<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>SvelteKit SSR integration for Verbaly: per-request locale negotiation and flash-free hydration.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/sveltekit"><img src="https://img.shields.io/npm/v/@verbaly/sveltekit?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/sveltekit?color=blue" alt="MIT" /></a>
</p>

---

Server-rendered pages arrive already translated in the visitor's language (cookie first, then `Accept-Language`, then your fallback) and the client hydrates with the **same locale and the same catalog**, so there's no flash of untranslated text and no hydration mismatch. Each request gets its **own instance**: no locale leaking between concurrent users.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/sveltekit @verbaly/svelte @verbaly/vite
```

## ⚡ Wire it up

**1. Vite plugin** (extraction + the `virtual:verbaly` module):

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import verbaly from '@verbaly/vite';

export default { plugins: [verbaly(), sveltekit()] };
```

**2. The lang placeholder** in `src/app.html`:

```html
<html lang="%verbaly.lang%" dir="%verbaly.dir%"></html>
```

**3. Server hook**: negotiates the locale per request:

```ts
// src/hooks.server.ts
import { verbalyHandle } from '@verbaly/sveltekit';
import { locales } from 'virtual:verbaly';

export const handle = verbalyHandle({ locales });
```

```ts
// src/app.d.ts
declare namespace App {
  interface Locals {
    verbalyLocale: string;
  }
}
```

**4. Hand the locale to the client**:

```ts
// src/routes/+layout.server.ts
export const load = ({ locals }) => ({ locale: locals.verbalyLocale });
```

**5. One instance per render, catalog awaited**: the no-FOUC guarantee, in one call:

```ts
// src/routes/+layout.ts
import { createRequestInstance } from 'virtual:verbaly';

export const load = async ({ data }) => ({
  ...data,
  verbaly: await createRequestInstance(data.locale), // catalog ready BEFORE render
});
```

(`createInstance(options)` remains available when you need custom options.)

```html
<!-- src/routes/+layout.svelte -->
<script>
  import { provideVerbaly } from '@verbaly/svelte';

  let { data, children } = $props();
  provideVerbaly(data.verbaly);
</script>

{@render children()}
```

**6. Switching languages** (client): persists the cookie the server hook reads:

```html
<script>
  import { switchLocale } from '@verbaly/sveltekit';
  import { useVerbaly } from '@verbaly/svelte';

  const verbaly = useVerbaly();
</script>

<button on:click="{()" ="">switchLocale(verbaly, 'es')}>Español</button>
```

## 📖 API

| Export                                                 | What it does                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verbalyHandle({ locales, fallback?, cookie? })`       | SvelteKit `handle` hook: resolves the request locale (cookie → `Accept-Language` → fallback), sets `event.locals.verbalyLocale`, fills `%verbaly.lang%` and `%verbaly.dir%` in `app.html`. |
| `switchLocale(instance, locale, { cookie?, maxAge? })` | Awaits the catalog, switches the locale, writes the cookie and syncs `<html lang>`. SSR-safe.                                                                                              |
| `LOCALE_COOKIE`                                        | Default cookie name (`verbaly-locale`), shared with core's `localStorage` key.                                                                                                             |

- `cookie: false` disables cookie reading/writing (pure `Accept-Language`).
- No dependency on `@sveltejs/kit`: the hook is typed structurally and stays compatible across Kit 2.x.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/sveltekit](https://verbaly-web.vercel.app/docs/sveltekit)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
