<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>MCP server for Verbaly: diagnosis, onboarding, extraction, coverage and machine translation as tools for coding agents.</em></p>

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

| Tool                | What it does                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `verbaly_doctor`    | Diagnose the whole setup: config, catalogs, plugin, types, unreadable files, orphan keys, every gate failure. Start here. Read-only. |
| `verbaly_wrap`      | Find hardcoded text in JSX/TSX and wrap it so the compiler can extract it. This is how an existing codebase is onboarded.            |
| `verbaly_extract`   | Scan sources, add new messages to the catalogs, refresh the generated types. `dryRun` previews; `prune` drops dead keys.             |
| `verbaly_status`    | Coverage per locale: total messages, translated counts, drafts awaiting review. Read-only.                                           |
| `verbaly_missing`   | Missing translations, unknown keys and broken ones (the same gate `verbaly check` runs in CI). Read-only.                            |
| `verbaly_translate` | Fill missing entries with the configured provider (default: Claude). Output is saved as drafts awaiting human review.                |

Machine translations stay drafts until a human accepts them (`verbaly review --approve`), so an agent can fill gaps without silently shipping unreviewed text. **No tool here can approve a draft**, on purpose.

`verbaly_translate` never loses work it already paid for: a batch the provider does not answer is retried, and if it still fails it comes back in `failed` with its keys while everything else is written. Retrying asks only for what is left.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs/guide/agents](https://verbaly-web.vercel.app/docs/guide/agents)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
