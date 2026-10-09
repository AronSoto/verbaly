export type MessageValue = string | MessageTree;

export interface MessageTree {
  [key: string]: MessageValue;
}

export type DictionaryInput = Record<string, MessageTree>;

export type Params = Record<string, unknown>;

// what a formatter needs to name its own failure: today a custom one can name neither
export interface FormatInfo {
  param: string;
  key?: string;
}

export type Formatter = (value: unknown, locale: string, arg?: string, info?: FormatInfo) => string;

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

// string, or a template with a part from data: a key nobody wrote, so no catalog can check it
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type FromData<K> = {} extends Record<K & string, 1> ? true : false;

// one signature, so a typo is reported against the keys and never against the tagged form
export interface TFunction<D extends DictionaryInput = DictionaryInput> {
  <K extends KeysOf<D> | TemplateStringsArray | (string & {})>(
    first: K extends TemplateStringsArray
      ? K
      : FromData<K> extends true
        ? K
        : K extends KeysOf<D>
          ? K
          : KeysOf<D>,
    // never (a key cast away) would distribute to never, which no argument list matches
    ...args: [K] extends [never]
      ? [params?: Params]
      : K extends TemplateStringsArray
        ? unknown[]
        : FromData<K> extends true
          ? [params?: Params]
          : K extends KeysOf<D>
            ? TArgs<MessageAt<D, K>>
            : unknown[]
  ): string;
  // explicit readable key; compiler rewrites to t(key, params)
  id(key: string): (strings: TemplateStringsArray, ...values: unknown[]) => string;
}

// the generated verbaly.d.ts fills it in; empty, every t takes any key and any locale is a string
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

// the project's t once its types are generated, the untyped t until then
export type Translate = Register extends { t: infer T } ? T : TFunction;

// one of the project's locales once its types are generated, any string until then
export type Locale = Register extends { locale: infer L extends string } ? L : string;

// built from a dictionary, t is typed by it; built from the project's catalogs, t reads Register
export type TOf<D extends DictionaryInput> = DictionaryInput extends D ? Translate : TFunction<D>;

// how a t(key) call resolved: the observability signal (devtools)
export type ResolveStatus = 'hit' | 'fallback' | 'miss';

export interface ResolveInfo {
  key: string;
  locale: string;
  value: string;
  status: ResolveStatus;
  from?: string;
}

// Partial: locales whose messages came with the page: enough for it, maybe not for the rest
export interface VerbalyOptions<D extends DictionaryInput = DictionaryInput> {
  locale?: string;
  fallback?: string | string[];
  messages?: D;
  loaders?: Record<string, LocaleLoader>;
  formatters?: Record<string, Formatter>;
  icu?: import('./parse').IcuParser;
  onMissing?: (key: string, locale: string) => string | void;
  onResolve?: (info: ResolveInfo) => void;
  partial?: string[];
}

// Partial: another page's slice, so the locale stays incomplete instead of counting as loaded
export interface AddMessagesOptions {
  partial?: boolean;
}

export interface Verbaly<D extends DictionaryInput = DictionaryInput> {
  readonly locale: string;
  readonly locales: string[];
  readonly version: number;
  t: TOf<D>;
  setLocale(locale: string): void;
  loadLocale(locale: string): Promise<void>;
  addMessages(locale: string, messages: MessageTree, options?: AddMessagesOptions): void;
  subscribe(listener: () => void): () => void;
  has(key: string): boolean;
  inspect(key: string): { from: string; source: string } | undefined;
}
