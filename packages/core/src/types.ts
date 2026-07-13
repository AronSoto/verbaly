export type MessageValue = string | MessageTree;

export interface MessageTree {
  [key: string]: MessageValue;
}

export type DictionaryInput = Record<string, MessageTree>;

export type Params = Record<string, unknown>;

export type Formatter = (value: unknown, locale: string, arg?: string) => string;

// lazy catalog: tree or module namespace
export type LocaleLoader = () => Promise<MessageTree | { default: MessageTree }>;

// nested tree → dotted keys
export type FlatKeys<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${FlatKeys<T[K]>}`;
    }[keyof T & string];

export type KeysOf<D extends DictionaryInput> = string extends keyof D
  ? string
  : [FlatKeys<D[keyof D]>] extends [never]
    ? string
    : FlatKeys<D[keyof D]>;

// message text at dotted path
export type MessageAt<D extends DictionaryInput, K extends string> = LookupPath<D[keyof D], K>;

type LookupPath<T, K extends string> = T extends MessageTree
  ? K extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
      ? LookupPath<T[Head], Rest>
      : never
    : K extends keyof T
      ? T[K] extends string
        ? T[K]
        : never
      : never
  : never;

// param names inside a message
export type ParamNames<S extends string> = string extends S ? string : Scan<StripDoubles<S>>;

// \u0000 = sentinel for stripped escapes: can never occur in a real message
type StripDoubles<S extends string> = S extends `${infer A}{{${infer B}`
  ? `${A}\u0000${StripDoubles<B>}`
  : S;

type Scan<S extends string> = S extends `${string}{${infer Rest}`
  ? CleanName<NameOf<Rest>> | Scan<Rest>
  : never;

type NameOf<S extends string> = Trim<Take<Take<Take<S, '}'>, ':'>, '|'>>;

type Take<S extends string, D extends string> = S extends `${infer A}${D}${string}` ? A : S;

type Trim<S extends string> = S extends ` ${infer R}`
  ? Trim<R>
  : S extends `${infer R} `
    ? Trim<R>
    : S;

type CleanName<N extends string> = N extends ''
  ? never
  : N extends `${string}{${string}`
    ? never
    : N extends `${string}\u0000${string}`
      ? never
      : N;

export type TArgs<S extends string> = [S] extends [never]
  ? [params?: Params]
  : string extends S
    ? [params?: Params]
    : [ParamNames<S>] extends [never]
      ? []
      : [params: { [N in ParamNames<S> & string]: unknown }];

export interface TFunction<D extends DictionaryInput = DictionaryInput> {
  <K extends KeysOf<D>>(key: K, ...args: TArgs<MessageAt<D, K>>): string;
  (strings: TemplateStringsArray, ...values: unknown[]): string;
  // explicit readable key; compiler rewrites to t(key, params)
  id(key: string): (strings: TemplateStringsArray, ...values: unknown[]) => string;
}

// how a t(key) call resolved: the observability signal (devtools)
export type ResolveStatus = 'hit' | 'fallback' | 'miss';

export interface ResolveInfo {
  key: string;
  locale: string;
  value: string;
  status: ResolveStatus;
  from?: string;
}

export interface VerbalyOptions<D extends DictionaryInput = DictionaryInput> {
  locale?: string;
  fallback?: string | string[];
  messages?: D;
  loaders?: Record<string, LocaleLoader>;
  formatters?: Record<string, Formatter>;
  onMissing?: (key: string, locale: string) => string | void;
  onResolve?: (info: ResolveInfo) => void;
}

export interface Verbaly<D extends DictionaryInput = DictionaryInput> {
  readonly locale: string;
  readonly locales: string[];
  readonly version: number;
  t: TFunction<D>;
  setLocale(locale: string): void;
  loadLocale(locale: string): Promise<void>;
  addMessages(locale: string, messages: MessageTree): void;
  subscribe(listener: () => void): () => void;
  has(key: string): boolean;
  inspect(key: string): { from: string; source: string } | undefined;
}
