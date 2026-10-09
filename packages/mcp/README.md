<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>MCP server for Verbaly: setup, diagnosis, onboarding, extraction, coverage and machine translation as tools for coding agents, plus resources that let them read your catalogs.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/mcp"><img src="https://img.shields.io/npm/v/@verbaly/mcp?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/mcp?color=blue" alt="MIT" /></a>
</p>

---

Your coding agent (Claude Code, Cursor, or any MCP client) gets first-class access to the Verbaly cycle: it can diagnose the setup, wrap hardcoded text in an existing codebase, extract new messages, read the coverage, list exactly what is missing and machine-translate the gaps, all against your real `verbaly.config` and catalogs. No shell parsing, no guessed file paths.

Every tool answers with **structured output** as well as text, so an agent reads numbers and lists instead of parsing a sentence that may be worded differently next release.

## 🚀 Install

```bash
claude mcp add verbaly -- npx -y @verbaly/mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "verbaly": { "command": "npx", "args": ["-y", "@verbaly/mcp"] }
  }
}
```

The server reads the project from its working directory; pass `--root <path>` (or the per-tool `root` argument) to point elsewhere.

## 🧰 Tools

| Tool                | What it does                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verbaly_init`      | Create the config and the catalogs, and detect the bundler or meta-framework so the answer names what to add. Writes files, keeps what is already there, and writes `pt-BR` for a `pt_BR` it was given. |
| `verbaly_doctor`    | Diagnose the whole setup: config, catalogs, plugin, types, unreadable files, orphan keys, every gate failure. Start here. Read-only.                                                                    |
| `verbaly_wrap`      | Find hardcoded text in JSX/TSX and wrap it so the compiler can extract it. This is how an existing codebase is onboarded.                                                                               |
| `verbaly_extract`   | Scan sources, add new messages to the catalogs, refresh the generated types. `dryRun` previews; `prune` drops dead keys and their drafts, and waits while any file does not parse. Names, with file and line, everything `verbaly extract` prints: files it could not read, keys written with two texts, `t` used under another name, source texts the code wrote over (with the text they had), and values a translator would see as `{_0}`. |
| `verbaly_status`    | Coverage per locale: total messages, translated counts, drafts awaiting review, translations written for an older source text. A state file it cannot read is reported in `stateProblem`, never as a failed call. Read-only.                                                              |
| `verbaly_missing`   | Missing translations, unknown keys and broken ones (the same gate `verbaly check` runs in CI), plus what never fails it: keys only a translation has, keys with two texts, a catalog that contradicts the code, outdated translations. Every path is relative to the project, as in `verbaly_extract`. Read-only. |
| `verbaly_translate` | Fill missing entries with the configured provider (default: Claude). Output is saved as drafts awaiting human review.                                                                                   |
| `verbaly_write_drafts` | Save translations the agent wrote itself. Each one is checked like a provider's (params, tags and plural cases must survive) against the text that ships, the one `verbaly_missing` reads, written only for keys the source has, marked as a draft and stamped for that text, so a source that changes later shows it as outdated. `overwrite` rewrites an outdated one. |
| `verbaly_drafts`    | Every machine translation still waiting for a human, each with its source text and what the provider wrote. Read-only, and it cannot approve.                                                           |

Machine translations stay drafts until a human accepts them (`verbaly review --approve`), so an agent can fill gaps without silently shipping unreviewed text. **No tool here can approve a draft**, on purpose. That includes the agent's own work: `verbaly_write_drafts` is how it lands without anyone editing a catalog or `.verbaly-state.json` by hand, and it lands as a draft. `verbaly_drafts` is the other half of that promise: it shows each one next to its source, so the human deciding can actually read what they are accepting. Approving lives where a person is looking at the text: `verbaly review --approve`, or [`@verbaly/studio`](https://www.npmjs.com/package/@verbaly/studio).

## 📖 Resources

Reading the project is an address, not a call, so these cost no tool invocation:

| Resource                     | What it holds                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `verbaly://config`           | Source locale, every locale, the catalog directory and where the language lives in the url. Read it first. |
| `verbaly://catalog/{locale}` | Every message of one locale, flattened the way the runtime reads it, with the text your code ships where the code owns it. An empty value means untranslated. |

**This is the only way to read what a message says.** Every tool works in keys and counts, which is enough to report a gap and not enough to review a translation or write one in context.

`verbaly_translate` never loses work it already paid for: a batch the provider does not answer is retried, and if it still fails it comes back in `failed` with its keys while everything else is written. Retrying asks only for what is left. It never loses a person's work either: a message someone wrote on disk while the provider was working is left as written and comes back in `kept`.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/guide/agents](https://verbaly-web.vercel.app/docs/guide/agents)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
