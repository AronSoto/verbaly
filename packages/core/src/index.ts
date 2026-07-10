export { createVerbaly } from './instance';
export { bindDom, RICH_TAGS, safeHref } from './dom';
export { resolveLocale, persistLocale } from './locale';
export { parse } from './parse';
export { flatten } from './flatten';
export { parseTags } from './tags';

export type { BindDomOptions, RichLink } from './dom';
export type { ResolveLocaleOptions } from './locale';
export type { MessageNode, ParamNode } from './parse';
export type { TagNode } from './tags';
export type {
  DictionaryInput,
  FlatKeys,
  Formatter,
  KeysOf,
  LocaleLoader,
  MessageAt,
  MessageTree,
  MessageValue,
  ParamNames,
  Params,
  ResolveInfo,
  ResolveStatus,
  TArgs,
  TFunction,
  Verbaly,
  VerbalyOptions,
} from './types';
