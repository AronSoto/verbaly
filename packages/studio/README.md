<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>A local review server over the translation files already in your repo. No account, no database, no deploy.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/studio"><img src="https://img.shields.io/npm/v/@verbaly/studio?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/studio?color=blue" alt="MIT" /></a>
</p>

---

Your JSON catalogs are the database and git is the history. Studio is a window onto them, which is
why it cannot fall out of sync with your code: it does not own anything.

> **The panel is here.** `npx verbaly-studio` opens a page that shows every message in your project,
> in as many languages as you tick, with its state on each one. You edit in the row itself, you mark
> what a machine wrote as read, you read what `verbaly doctor` found, and you run the two commands
> that change your catalogs: finding new text in your code, and translating what is missing.

> **Studio edits translations. It never edits the source text.** The source lives in your code and
> the key derives from it, so editing it here would be undone by the next `verbaly extract`. A write
> to the source locale is refused, and so is a key the source catalog does not have.

## 🚀 Install

```bash
pnpm add -D @verbaly/studio
```

```bash
npx verbaly-studio

#   Verbaly Studio   http://127.0.0.1:4747/?t=kQ7pVn2XsL4b
#   Project          /home/you/app
#   Catalog          1619 messages · 212 untranslated · 187 drafts
#
#   Ctrl+C to stop
```

| Flag | What it does |
|------|--------------|
| `--root <path>` | point at another project instead of the working directory |
| `--port <n>` | start somewhere other than 4747; a busy port climbs to the next free one |
| `--json` | print the whole state to stdout and exit, no server |

`--json` is the panel without the panel: the same object the interface reads, so it can be piped,
diffed and scripted. Opening the printed url gets you the screen instead.

## 🔒 Security, which is not optional for a server that writes files

Any page open in your browser can talk to a local server, so three defenses ship on by default:

- it binds to `127.0.0.1`, never `0.0.0.0`
- the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, which is what stops a DNS rebind
- a 72-bit token is minted per boot, rides in the url the command prints and is compared in constant
  time, and a cross `Origin` is refused even when the token is right

Requests are capped at 1 MB, and the absolute path of your project is stripped out of every error
before it reaches the browser. On a non-default port the `Host` check requires it; on port 80 it
accepts the name alone, because that is what a browser sends.

## 🧰 The API

Every route calls the same compiler function the CLI calls, so there is no second implementation to
keep in step. Every answer is JSON, including the errors, which are `{ "error": "[verbaly] …" }`.

| Method and route | What it does |
|---|---|
| `GET /api/state` | the whole project: config, catalogs, origins, status, check, drafts, triage and problems |
| `GET /api/health` | what `verbaly doctor` reports |
| `GET /api/commit/:key` | the commit that last changed that message, or why there is none |
| `PUT /api/message/:locale/:key` | write a translation **and clear its draft flag**; body `{ "text": "…" }` |
| `POST /api/approve` | approve drafts; body `{ "locale": "es", "keys": ["…"] }`, and the whole locale when `keys` is omitted |
| `POST /api/extract` | read your code and add what your catalogs do not have; answers in the request, because it is local and free |
| `GET /api/translate` | **the bill**: how many messages and in which languages, without calling the provider |
| `POST /api/translate` | start the run and get back a job; body `{ "locales": ["es"] }` |
| `GET /api/job/:id` | how that run is going, to ask once a second |
| `GET /api/job` | the run in progress, or `null`; a reloaded page asks this instead of losing the bar |

`GET /api/state` is unpaginated on purpose: the biggest catalog we know is more than 1600 messages, and over
localhost that is instant. Its `problems` array is why nothing Studio reads can take the server
down: a catalog it cannot parse, a drafts sidecar it cannot parse, a source file Babel cannot read,
and a `--root` with no catalogs in it are all reported there, by a path relative to your project,
and the rest is served. Studio is what you open to fix those files.

A write runs the same two validations `verbaly check` runs, so a translation that lost a `{param}`,
a tag, or the `other` case of a plural is refused with the reason instead of failing your CI later.
Whitespace is stored as the empty string, because that is what untranslated means everywhere else.

**A write clears the draft flag** because a human wrote it, the same rule `verbaly import` already
applies. Without it you would fix a bad machine translation by hand and `verbaly check --drafts`
would keep failing on your own text.

**Studio can approve and `@verbaly/mcp` deliberately cannot, and that is not a contradiction.** The
MCP server is the agent's hands, and an agent approving its own translation is the safeguard
approving itself. Studio is the human's: it exists to put the source text and the translation in
front of a person. The token is what keeps that true, so treat it as the thing that says a person is
here, and do not paste it into an agent's prompt.

**Translating is the one thing here that spends money, so the panel shows the bill first.** The
plan is its own route, which is why looking at the cost cannot start the spending: it says how
many messages and in which languages, and nothing is called until you say go. The run itself is a
job you ask about rather than a stream you listen to, because `verbaly translate` writes partial
results on purpose and a reload must not lose them. **One run at a time**: two runs over the same
catalogs is a race over the same files.

**What a machine writes stays a draft**, here as everywhere else. The panel does not get to change
that rule, so a finished run leaves you a list to read, not a job marked done.

**`GET /api/commit/:key` answers about values, not about lines.** It walks your catalogs' history
once and remembers, per message, the newest commit where that message's text really differs from its
parent's. `git blame` is the obvious way to ask and it is wrong here: adding a key rewrites the
previous line's comma, so blame blames that commit, which on our own site is 26 messages in every
100. When there is no answer the route says which of the three reasons applies, because "never
committed", "older than the history I read" and "there is no git here" are three different facts.

## 🔎 Triage: which machine translations are worth reading

Adding a language writes hundreds of drafts at once, and reading them one by one is a wall. Walls
are how a safeguard turns into something people route around, so Studio ranks instead of queuing.

`check` already caught the structure, so a lost `{param}` or tag never reaches this: what is left is
meaning, which nothing can measure. These signals do not score a translation, they point at the few
worth a human eye:

| Signal | What it means |
|---|---|
| `divergent` | the same source text was already rendered two ways by a reviewed locale, so the English is ambiguous |
| `collision` | the fallback when no reviewed locale can tell: one source text came back as two translations here |
| `echo` | still identical to the source, while every reviewed locale did translate it |
| `digits` | a number the source has came back changed, ignoring decimal separators and trailing punctuation |
| `url` | a URL changed |
| `code` | the contents of a `<code>` span changed |

A locale that still carries drafts is never used as the reviewed control, and neither is a blank:
an unfinished translation is not a second opinion.

**Every signal here was measured against this project's own site before it shipped, and two of them
changed because of what the measurement said.** `digits` was reading the comma after a number as
part of it, and it was flagging a number the translation added where the source had none, which is
what "refresh" becoming "F5" looks like. Those were **10 of 10** of its hits, all correct text, so
both are now excluded. The result is **21 messages** flagged in Spanish and 20 in Portuguese.

## 🧩 Programmatic API

```ts
import { startStudio } from '@verbaly/studio';

const studio = await startStudio(await loadConfig(process.cwd()), { port: 0 });
console.log(studio.url);
await studio.close();
```

`startStudio(cfg, options)` returns `{ server, port, token, url, close }`, and
`createStudioApp(cfg, port, token)` is the bare request handler for mounting it somewhere else.
Nothing else is public.

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
