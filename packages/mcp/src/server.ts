import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  check,
  collectOrigins,
  counted,
  effectiveDrafts,
  extractProject,
  formatCheckResult,
  formatCheckWarnings,
  formatStatusResult,
  loadCatalogs,
  loadConfig,
  loadDrafts,
  markDrafts,
  pruneCatalogs,
  resolveProvider,
  saveDrafts,
  status,
  syncCatalogs,
  translateCatalogs,
  writeCatalog,
  writeDts,
  type ResolvedConfig,
} from '@verbaly/compiler';
import { createRequire } from 'node:module';
import { z } from 'zod';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface VerbalyMcpOptions {
  root?: string;
}

const text = (body: string): CallToolResult => ({ content: [{ type: 'text', text: body }] });

const rootInput = z
  .string()
  .optional()
  .describe('Project root holding verbaly.config (defaults to the server working directory)');

export function createVerbalyMcp(options: VerbalyMcpOptions = {}): McpServer {
  const server = new McpServer({ name: 'verbaly', version });

  const config = (root?: string): Promise<ResolvedConfig> =>
    loadConfig(root ?? options.root ?? process.cwd());

  // agents act on messages, not stack traces: every failure comes back as actionable text
  const guarded =
    <A>(run: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return await run(args);
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    };

  server.registerTool(
    'verbaly_status',
    {
      title: 'Translation coverage',
      description:
        'Translation coverage of the Verbaly project: total messages, translated count per locale and machine translations awaiting review (drafts). Read-only.',
      inputSchema: { root: rootInput },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const result = status(cfg, loadCatalogs(cfg), registry, loadDrafts(cfg));
      return text(formatStatusResult(result));
    }),
  );

  server.registerTool(
    'verbaly_missing',
    {
      title: 'Missing and broken translations',
      description:
        'List missing translations, unknown keys and translations that exist but cannot render what the source renders (a dropped {param}, a lost rich tag, a flattened plural block), the same gate `verbaly check` runs in CI. Warnings such as an incomplete plural set for the locale are listed too and do not fail the gate. Optionally also lists machine translations awaiting review. Read-only.',
      inputSchema: {
        root: rootInput,
        drafts: z
          .boolean()
          .optional()
          .describe('Also list machine translations awaiting human review'),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root, drafts }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);
      const result = check(cfg, catalogs, registry);
      const unreviewed = drafts ? Object.entries(effectiveDrafts(loadDrafts(cfg), catalogs)) : [];

      const lines: string[] = [];
      if (!result.ok) lines.push(formatCheckResult(result));
      const warnings = formatCheckWarnings(result);
      if (warnings) lines.push(`warnings (the gate still passes):\n${warnings}`);
      for (const [locale, keys] of unreviewed) {
        if (keys.length) lines.push(`[${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`);
      }
      if (lines.length === 0) return text('all translations complete');
      return text(lines.join('\n'));
    }),
  );

  server.registerTool(
    'verbaly_extract',
    {
      title: 'Extract messages',
      description:
        'Scan the source files, add new messages to the locale catalogs and refresh the generated types (what `verbaly extract` does). Writes catalog files unless dryRun is set. prune drops keys no longer referenced in the code, translations included.',
      inputSchema: {
        root: rootInput,
        prune: z
          .boolean()
          .optional()
          .describe('Drop keys no longer referenced (deletes their translations)'),
        dryRun: z.boolean().optional().describe('Report what would change, write nothing'),
      },
    },
    guarded(async ({ root, prune, dryRun }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);

      const lines: string[] = [];
      if (prune) {
        const removed = pruneCatalogs(cfg, catalogs, registry);
        for (const [locale, keys] of Object.entries(removed)) {
          lines.push(
            dryRun
              ? `${locale}: would prune ${keys.length}: ${keys.join(', ')}`
              : `${locale}: ${keys.length} pruned`,
          );
        }
      }
      const { added } = syncCatalogs(cfg, catalogs, registry);
      if (!dryRun) {
        for (const locale of cfg.locales) {
          writeCatalog(cfg, locale, catalogs[locale] ?? {});
        }
        if (cfg.dts !== false) writeDts(cfg, catalogs[cfg.sourceLocale] ?? {}, cfg.dts);
      }
      lines.unshift(
        `${counted(registry.messages().size, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      );
      for (const [locale, keys] of Object.entries(added)) {
        lines.push(`${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length} added`}`);
      }
      return text(lines.join('\n'));
    }),
  );

  server.registerTool(
    'verbaly_translate',
    {
      title: 'Machine-translate missing entries',
      description:
        'Fill missing translations with the configured provider (default: Claude, needs @anthropic-ai/sdk and ANTHROPIC_API_KEY). New translations are saved as drafts awaiting human review (`verbaly review`). dryRun lists what would be translated without calling the provider.',
      inputSchema: {
        root: rootInput,
        locales: z.array(z.string()).optional().describe('Target locales (default: all)'),
        dryRun: z
          .boolean()
          .optional()
          .describe('List missing entries per locale, call no provider'),
      },
    },
    guarded(async ({ root, locales, dryRun }) => {
      const cfg = await config(root);
      const catalogs = loadCatalogs(cfg);
      const provider = await resolveProvider(cfg);
      const result = await translateCatalogs(cfg, catalogs, provider, {
        locales,
        batchSize: cfg.translate.batchSize,
        dryRun,
        origins: dryRun ? undefined : await collectOrigins(cfg),
      });

      if (dryRun) {
        const entries = Object.entries(result.pending);
        if (entries.length === 0) return text('nothing to translate');
        return text(
          entries
            .map(([locale, keys]) => `${locale}: ${keys.length} missing: ${keys.join(', ')}`)
            .join('\n'),
        );
      }

      const lines: string[] = [];
      const drafts = loadDrafts(cfg);
      for (const locale of Object.keys(result.translated)) {
        writeCatalog(cfg, locale, catalogs[locale] ?? {});
        markDrafts(drafts, locale, result.translated[locale]!);
        lines.push(`${locale}: +${result.translated[locale]!.length} translated (draft)`);
      }
      if (Object.keys(result.translated).length > 0) saveDrafts(cfg, drafts);
      for (const [locale, keys] of Object.entries(result.invalid)) {
        lines.push(
          `${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
        );
      }
      if (lines.length === 0) return text('nothing to translate');
      lines.push('drafts await human review: verbaly review (--approve accepts them)');
      return text(lines.join('\n'));
    }),
  );

  return server;
}
