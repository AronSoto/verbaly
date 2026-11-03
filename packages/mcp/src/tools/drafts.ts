import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  effectiveDrafts,
  extractProject,
  loadCatalogs,
  loadState,
  shippedCatalogs,
} from '@verbaly/compiler';
import { z } from 'zod';
import { READS, reply, rootInput, type ToolContext } from './shared';

export function registerDrafts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_drafts',
    {
      title: 'Machine translations awaiting review',
      description:
        'Every machine translation still waiting for a human, each with the source text and what the provider wrote, so a person can read both and decide. Read-only. Approving is deliberately not a tool here and never will be: a machine translation is unreviewed by definition, so accepting one is `verbaly review --approve`, run by a human. For how many drafts each locale has, verbaly_status is enough; verbaly_missing lists them next to the gate.',
      inputSchema: {
        root: rootInput,
        locales: z.array(z.string()).optional().describe('Target locales (default: all)'),
      },
      outputSchema: {
        total: z.number(),
        entries: z.array(
          z.object({
            locale: z.string(),
            key: z.string(),
            source: z.string().describe('What the message says in the source locale'),
            translated: z.string().describe('What the provider wrote, still unreviewed'),
          }),
        ),
      },
      annotations: READS,
    },
    ctx.guarded(async ({ root, locales }) => {
      const cfg = await ctx.config(root);
      const catalogs = loadCatalogs(cfg);
      // the text that ships is the one a draft has to say again
      const shipped = shippedCatalogs(cfg, catalogs, await extractProject(cfg));
      const source = shipped[cfg.sourceLocale] ?? {};
      const pending = effectiveDrafts(loadState(cfg).drafts, catalogs);
      const wanted = locales ?? cfg.locales;
      const entries = Object.entries(pending)
        .filter(([locale]) => wanted.includes(locale))
        .flatMap(([locale, keys]) =>
          keys.map((key) => ({
            locale,
            key,
            source: source[key] ?? '',
            translated: catalogs[locale]?.[key] ?? '',
          })),
        );
      const body = entries.length
        ? entries
            .map(
              (e) => `[${e.locale}] ${e.key}
  source: ${e.source}
  draft:  ${e.translated}`,
            )
            .join('\n')
        : 'nothing awaiting review';
      return reply(body, { total: entries.length, entries });
    }),
  );
}
