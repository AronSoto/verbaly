# Verbaly for Claude

This plugin is the Verbaly Agent Skill. It teaches Claude the i18n cycle of a project that uses [Verbaly](https://github.com/verbaly-i18n/verbaly): you write the text in your code, the compiler extracts it, `verbaly check` says what is missing or broken, and a translation a machine writes stays a draft until a person approves it. The skill also carries the rules that are easy to get wrong from the outside: keys are never invented by hand, `""` in a translation file means untranslated, and placeholders and tags survive a translation word for word.

## What it runs

The plugin itself runs nothing. It only carries instructions (`SKILL.md`): it starts no server, installs no package and sends nothing anywhere.

**What can leave your machine.** The skill can ask Claude, in Claude Code or Cowork, to run `npx verbaly translate` in your project. That command, not this plugin, sends the texts to translate to the provider your Verbaly config names: Claude by default, through your own `ANTHROPIC_API_KEY`. It runs only when asked, and every translation it writes stays a draft until a person approves it. Nothing else the skill asks for sends data anywhere.

## The tools, in Claude Code

The skill works best next to the Verbaly MCP server, which runs the cycle as tools on your own machine. Add it with one line:

```bash
claude mcp add verbaly -- npx -y @verbaly/mcp
```

To get the skill and the server in one install instead, use the full plugin from the Verbaly marketplace:

```bash
claude plugin marketplace add verbaly-i18n/verbaly
claude plugin install verbaly@verbaly
```

The full guide, with a line for every coding agent, is at <https://verbaly.dev/docs/guide/agents>.

## License

MIT, like the rest of Verbaly.
