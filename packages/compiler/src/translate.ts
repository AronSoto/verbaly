import type { Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { validateMessage, validatePair } from './validate';

export interface TranslateRequest {
  sourceLocale: string;
  targetLocale: string;
  messages: Record<string, string>;
  origins?: Record<string, string[]>;
}

export type TranslateProvider = (request: TranslateRequest) => Promise<Record<string, string>>;

export interface TranslateOptions {
  locales?: string[];
  batchSize?: number;
  dryRun?: boolean;
  origins?: Record<string, string[]>;
}

export interface TranslateResult {
  translated: Record<string, string[]>;
  invalid: Record<string, string[]>;
  pending: Record<string, string[]>;
}

// fills '' entries via the provider; invalid translations stay '' (check keeps failing)
export async function translateCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  provider: TranslateProvider,
  options: TranslateOptions = {},
): Promise<TranslateResult> {
  const batchSize = options.batchSize ?? 20;
  const targets = targetLocales(cfg, options.locales);
  const source = catalogs[cfg.sourceLocale] ?? {};
  const result: TranslateResult = { translated: {}, invalid: {}, pending: {} };

  for (const locale of targets) {
    const catalog = (catalogs[locale] ??= {});
    const missing = Object.keys(source).filter((key) => source[key] && !catalog[key]);
    if (missing.length === 0) continue;

    if (options.dryRun) {
      result.pending[locale] = missing;
      continue;
    }

    for (let i = 0; i < missing.length; i += batchSize) {
      const keys = missing.slice(i, i + batchSize);
      const messages = Object.fromEntries(keys.map((key) => [key, source[key]!]));
      const origins = options.origins
        ? Object.fromEntries(
            keys.filter((key) => options.origins![key]).map((key) => [key, options.origins![key]!]),
          )
        : undefined;
      const out = await provider({
        sourceLocale: cfg.sourceLocale,
        targetLocale: locale,
        messages,
        origins,
      });
      for (const key of keys) {
        const text = out[key];
        if (typeof text === 'string' && text.trim() && structureMatches(source[key]!, text)) {
          catalog[key] = text;
          (result.translated[locale] ??= []).push(key);
        } else {
          (result.invalid[locale] ??= []).push(key);
        }
      }
    }
  }
  return result;
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
