<p align="center">
  <img src="https://raw.githubusercontent.com/AronSoto/verbaly/develop/assets/logo.png" alt="Verbaly" width="300" />
</p>

<p align="center"><em>MCP server for Verbaly: translation status, missing keys, extraction and machine translation as tools for coding agents.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verbaly/mcp"><img src="https://img.shields.io/npm/v/@verbaly/mcp?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/AronSoto/verbaly/blob/develop/LICENSE"><img src="https://img.shields.io/npm/l/@verbaly/mcp?color=blue" alt="MIT" /></a>
</p>

---

Your coding agent (Claude Code, Cursor, or any MCP client) gets first-class access to the Verbaly cycle: it can see the translation coverage, list exactly what's missing, extract new messages and machine-translate the gaps, all against your real `verbaly.config` and catalogs. No shell parsing, no guessed file paths.

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

| Tool                | What it does                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `verbaly_status`    | Coverage per locale: total messages, translated counts, drafts awaiting review. Read-only.                                |
| `verbaly_missing`   | Missing translations and unknown keys (the same gate `verbaly check` runs in CI). Read-only.                              |
| `verbaly_extract`   | Scan sources, add new messages to the catalogs, refresh the generated types. `dryRun` previews; `prune` drops dead keys.  |
| `verbaly_translate` | Fill missing entries with the configured provider (default: Claude). Output is saved as drafts awaiting human review.     |

Machine translations stay drafts until a human accepts them (`verbaly review --approve`), so an agent can fill gaps without silently shipping unreviewed text.

## 📚 Docs

Full guide: [verbaly-web.vercel.app/docs](https://verbaly-web.vercel.app/docs)

## License

[MIT](https://github.com/AronSoto/verbaly/blob/develop/LICENSE) © Aron Soto
