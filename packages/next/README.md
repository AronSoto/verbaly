<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Next.js integration for Verbaly — App Router/RSC with per-request locale negotiation, Turbopack and webpack support, flash-free hydration.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/next"><img src="https://img.shields.io/npm/v/@verbaly/next?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/next?color=blue" alt="MIT" /></a>
</p>

---

Server Components render already translated in the visitor's language — cookie first, then `Accept-Language`, then your fallback — and Client Components hydrate with the **same locale and the same catalog**: no flash of untranslated text, no hydration mismatch. Each request gets its **own instance** (React `cache()`): no locale leaking between concurrent users.

Works with **Turbopack** (the Next 16 default) and webpack: the config wrapper generates the runtime module as real files and wires the `t`-template compiler as a loader for both.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/next @verbaly/react
```

## ⚡ Wire it up

**1. The config wrapper** — this is the whole build setup:

```ts
// next.config.ts
import { withVerbaly } from '@verbaly/next';

export default withVerbaly({
  /* your Next config */
});
```

Locales live in your `verbaly.config` (created by `npx verbaly init`), or inline:

```ts
export default withVerbaly({}, { locales: ['en', 'es', 'pt'] });
```

**2. The provider** — root layout, Server Component:

```tsx
// app/layout.tsx
import { getRequestLocale, getVerbalyProps } from '@verbaly/next/server';
import { VerbalyProvider } from '@verbaly/next/client';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  const props = await getVerbalyProps();
  return (
    <html lang={locale}>
      <body>
        <VerbalyProvider {...props}>{children}</VerbalyProvider>
      </body>
    </html>
  );
}
```

**3. Write text** — Server Components use `getT()`:

```tsx
import { getT } from '@verbaly/next/server';

export default async function Page() {
  const t = await getT();
  return <h1>{t`Welcome back`}</h1>;
}
```

Client Components use the React bindings (re-exported from `@verbaly/next/client`):

```tsx
'use client';
import { useT } from '@verbaly/next/client';

export function Counter() {
  const t = useT();
  return <p>{t`You have new messages`}</p>;
}
```

**4. Switching languages** — persists the cookie the server reads and re-renders Server Components:

```tsx
'use client';
import { useSwitchLocale } from '@verbaly/next/client';

export function LocalePicker() {
  const switchLocale = useSwitchLocale();
  return <button onClick={() => void switchLocale('es')}>Español</button>;
}
```

That's it. `next dev` extracts your messages live (catalogs + `verbaly.d.ts` stay fresh); `next build` blocks on missing translations.

## 📖 Options

Second argument of `withVerbaly` — every [`verbaly.config`](https://www.npmjs.com/package/@verbaly/compiler) option, plus:

| Option | What it does |
| --- | --- |
| `cookie` | Cookie read/written for the user's choice (default `verbaly-locale`); `false` = `Accept-Language` only. |
| `fallback` | Locale when nothing matches (defaults to the source locale). |
| `failOnMissing` | `false` opts out of the build gate. |

- Negotiation reads `headers()`/`cookies()`, so negotiated routes render dynamically — for fully static output use [`verbaly render`](https://www.npmjs.com/package/@verbaly/compiler) per locale.
- The generated `.verbaly/` directory is build output (it ships its own `.gitignore`).

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs](https://verbaly-web.vercel.app/docs)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
