import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  check,
  collectOrigins,
  counted,
  doctor,
  effectiveDrafts,
  extractProject,
  formatCheckResult,
  formatCheckWarnings,
  formatDoctorEntry,
  formatStatusResult,
  formatTranslateFailures,
  init,
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
  wrapProject,
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

// text stays the fallback for a client that reads no schema, structuredContent is what agents parse
const reply = (body: string, data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: body }],
  structuredContent: data,
});

const rootInput = z
  .string()
  .optional()
  .describe('Project root holding verbaly.config (defaults to the server working directory)');

const perLocale = z.array(z.object({ locale: z.string(), keys: z.array(z.string()) }));

// a locale-keyed record is a dynamic schema an agent cannot read ahead: lists enumerate
const byLocale = (record: Record<string, string[]>): Array<{ locale: string; keys: string[] }> =>
  Object.entries(record).map(([locale, keys]) => ({ locale, keys }));

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

  // resources, not tools: reading the project is an address, and it must not spend a tool call
  server.registerResource(
    'verbaly-config',
    'verbaly://config',
    {
      title: 'Project shape',
      description:
        'The resolved Verbaly config: source locale, every locale, the catalog directory and where the language lives in the url. Read this before reasoning about anything else in the project.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const cfg = await config();
      const shape = {
        root: cfg.root,
        sourceLocale: cfg.sourceLocale,
        locales: cfg.locales,
        localesDeclared: cfg.localesDeclared,
        dir: cfg.dir,
        routing: cfg.routing,
        include: cfg.include,
      };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(shape, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'verbaly-catalog',
    new ResourceTemplate('verbaly://catalog/{locale}', {
      list: async () => {
        const cfg = await config();
        return {
          resources: cfg.locales.map((locale) => ({
            name: `${locale} catalog`,
            uri: `verbaly://catalog/${locale}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Locale catalog',
      description:
        'Every message of one locale, keyed the way the runtime sees them: a nested catalog arrives flattened, and an empty value means untranslated. This is the only way to read what a message actually says.',
      mimeType: 'application/json',
    },
    async (uri, { locale }) => {
      const cfg = await config();
      const name = String(locale);
      if (!cfg.locales.includes(name)) {
        const have = cfg.locales.join(', ');
        throw new Error(`[verbaly] unknown locale "${name}": the project has ${have}`);
      }
      const catalog = loadCatalogs(cfg)[name] ?? {};
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'verbaly_init',
    {
      title: 'Set up Verbaly in a project',
      description:
        'Create the config file and the locale catalogs, and detect the bundler or meta-framework so the answer names the package to add and the line to wire (what `verbaly init` does). Writes files, and a file already there is kept rather than overwritten. Run this when doctor says there is no config.',
      inputSchema: {
        root: rootInput,
        dir: z.string().optional().describe('Directory for the catalogs (default: locales)'),
        sourceLocale: z.string().optional().describe('The language you write in (default: en)'),
        locales: z.array(z.string()).optional().describe('Every locale, source included'),
      },
      outputSchema: {
        created: z.array(z.string()).describe('Files written, relative to the project root'),
        skipped: z.array(z.string()).describe('Files already there, left untouched'),
        host: z
          .string()
          .optional()
          .describe('Bundler or meta-framework detected from the dependencies'),
        configFile: z.string(),
        next: z.array(z.string()).describe('What a human still has to do, in order'),
      },
    },
    guarded(async ({ root, dir, sourceLocale, locales }) => {
      const result = await init({ root: root ?? options.root, dir, sourceLocale, locales });
      const lines: string[] = [];
      if (result.created.length) lines.push(`created: ${result.created.join(', ')}`);
      if (result.skipped.length) lines.push(`kept (already there): ${result.skipped.join(', ')}`);
      if (result.host) lines.push(`detected: ${result.host}`);
      lines.push(...result.next.map((step, i) => `${i + 1}. ${step}`));
      return reply(lines.join('\n'), { ...result });
    }),
  );

  server.registerTool(
    'verbaly_doctor',
    {
      title: 'Diagnose the setup',
      description:
        'Diagnose a Verbaly project end to end (what `verbaly doctor` does): the config file, the catalog files and their JSON, the bundler plugin for the detected framework, the generated types, files the parser could not read, t imported from a package that never exports it, orphan keys, and every failure `verbaly check` would report. Run this first when something does not work. Read-only.',
      inputSchema: { root: rootInput },
      outputSchema: {
        ok: z.boolean().describe('False when an entry is an error, which is when the CLI exits 1'),
        entries: z.array(
          z.object({
            level: z.enum(['ok', 'warn', 'error']),
            check: z.string(),
            message: z.string(),
            fix: z.string().optional().describe('What to run or change, when there is one'),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root }) => {
      const cfg = await config(root);
      const result = await doctor(cfg);
      const health = result.ok ? 'setup looks healthy' : 'problems found';
      const head = `${counted(result.entries.length, 'check')}, ${health}`;
      return reply([head, ...result.entries.map(formatDoctorEntry)].join('\n'), { ...result });
    }),
  );

  server.registerTool(
    'verbaly_wrap',
    {
      title: 'Wrap hardcoded JSX text',
      description:
        'Find hardcoded user-visible text in JSX/TSX files and wrap it in a t tagged template so the compiler can extract it (what `verbaly wrap` does). This is how an existing codebase is onboarded. Reports only unless write is set. Text it cannot wrap safely (a sentence split across markup, an expression rendering JSX) is listed as needing a human and never rewritten. A file that does not bind t is never written either, because the rewrite would not compile: those come back in blocked, with whether the file is a client component, so you can add the binding and run again.',
      inputSchema: {
        root: rootInput,
        write: z.boolean().optional().describe('Apply the rewrites instead of only reporting'),
      },
      outputSchema: {
        files: z.number().describe('JSX/TSX files scanned'),
        write: z.boolean(),
        changed: z.array(z.string()).describe('Files the rewrite touched, or would touch'),
        wrapped: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            text: z.string(),
            kind: z.enum(['text', 'attribute']),
            attribute: z.string().optional(),
          }),
        ),
        skipped: z.array(
          z.object({ file: z.string(), line: z.number(), text: z.string(), reason: z.string() }),
        ),
        blocked: z.array(
          z.object({ file: z.string(), texts: z.number(), client: z.boolean() }),
        ),
      },
    },
    guarded(async ({ root, write }) => {
      const cfg = await config(root);
      const result = await wrapProject(cfg, { write });
      const blocked = new Set(result.blocked.map((entry) => entry.file));
      const done = result.changed.filter((file) => !blocked.has(file));
      const texts = result.wrapped.filter((entry) => !blocked.has(entry.file));
      const verb = write ? 'wrapped' : 'would wrap';
      const counts = write
        ? `${counted(texts.length, 'text')} in ${counted(done.length, 'file')}`
        : `${counted(result.wrapped.length, 'text')} in ${counted(result.changed.length, 'file')}`;
      const lines = [`${verb} ${counts} of ${counted(result.files, 'file')} scanned`];
      for (const entry of write ? texts : result.wrapped) {
        const attr = entry.kind === 'attribute' ? `${entry.attribute} -> ` : '';
        lines.push(`  ${entry.file}:${entry.line}  ${attr}"${entry.text}"`);
      }
      if (result.skipped.length > 0) {
        lines.push('  needs a human:');
        for (const entry of result.skipped) {
          lines.push(`  ${entry.file}:${entry.line}  "${entry.text}" (${entry.reason})`);
        }
      }
      if (result.blocked.length > 0) {
        lines.push(`  nothing written in ${counted(result.blocked.length, 'file')} with no t in scope:`);
        for (const entry of result.blocked) {
          const how = entry.client ? '"use client", so const t = useT()' : 'no "use client"';
          lines.push(`  ${entry.file}  ${counted(entry.texts, 'text')}, ${how}`);
        }
        lines.push('  next: bind t there, run verbaly_wrap with write again, then verbaly_extract');
      } else if (write && done.length > 0) {
        lines.push('  next: run verbaly_extract');
      }
      return reply(lines.join('\n'), { ...result, write: write === true });
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
      outputSchema: {
        messages: z.number(),
        locales: z.array(z.string()),
        dryRun: z.boolean(),
        added: perLocale,
        pruned: perLocale,
      },
    },
    guarded(async ({ root, prune, dryRun }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);

      const lines: string[] = [];
      const pruned = prune ? byLocale(pruneCatalogs(cfg, catalogs, registry)) : [];
      for (const { locale, keys } of pruned) {
        lines.push(
          dryRun
            ? `${locale}: would prune ${keys.length}: ${keys.join(', ')}`
            : `${locale}: ${keys.length} pruned`,
        );
      }
      const added = byLocale(syncCatalogs(cfg, catalogs, registry).added);
      if (!dryRun) {
        for (const locale of cfg.locales) {
          writeCatalog(cfg, locale, catalogs[locale] ?? {});
        }
        if (cfg.dts !== false) writeDts(cfg, catalogs[cfg.sourceLocale] ?? {}, cfg.dts);
      }
      const messages = registry.messages().size;
      lines.unshift(
        `${counted(messages, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      );
      for (const { locale, keys } of added) {
        lines.push(`${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length} added`}`);
      }
      return reply(lines.join('\n'), {
        messages,
        locales: cfg.locales,
        dryRun: dryRun === true,
        added,
        pruned,
      });
    }),
  );

  server.registerTool(
    'verbaly_status',
    {
      title: 'Translation coverage',
      description:
        'Translation coverage of the Verbaly project: total messages, translated count per locale and machine translations awaiting review (drafts). Read-only.',
      inputSchema: { root: rootInput },
      outputSchema: {
        messages: z.number().describe('Messages the project has, source catalog plus code'),
        source: z.string().describe('Source locale'),
        locales: z.array(
          z.object({
            locale: z.string(),
            translated: z.number(),
            total: z.number(),
            drafts: z.number().describe('Machine translations awaiting human review'),
            broken: z.number().describe('Present but not rendering what the source renders'),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const result = status(cfg, loadCatalogs(cfg), registry, loadDrafts(cfg));
      return reply(formatStatusResult(result), { ...result });
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
      outputSchema: {
        ok: z.boolean().describe('Whether `verbaly check` would pass (warnings never fail it)'),
        missing: z.array(
          z.object({ locale: z.string(), key: z.string(), source: z.string().optional() }),
        ),
        unknown: z.array(z.object({ key: z.string(), files: z.array(z.string()) })),
        broken: z.array(
          z.object({
            locale: z.string(),
            key: z.string(),
            severity: z.enum(['error', 'warning']),
            issue: z.string(),
          }),
        ),
        unreviewed: perLocale,
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root, drafts }) => {
      const cfg = await config(root);
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);
      const result = check(cfg, catalogs, registry);
      const unreviewed = drafts ? byLocale(effectiveDrafts(loadDrafts(cfg), catalogs)) : [];

      const lines: string[] = [];
      if (!result.ok) lines.push(formatCheckResult(result, cfg.root));
      const warnings = formatCheckWarnings(result);
      if (warnings) lines.push(`warnings (the gate still passes):\n${warnings}`);
      for (const { locale, keys } of unreviewed) {
        if (keys.length) lines.push(`[${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`);
      }
      return reply(lines.length === 0 ? 'all translations complete' : lines.join('\n'), {
        ...result,
        unreviewed,
      });
    }),
  );

  server.registerTool(
    'verbaly_translate',
    {
      title: 'Machine-translate missing entries',
      description:
        'Fill missing translations with the configured provider (default: Claude, needs @anthropic-ai/sdk and ANTHROPIC_API_KEY). New translations are saved as drafts awaiting human review (`verbaly review`), which no tool here can approve. A batch the provider never answers is reported in failed and leaves everything else written, so a retry only asks for what is left. dryRun lists what would be translated without calling the provider.',
      inputSchema: {
        root: rootInput,
        locales: z.array(z.string()).optional().describe('Target locales (default: all)'),
        dryRun: z
          .boolean()
          .optional()
          .describe('List missing entries per locale, call no provider'),
      },
      outputSchema: {
        dryRun: z.boolean(),
        translated: perLocale.describe('Saved as drafts, a human still has to approve them'),
        invalid: perLocale.describe('Rejected: params or tags were not preserved'),
        failed: z
          .array(z.object({ locale: z.string(), keys: z.array(z.string()), error: z.string() }))
          .describe('Batches the provider never answered, safe to retry'),
        pending: perLocale.describe('dryRun only: what would be translated'),
      },
    },
    guarded(async ({ root, locales, dryRun }) => {
      const cfg = await config(root);
      const catalogs = loadCatalogs(cfg);
      const provider = await resolveProvider(cfg);
      const result = await translateCatalogs(cfg, catalogs, provider, {
        locales,
        batchSize: cfg.translate.batchSize,
        concurrency: cfg.translate.concurrency,
        retries: cfg.translate.retries,
        dryRun,
        origins: dryRun ? undefined : await collectOrigins(cfg),
      });

      const data = {
        dryRun: dryRun === true,
        translated: byLocale(result.translated),
        invalid: byLocale(result.invalid),
        failed: result.failed,
        pending: byLocale(result.pending),
      };

      if (dryRun) {
        const lines = data.pending.map(
          ({ locale, keys }) => `${locale}: ${keys.length} missing: ${keys.join(', ')}`,
        );
        return reply(lines.length === 0 ? 'nothing to translate' : lines.join('\n'), data);
      }

      const lines: string[] = [];
      const drafts = loadDrafts(cfg);
      for (const { locale, keys } of data.translated) {
        writeCatalog(cfg, locale, catalogs[locale] ?? {});
        markDrafts(drafts, locale, keys);
        lines.push(`${locale}: +${keys.length} translated (draft)`);
      }
      if (data.translated.length > 0) saveDrafts(cfg, drafts);
      for (const { locale, keys } of data.invalid) {
        lines.push(
          `${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
        );
      }
      lines.push(...formatTranslateFailures(result.failed));
      if (lines.length === 0) return reply('nothing to translate', data);
      if (data.translated.length > 0) {
        lines.push('drafts await human review: verbaly review (--approve accepts them)');
      }
      return reply(lines.join('\n'), data);
    }),
  );
  server.registerTool(
    'verbaly_drafts',
    {
      title: 'Machine translations awaiting review',
      description:
        'Every machine translation still waiting for a human, each with the source text and what the provider wrote, so a person can read both and decide. Read-only. Approving is deliberately not a tool here and never will be: a machine translation is unreviewed by definition, so accepting one is `verbaly review --approve`, run by a human.',
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
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ root, locales }) => {
      const cfg = await config(root);
      const catalogs = loadCatalogs(cfg);
      const source = catalogs[cfg.sourceLocale] ?? {};
      const pending = effectiveDrafts(loadDrafts(cfg), catalogs);
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
            .map((e) => `[${e.locale}] ${e.key}
  source: ${e.source}
  draft:  ${e.translated}`)
            .join('\n')
        : 'nothing awaiting review';
      return reply(body, { total: entries.length, entries });
    }),
  );


  return server;
}
