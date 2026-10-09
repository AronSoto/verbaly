<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>Next.js integration for Verbaly: App Router/RSC with per-request locale negotiation, Turbopack and webpack support, flash-free hydration.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/next"><img src="https://img.shields.io/npm/v/@verbaly/next?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/next?color=blue" alt="MIT" /></a>
</p>

---

Server Components render already translated in the visitor's language (cookie first, then `Accept-Language`, then your fallback) and Client Components hydrate with the **same locale and the same catalog**: no flash of untranslated text, no hydration mismatch. Each request gets its **own instance** (React `cache()`): no locale leaking between concurrent users.

Works with **Turbopack** (the Next 16 default) and webpack: the config wrapper generates the runtime module as real files and wires the `t`-template compiler as a loader for both. The loader rewrites exactly the files `verbaly extract` reads (your config's `include` and `exclude`), so a code sample in a file outside them keeps its `` t`…` `` as written.

## 🚀 Install

```bash
pnpm add verbaly @verbaly/next @verbaly/react
```

## ⚡ Wire it up

**1. The config wrapper**, the whole build setup:

```ts
// next.config.ts
import { withVerbaly } from '@verbaly/next';

export default withVerbaly({/* your Next config */});
```

Locales live in your `verbaly.config` (created by `npx verbaly init`), or inline:

```ts
export default withVerbaly({}, { locales: ['en', 'es', 'pt'] });
```

**2. The provider**: root layout, Server Component:

```tsx
// app/layout.tsx
import { getRequestLocale, getVerbalyProps } from '@verbaly/next/server';
import { VerbalyProvider } from '@verbaly/next/client';
import { localeDirection } from 'verbaly';

// the language comes from the cookie and Accept-Language, so the shell renders per request
export const instant = false;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  const props = await getVerbalyProps();
  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body>
        <VerbalyProvider {...props}>{children}</VerbalyProvider>
      </body>
    </html>
  );
}
```

`export const instant = false` is for `cacheComponents`, which `create-next-app` turns on: a layout that reads the request outside `<Suspense>` fails the build there, and a language chosen by cookie is exactly that. Without `cacheComponents`, leave the line out. To keep pages static instead, put the language in the URL (step 5).

**3. Write text**: Server Components use `getT()`:

```tsx
import { getT } from '@verbaly/next/server';

export default async function Page() {
  const t = await getT();
  return <h1>{t`Welcome back`}</h1>;
}
```

Rich text in a Server Component is the same `<Trans>` as in React, from `@verbaly/next/server`: it renders in the request's language with no provider.

```tsx
import { Trans } from '@verbaly/next/server';

<Trans>
  Read the <a href="/terms">terms</a> before you go on
</Trans>;
```

Outside a page, where there is no request to read (an OG image, a sitemap, an email), name the language. That call never reads the request, so the route stays static:

```ts
// app/og/route.ts
import { getT } from '@verbaly/next/server';

export async function GET() {
  const t = await getT({ locale: 'es' });
  return Response.json({ title: t('home.lead') });
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

**4. Switching languages**: persists the cookie the server reads and re-renders Server Components,
or, when your `routing` puts the language in the URL, moves to the same page in the new language:

```tsx
'use client';
import { useSwitchLocale } from '@verbaly/next/client';

export function LocalePicker() {
  const switchLocale = useSwitchLocale();
  return <button onClick={() => void switchLocale('es')}>Español</button>;
}
```

**5. If your URLs carry the language** (`app/[locale]/…`), say so in the config first. That line
is what gives `getAlternates` the other languages and sends `useSwitchLocale` to the new URL;
leave it out and `setRequestLocale` warns once, because the segment and the config disagree:

```ts
// verbaly.config.ts
export default {
  locales: ['en', 'es', 'pt'],
  routing: 'prefix-all', // every language has its segment: /en/…, /es/…, /pt/…
};
```

Then hand Verbaly the segment. This is what keeps the route statically rendered, because the
alternative is reading request headers:

```tsx
// app/[locale]/layout.tsx
import { setRequestLocale, getVerbalyProps, getAlternates } from '@verbaly/next/server';
import { VerbalyProvider } from '@verbaly/next/client';
import { locales } from 'virtual:verbaly';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { alternates: getAlternates({ path: `/${locale}`, baseUrl: 'https://example.com' }) };
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  setRequestLocale(locale); // before any getT() in this tree
  return <VerbalyProvider {...await getVerbalyProps()}>{children}</VerbalyProvider>;
}
```

Without `setRequestLocale`, Verbaly negotiates from the cookie and `Accept-Language`, and that read
is what makes the route dynamic. With it, no header is read at all.

**Keys are typed.** `getT()` and `useT()` check every key and its params against your catalog, and `getRequestLocale()` returns one of your locales, so `ogLocale[await getRequestLocale()]` needs no cast. The types live in `.verbaly/types.d.ts`, next to the generated modules and never committed; TypeScript skips a dot folder, so Verbaly adds that file to the `include` of your `tsconfig.json`, the way Next adds `.next/types`. On a fresh clone, `next typegen && tsc --noEmit` writes them before it checks them.

That's it. `next dev` extracts your messages live (catalogs and types stay fresh) and says in the terminal what it would otherwise do quietly: a hand edit of a text your code owns, a key written with two texts, a translation that is now older than its source. Each one is said once, and again if it goes away and comes back; a long list stays a few lines, and a catalog saved half-typed pauses live extraction with a one-line reason instead of stopping the server. `next build` reports missing, broken and unknown keys once it has compiled and goes on, so `next typegen`, which loads the same config, never meets the report, with Yarn PnP too; `verbaly check` is the gate for CI. Both say once when they start if a file outside your `include` writes a `` t`…` ``, which no build translates: in a project without `src/`, add `components/` there. With `failOnMissing: true` the build stops there instead, and the report prints once, above Next's own failure line. Dev and build show the same words: a text written in the code wins over the catalog in both.

The report rides on `compiler.runAfterProductionCompile`, and `withVerbaly` keeps any hook of your own there (yours runs first). A wrapper applied **outside** `withVerbaly` that replaces that hook instead of calling the one it got would silence the report, so keep `withVerbaly` outermost or compose the hook.

## 📖 Options

Second argument of `withVerbaly`: every [`verbaly.config`](https://www.npmjs.com/package/@verbaly/compiler) option, plus:

| Option          | What it does                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `cookie`        | Cookie read/written for the user's choice (default `verbaly-locale`); `false` = `Accept-Language` only. |
| `fallback`      | Locale when nothing matches (defaults to the source locale).                                            |
| `failOnMissing` | `true` stops `next build` on whatever fails `verbaly check`; by default the build reports and goes on.  |

- **Negotiation reads `headers()`/`cookies()`, which makes a route dynamic.** Call `setRequestLocale` with your `[locale]` segment and that read never happens, so the route prerenders. For a fully static site with no server at all, [`verbaly render`](https://www.npmjs.com/package/@verbaly/compiler) mirrors the output per locale.
- `getAlternates({ path, baseUrl? })` returns `{ canonical, languages }` for `generateMetadata`, the same hreflang set the static mirror writes. It is empty under `no-prefix` routing, where one URL answers every language.
- The generated `.verbaly/` directory is build output (it ships its own `.gitignore`).

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/frameworks/react#next](https://verbaly-web.vercel.app/docs/frameworks/react#next)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
