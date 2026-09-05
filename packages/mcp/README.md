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

| Tool                | What it does                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verbaly_init`      | Create the config and the catalogs, and detect the bundler or meta-framework so the answer names what to add. Writes files, keeps what is already there. |
| `verbaly_doctor`    | Diagnose the whole setup: config, catalogs, plugin, types, unreadable files, orphan keys, every gate failure. Start here. Read-only.                     |
| `verbaly_wrap`      | Find hardcoded text in JSX/TSX and wrap it so the compiler can extract it. This is how an existing codebase is onboarded.                                |
| `verbaly_extract`   | Scan sources, add new messages to the catalogs, refresh the generated types. `dryRun` previews; `prune` drops dead keys.                                 |
| `verbaly_status`    | Coverage per locale: total messages, translated counts, drafts awaiting review. Read-only.                                                               |
| `verbaly_missing`   | Missing translations, unknown keys and broken ones (the same gate `verbaly check` runs in CI). Read-only.                                                |
| `verbaly_translate` | Fill missing entries with the configured provider (default: Claude). Output is saved as drafts awaiting human review.                                    |
| `verbaly_drafts`    | Every machine translation still waiting for a human, each with its source text and what the provider wrote. Read-only, and it cannot approve.            |

Machine translations stay drafts until a human accepts them (`verbaly review --approve`), so an agent can fill gaps without silently shipping unreviewed text. **No tool here can approve a draft**, on purpose. `verbaly_drafts` is the other half of that promise: it shows each one next to its source, so the human deciding can actually read what they are accepting.

## 📖 Resources

Reading the project is an address, not a call, so these cost no tool invocation:

| Resource                     | What it holds                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `verbaly://config`           | Source locale, every locale, the catalog directory and where the language lives in the url. Read it first. |
| `verbaly://catalog/{locale}` | Every message of one locale, flattened the way the runtime reads it. An empty value means untranslated.    |

**This is the only way to read what a message says.** Every tool works in keys and counts, which is enough to report a gap and not enough to review a translation or write one in context.

`verbaly_translate` never loses work it already paid for: a batch the provider does not answer is retried, and if it still fails it comes back in `failed` with its keys while everything else is written. Retrying asks only for what is left.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/guide/agents](https://verbaly-web.vercel.app/docs/guide/agents)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
