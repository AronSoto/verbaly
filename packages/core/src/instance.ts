import { flatten } from './flatten';
import { autoFormat, formatNodes } from './format';
import { parse } from './parse';
import type {
  DictionaryInput,
  MessageTree,
  Params,
  TFunction,
  Verbaly,
  VerbalyOptions,
} from './types';

export function createVerbaly<const D extends DictionaryInput = DictionaryInput>(
  options: VerbalyOptions<D> = {},
): Verbaly<D> {
  const dict: Record<string, Record<string, string>> = {};
  const listeners = new Set<() => void>();
  const formatters = options.formatters ?? {};
  const warned = new Set<string>();
  const fallbacks = options.fallback
    ? Array.isArray(options.fallback)
      ? options.fallback
      : [options.fallback]
    : [];

  let locale = options.locale ?? detectLocale();
  let version = 0;

  if (options.messages) {
    for (const [loc, tree] of Object.entries(options.messages)) {
      dict[loc] = flatten(tree);
    }
  }

  function chain(): string[] {
    const result: string[] = [];
    // narrow BCP-47 subtags
    const parts = locale.split('-');
    while (parts.length > 0) {
      result.push(parts.join('-'));
      parts.pop();
    }
    for (const fb of fallbacks) if (!result.includes(fb)) result.push(fb);
    return result;
  }

  function lookup(key: string): string | undefined {
    for (const loc of chain()) {
      const msg = dict[loc]?.[key];
      if (msg !== undefined) return msg;
    }
    return undefined;
  }

  function translate(key: string, params: Params | undefined): string {
    const msg = lookup(key);
    if (msg === undefined) {
      const replacement = options.onMissing?.(key, locale);
      if (typeof replacement === 'string') return replacement;
      if (!options.onMissing && !warned.has(key)) {
        warned.add(key);
        console.warn(`[verbaly] missing key "${key}" (${locale})`);
      }
      return key;
    }
    return formatNodes(parse(msg), { locale, params, formatters });
  }

  function tagged(strings: TemplateStringsArray, values: unknown[]): string {
    let out = strings[0] ?? '';
    for (let i = 0; i < values.length; i++) {
      out += autoFormat(values[i], locale) + (strings[i + 1] ?? '');
    }
    return out;
  }

  function notify(): void {
    version += 1;
    for (const fn of listeners) fn();
  }

  const t = ((first: unknown, ...rest: unknown[]): string => {
    if (isTemplateStrings(first)) return tagged(first, rest);
    return translate(first as string, rest[0] as Params | undefined);
  }) as TFunction<D>;

  return {
    get locale() {
      return locale;
    },
    get version() {
      return version;
    },
    t,
    setLocale(next: string) {
      if (next === locale) return;
      locale = next;
      notify();
    },
    addMessages(loc: string, messages: MessageTree) {
      dict[loc] = { ...dict[loc], ...flatten(messages) };
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has(key: string) {
      return lookup(key) !== undefined;
    },
  };
}

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value;
}

function detectLocale(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
}
