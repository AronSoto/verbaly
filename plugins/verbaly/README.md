# Verbaly for Claude

This plugin is the Verbaly Agent Skill. It teaches Claude the i18n cycle of a project that uses [Verbaly](https://github.com/AronSoto/verbaly): you write the text in your code, the compiler extracts it, `verbaly check` says what is missing or broken, and a translation a machine writes stays a draft until a person approves it. The skill also carries the rules that are easy to get wrong from the outside: keys are never invented by hand, `""` in a translation file means untranslated, and placeholders and tags survive a translation word for word.

## What it runs

Nothing. This plugin only carries instructions (`SKILL.md`). It starts no server, installs no package and sends nothing anywhere.

## The tools, in Claude Code

The skill works best next to the Verbaly MCP server, which runs the cycle as tools on your own machine. Add it with one line:

```bash
claude mcp add verbaly -- npx -y @verbaly/mcp
```

To get the skill and the server in one install instead, use the full plugin from the Verbaly marketplace:

```bash
claude plugin marketplace add AronSoto/verbaly
claude plugin install verbaly@verbaly
```

The full guide, with a line for every coding agent, is at <https://verbaly-web.vercel.app/docs/guide/agents>.

## License

MIT, like the rest of Verbaly.
