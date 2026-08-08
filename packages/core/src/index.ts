export { createVerbaly } from './instance';
export { bindDom, normalizeLink, RICH_TAGS, safeAttribute, safeHref, VOID_TAGS } from './dom';
export {
  LOCALE_STORAGE_KEY,
  localeDirection,
  localeName,
  negotiateLocale,
  persistLocale,
  resolveLocale,
  resolveRequestLocale,
  switchLocale,
} from './locale';
export { parse } from './parse';
export { flatten } from './flatten';
export { parseTags } from './tags';

export type { BindDomOptions, RichLink } from './dom';
export type { RequestLocaleOptions, ResolveLocaleOptions, SwitchLocaleOptions } from './locale';
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
