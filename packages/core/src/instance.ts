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
  const loaders = options.loaders ?? {};
  const loaded = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const warned = new Set<string>();
  const fallbacks = options.fallback
    ? Array.isArray(options.fallback)
      ? options.fallback
      : [options.fallback]
    : [];

  let locale = options.locale ?? detectLocale();
  let version = 0;
  let chainCache: string[] | null = null;

  if (options.messages) {
    for (const [loc, tree] of Object.entries(options.messages)) {
      dict[loc] = flatten(tree);
    }
  }

  function chain(): string[] {
    if (chainCache) return chainCache;
    const result: string[] = [];
    // narrow BCP-47 subtags
    const parts = locale.split('-');
    while (parts.length > 0) {
      result.push(parts.join('-'));
      parts.pop();
    }
    for (const fb of fallbacks) if (!result.includes(fb)) result.push(fb);
    chainCache = result;
    return result;
  }

  function lookup(key: string): { msg: string; from: string } | undefined {
    for (const loc of chain()) {
      const msg = dict[loc]?.[key];
      // '' = untranslated (extract scaffolds it) → keep falling back
      if (msg) return { msg, from: loc };
    }
    return undefined;
  }

  function translate(key: string, params: Params | undefined): string {
    const hit = lookup(key);
    if (hit === undefined) {
      const replacement = options.onMissing?.(key, locale);
      const value = typeof replacement === 'string' ? replacement : key;
      if (typeof replacement !== 'string' && !options.onMissing && !warned.has(key)) {
        warned.add(key);
        console.warn(`[verbaly] missing key "${key}" (${locale})`);
      }
      options.onResolve?.({ key, locale, value, status: 'miss' });
      return value;
    }
    const value = formatNodes(parse(hit.msg), { locale, params, formatters });
    options.onResolve?.({
      key,
      locale,
      value,
      status: hit.from === locale ? 'hit' : 'fallback',
      from: hit.from,
    });
    return value;
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

  t.id =
    () =>
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      tagged(strings, values);

  function pendingLoader(target: string): string | undefined {
    const parts = target.split('-');
    while (parts.length > 0) {
      const candidate = parts.join('-');
      if (loaders[candidate] && !loaded.has(candidate)) return candidate;
      if (loaders[candidate]) return undefined;
      parts.pop();
    }
    return undefined;
  }

  function loadLocale(target: string): Promise<void> {
    const pending = pendingLoader(target);
    if (!pending) return Promise.resolve();
    const running = inFlight.get(pending);
    if (running) return running;
    const load = loaders[pending]!()
      .then((mod) => {
        loaded.add(pending);
        inFlight.delete(pending);
        addMessages(
          pending,
          'default' in mod ? (mod.default as MessageTree) : (mod as MessageTree),
        );
      })
      .catch((error: unknown) => {
        inFlight.delete(pending);
        throw error;
      });
    inFlight.set(pending, load);
    return load;
  }

  function addMessages(loc: string, messages: MessageTree): void {
    dict[loc] = { ...dict[loc], ...flatten(messages) };
    notify();
  }

  return {
    get locale() {
      return locale;
    },
    get locales() {
      return [...new Set([...Object.keys(dict), ...Object.keys(loaders)])];
    },
    get version() {
      return version;
    },
    t,
    setLocale(next: string) {
      // auto-load pending catalog; UI re-renders when it lands
      if (pendingLoader(next)) {
        void loadLocale(next).catch(() => {
          if (!warned.has(`load:${next}`)) {
            warned.add(`load:${next}`);
            console.warn(`[verbaly] failed to load catalog for "${next}"`);
          }
        });
      }
      if (next === locale) return;
      locale = next;
      chainCache = null;
      notify();
    },
    loadLocale,
    addMessages,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has(key: string) {
      return lookup(key) !== undefined;
    },
    inspect(key: string) {
      const hit = lookup(key);
      return hit ? { locale: hit.from, source: hit.msg } : undefined;
    },
  };
}

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value;
}

function detectLocale(): string {
  // gate on document, not navigator — Node 21+ exposes a global navigator (OS locale)
  return typeof document !== 'undefined' && typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en';
}
