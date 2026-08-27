import type { Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { counted } from './text';
import { validateMessage, validatePair } from './validate';

export interface TranslateRequest {
  sourceLocale: string;
  targetLocale: string;
  messages: Record<string, string>;
  origins?: Record<string, string[]>;
  instructions?: string;
  glossary?: Record<string, string>;
}

export type TranslateProvider = (request: TranslateRequest) => Promise<Record<string, string>>;

export interface TranslateProgress {
  locale: string;
  batch: number;
  batches: number;
  keys: number;
  error?: string;
}

export interface TranslateOptions {
  locales?: string[];
  batchSize?: number;
  concurrency?: number;
  retries?: number;
  retryDelay?: number;
  dryRun?: boolean;
  origins?: Record<string, string[]>;
  onProgress?: (progress: TranslateProgress) => void;
}

// carries its reason, which the per-locale records cannot: a batch fails as a batch
export interface TranslateFailure {
  locale: string;
  keys: string[];
  error: string;
}

export interface TranslateResult {
  translated: Record<string, string[]>;
  invalid: Record<string, string[]>;
  pending: Record<string, string[]>;
  failed: TranslateFailure[];
}

interface Batch {
  locale: string;
  index: number;
  batches: number;
  keys: string[];
}

const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

// a provider is an extension point: retry what looks transient, never a request the api refused
function retryable(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | null)?.status;
  const code = (error as { statusCode?: number } | null)?.statusCode;
  const value = typeof status === 'number' ? status : code;
  return typeof value === 'number' ? RETRY_STATUS.has(value) : true;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// a batch that never gets an answer is a failed batch, never a thrown run: everything else lands
async function attempt(
  run: () => Promise<Record<string, string>>,
  retries: number,
  delay: number,
): Promise<Record<string, string>> {
  for (let round = 0; ; round++) {
    try {
      return await run();
    } catch (error) {
      if (round >= retries || !retryable(error)) throw error;
      await wait(delay * 2 ** round);
    }
  }
}

// bounded pool: independent batches, so the only reason to serialize them is the provider's limit
async function pooled<T>(jobs: T[], limit: number, run: (job: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      await run(jobs[next++]!);
    }
  });
  await Promise.all(workers);
}

// fills '' entries via the provider; invalid translations stay '' (check keeps failing)
export async function translateCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  provider: TranslateProvider,
  options: TranslateOptions = {},
): Promise<TranslateResult> {
  const batchSize = options.batchSize ?? 20;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const retries = Math.max(0, options.retries ?? 2);
  const retryDelay = options.retryDelay ?? 500;
  const targets = targetLocales(cfg, options.locales);
  const source = catalogs[cfg.sourceLocale] ?? {};
  const result: TranslateResult = { translated: {}, invalid: {}, pending: {}, failed: [] };

  const jobs: Batch[] = [];
  for (const locale of targets) {
    const catalog = (catalogs[locale] ??= {});
    const missing = Object.keys(source).filter((key) => source[key] && !catalog[key]);
    if (missing.length === 0) continue;

    if (options.dryRun) {
      result.pending[locale] = missing;
      continue;
    }

    const batches = Math.ceil(missing.length / batchSize);
    for (let i = 0; i < missing.length; i += batchSize) {
      const index = Math.floor(i / batchSize) + 1;
      jobs.push({ locale, index, batches, keys: missing.slice(i, i + batchSize) });
    }
  }

  await pooled(jobs, concurrency, async (job) => {
    const { locale, keys } = job;
    const catalog = catalogs[locale]!;
    const messages = Object.fromEntries(keys.map((key) => [key, source[key]!]));
    const origins = options.origins
      ? Object.fromEntries(
          keys.filter((key) => options.origins![key]).map((key) => [key, options.origins![key]!]),
        )
      : undefined;

    let out: Record<string, string>;
    try {
      out = await attempt(
        () =>
          provider({
            sourceLocale: cfg.sourceLocale,
            targetLocale: locale,
            messages,
            origins,
            instructions: cfg.translate.instructions,
            glossary: glossaryFor(cfg, locale, messages),
          }),
        retries,
        retryDelay,
      );
    } catch (error) {
      const message = reason(error);
      result.failed.push({ locale, keys, error: message });
      options.onProgress?.({ ...progressOf(job), error: message });
      return;
    }

    for (const key of keys) {
      const text = out[key];
      if (typeof text === 'string' && text.trim() && structureMatches(source[key]!, text)) {
        catalog[key] = text;
        (result.translated[locale] ??= []).push(key);
      } else {
        (result.invalid[locale] ??= []).push(key);
      }
    }
    options.onProgress?.(progressOf(job));
  });

  // batches land out of order once they run in parallel, and a report has to read the same twice
  for (const locale of Object.keys(result.translated)) result.translated[locale]!.sort();
  for (const locale of Object.keys(result.invalid)) result.invalid[locale]!.sort();
  result.failed.sort((a, b) => a.locale.localeCompare(b.locale) || compare(a.keys, b.keys));
  return result;
}

function compare(a: string[], b: string[]): number {
  return (a[0] ?? '').localeCompare(b[0] ?? '');
}

// the same reason repeats across batches: say it once and name every key it cost
export function formatTranslateFailures(failed: TranslateFailure[]): string[] {
  const grouped: TranslateFailure[] = [];
  for (const entry of failed) {
    const same = grouped.find((it) => it.locale === entry.locale && it.error === entry.error);
    if (same) same.keys = [...same.keys, ...entry.keys];
    else grouped.push({ ...entry, keys: [...entry.keys] });
  }
  return grouped.map(
    ({ locale, error, keys }) =>
      `  ${locale}: ${counted(keys.length, 'message')} not translated (${error}): ${keys.join(', ')}`,
  );
}

// config provider wins; claude loads lazily so only translate pays for its optional SDK
export async function resolveProvider(
  cfg: ResolvedConfig,
  model?: string,
): Promise<TranslateProvider> {
  const configured = cfg.translate.provider;
  if (typeof configured === 'function') return configured;
  const { claudeProvider } = await import('./providers/claude');
  return claudeProvider({ model: model ?? cfg.translate.model });
}

// no locale on purpose: a locale-specific plural gap must never drop a translator's file
export function structureMatches(source: string, translated: string): boolean {
  try {
    const issues = [...validateMessage(translated), ...validatePair(source, translated)];
    return !issues.some((issue) => issue.severity === 'error');
  } catch {
    return false; // unparseable input rejects the translation, it never crashes the caller
  }
}

function progressOf(job: Batch): TranslateProgress {
  return { locale: job.locale, batch: job.index, batches: job.batches, keys: job.keys.length };
}

// only the terms this batch actually contains: a glossary of hundreds must not become the prompt
function glossaryFor(
  cfg: ResolvedConfig,
  locale: string,
  messages: Record<string, string>,
): Record<string, string> | undefined {
  const entries = cfg.translate.glossary;
  if (!entries) return undefined;
  const text = Object.values(messages).join('\n').toLowerCase();
  const out: Record<string, string> = {};
  for (const [term, rendering] of Object.entries(entries)) {
    if (!text.includes(term.toLowerCase())) continue;
    const value = typeof rendering === 'string' ? rendering : rendering[locale];
    if (value) out[term] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
