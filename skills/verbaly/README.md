# Verbaly for coding agents

This folder is the Verbaly Agent Skill, and also the Verbaly plugin for Claude Code and for Cursor, with the same skill and the same server in both. It teaches an agent the i18n cycle of a project that uses [Verbaly](https://github.com/AronSoto/verbaly): write the text in the code, extract it, check what is missing or broken, and translate. Machine translations are saved as drafts, and only a person can approve them.

## What it runs

- **The skill** (`SKILL.md`): instructions the agent reads. It runs nothing by itself.
- **The MCP server** (`@verbaly/mcp`, started with `npx` at the version of this release): it runs on your machine, reads your `verbaly.config`, your translation files and your source code, and writes the translation files, the generated types and `verbaly.lock`. It needs no account and opens no port.
- **What leaves your machine:** only `verbaly_translate`, and only when you call it, sends the messages to translate to the provider your config names. The default is Claude, through `ANTHROPIC_API_KEY`. The other tools stay local.

## Install

In Claude Code:

```bash
claude plugin marketplace add AronSoto/verbaly
claude plugin install verbaly@verbaly
```

In Cursor, the plugin is described by `.cursor-plugin/plugin.json` in this folder, and it starts the server from `mcp.json`.

The skill alone, for any agent: `npx skills add AronSoto/verbaly`. The full guide is at <https://verbaly.dev/docs/guide/agents>.

## License

MIT, like the rest of Verbaly.
