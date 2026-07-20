import type { Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { collectParams } from './params';

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

// params and tags must survive translation verbatim
export function structureMatches(source: string, translated: string): boolean {
  return (
    sameMembers(paramNames(source), paramNames(translated)) &&
    sameMembers(tagTokens(source), tagTokens(translated))
  );
}

function paramNames(message: string): string[] {
  try {
    return [...collectParams(message).keys()].sort();
  } catch {
    return ['\u0000invalid'];
  }
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)(\/?)>/g;

function tagTokens(message: string): string[] {
  const out: string[] = [];
  for (const match of message.matchAll(TAG)) {
    out.push(`${match[1]}${match[2]}${match[3]}`);
  }
  return out.sort();
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
