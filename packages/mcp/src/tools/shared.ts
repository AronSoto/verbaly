import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatFinding } from '@verbaly/compiler';
import type { Finding, ResolvedConfig } from '@verbaly/compiler';
import { relative } from 'node:path';
import { z } from 'zod';

// what every tool gets from the server that registers it
export interface ToolContext {
  root: string | undefined;
  config: (root?: string) => Promise<ResolvedConfig>;
  guarded: <A>(run: (args: A) => Promise<CallToolResult>) => (args: A) => Promise<CallToolResult>;
}

// text stays the fallback for a client that reads no schema, structuredContent is what agents parse
export const reply = (body: string, data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: body }],
  structuredContent: data,
});

// a client that gets no hints must assume the spec defaults: destructive and reaching the internet
export const READS = { readOnlyHint: true, openWorldHint: false } as const;
export function writes(destructiveHint: boolean, openWorldHint = false) {
  // every writer here is safe to repeat, which a second call in the tests proves
  return { readOnlyHint: false, destructiveHint, idempotentHint: true, openWorldHint };
}

export const rootInput = z
  .string()
  .optional()
  .describe('Project root holding verbaly.config (defaults to the server working directory)');

export const perLocale = z.array(z.object({ locale: z.string(), keys: z.array(z.string()) }));

export const perLocaleEntries = z.array(z.object({ locale: z.string(), key: z.string() }));

// a locale-keyed record is a dynamic schema an agent cannot read ahead: lists enumerate
export const byLocale = (
  record: Record<string, string[]>,
): Array<{ locale: string; keys: string[] }> =>
  Object.entries(record).map(([locale, keys]) => ({ locale, keys }));

export const sourceSite = z.object({
  file: z.string(),
  line: z.number().optional(),
  message: z.string(),
});

// an agent reads paths against the project, the same way every tool here writes them
export function relativeTo(root: string): (file: string) => string {
  return (file) => relative(root, file).replaceAll('\\', '/');
}

// every tool that can bring the lock into being says so the same way
export const lockOutput = z
  .object({
    file: z.string(),
    from: z.string().optional(),
    merged: z.boolean().optional(),
  })
  .optional()
  .describe(
    'This run created verbaly.lock, moved an older state file (from) into it, or rewrote it whole after a merge conflict (merged): it belongs in git with the catalogs, so tell the user to commit it',
  );

type LockNews = Omit<Extract<Finding, { kind: 'lock' }>, 'kind'>;

// the lock a run created, moved in or merged, the one thing an agent has to tell its user to commit
export function lockData(
  news: LockNews | undefined,
  rel: (file: string) => string,
): { lock?: LockNews } {
  if (!news) return {};
  const from = news.from && { from: rel(news.from) };
  return { lock: { file: rel(news.file), ...from, ...(news.merged && { merged: true }) } };
}

export function lockOf(findings: Finding[], rel: (file: string) => string): { lock?: LockNews } {
  return lockData(
    findings.find((finding) => finding.kind === 'lock'),
    rel,
  );
}

// the line a person reads about it, the one the CLI prints
export function lockLine(news: LockNews | undefined, root: string): string[] {
  return news ? [formatFinding({ kind: 'lock', ...news }, root)] : [];
}
