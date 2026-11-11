import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { counted, formatFinding, syncProject } from '@verbaly/compiler';
import { z } from 'zod';
import {
  byLocale,
  lockOf,
  lockOutput,
  perLocale,
  relativeTo,
  reply,
  rootInput,
  sourceSite,
  writes,
  type ToolContext,
} from './shared';

export function registerExtract(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_extract',
    {
      title: 'Extract messages',
      description:
        'Scan the source files, add new messages to the locale catalogs and refresh the generated types (what `verbaly extract` does). It writes the catalogs unless dryRun is set, and with the same code a second run changes nothing. prune also drops keys the code no longer references, translations included, and waits while any source file fails to parse. In a project without Verbaly, run verbaly_init first; for text still hardcoded in JSX, verbaly_wrap.',
      inputSchema: {
        root: rootInput,
        prune: z
          .boolean()
          .optional()
          .describe('Drop keys no longer referenced (deletes their translations)'),
        dryRun: z.boolean().optional().describe('Report what would change, write nothing'),
      },
      outputSchema: {
        messages: z.number().describe('Messages the source catalog holds after this run'),
        inCode: z
          .number()
          .describe(
            'How many of those messages the code writes as text: 0 when the project keeps its text in the catalog and reads it with t(key)',
          ),
        locales: z.array(z.string()),
        dryRun: z.boolean(),
        added: perLocale,
        pruned: perLocale,
        unparsed: z
          .array(z.object({ file: z.string(), message: z.string() }))
          .describe(
            'Source files the parser could not read: their messages are not extracted, and prune drops nothing until they parse',
          ),
        collisions: z
          .array(z.object({ key: z.string(), sites: z.array(sourceSite) }))
          .describe(
            'Keys written with more than one text: every place shows the text of the first site, so give each text its own key',
          ),
        renamed: z
          .array(z.object({ file: z.string(), line: z.number().optional(), name: z.string() }))
          .describe(
            'Tagged templates on t under another name (const tr = useT()): never extracted, so they stay in the source language until the binding is named t',
          ),
        replaced: z
          .array(z.object({ key: z.string(), before: z.string(), code: sourceSite }))
          .describe(
            'Source texts the code wrote over: before is what the catalog said, code is the text that ships. An edit made in the code reads like this too',
          ),
        positional: z
          .array(z.object({ params: z.array(z.string()), code: sourceSite }))
          .describe(
            'Messages that hand a translator a nameless value like {_0}: put the value in a named variable first',
          ),
        escaped: z
          .array(z.object({ slice: z.string(), code: sourceSite }))
          .describe(
            'Plural or format blocks inside a tagged template, which render as literal text',
          ),
        stateProblem: z
          .string()
          .optional()
          .describe(
            'The state file could not be read or written: the catalogs were written, drafts and outdated tracking were not',
          ),
        lock: lockOutput,
      },
      annotations: writes(true),
    },
    ctx.guarded(async ({ root, prune, dryRun }) => {
      const cfg = await ctx.config(root);
      const result = await syncProject(cfg, { prune, dryRun });
      const rel = relativeTo(cfg.root);
      const at = (code: { file: string; line?: number; message: string }) => ({
        ...code,
        file: rel(code.file),
      });
      // an agent sees no terminal, so what the CLI prints about these has to be in the answer
      const data = {
        messages: result.messages,
        inCode: result.inCode,
        locales: cfg.locales,
        dryRun: dryRun === true,
        added: byLocale(result.added),
        pruned: byLocale(result.pruned),
        unparsed: [] as { file: string; message: string }[],
        collisions: [] as { key: string; sites: ReturnType<typeof at>[] }[],
        renamed: [] as { file: string; line?: number; name: string }[],
        replaced: [] as { key: string; before: string; code: ReturnType<typeof at> }[],
        positional: [] as { params: string[]; code: ReturnType<typeof at> }[],
        escaped: [] as { slice: string; code: ReturnType<typeof at> }[],
        ...(result.stateProblem && { stateProblem: result.stateProblem }),
        ...lockOf(result.findings, rel),
      };
      for (const finding of result.findings) {
        if (finding.kind === 'unparsed')
          data.unparsed.push({ file: rel(finding.file), message: finding.message });
        else if (finding.kind === 'collision')
          data.collisions.push({ key: finding.key, sites: finding.sites.map(at) });
        else if (finding.kind === 'renamed')
          data.renamed.push({ ...finding, file: rel(finding.file) });
        else if (finding.kind === 'replaced')
          data.replaced.push({ key: finding.key, before: finding.before, code: at(finding.site) });
        else if (finding.kind === 'positional')
          data.positional.push({ params: finding.params, code: at(finding.site) });
        else if (finding.kind === 'escaped')
          data.escaped.push({ slice: finding.slice, code: at(finding.site) });
      }

      const lines = [
        `${counted(data.messages, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      ];
      if (result.pruneBlocked) {
        lines.push(
          'prune skipped: an unparsed file may read any key, so it waits until every file parses',
        );
      }
      for (const { locale, keys } of data.pruned) {
        lines.push(
          dryRun
            ? `${locale}: would prune ${keys.length}: ${keys.join(', ')}`
            : `${locale}: ${keys.length} pruned`,
        );
      }
      for (const { locale, keys } of data.added) {
        lines.push(`${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length} added`}`);
      }
      for (const finding of result.findings) lines.push(formatFinding(finding, cfg.root));
      if (result.stateProblem) {
        lines.push(`${result.stateProblem}, so drafts and outdated translations were not updated`);
      }
      return reply(lines.join('\n'), data);
    }),
  );
}
