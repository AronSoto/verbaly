// typecheck-only shim: the specifier resolves through the alias withVerbaly sets, never shipped

declare module 'virtual:verbaly' {
  import type { Routing, Verbaly, VerbalyOptions } from 'verbaly';
  export const locales: string[];
  export const sourceLocale: string;
  export const routing: Routing;
  export const requestOptions: { cookie?: string | false; fallback?: string } | undefined;
  export function createInstance(options?: VerbalyOptions): Verbaly;
  export function createRequestInstance(locale: string): Promise<Verbaly>;
  export function loadMessages(locale: string): Promise<Record<string, string>>;
}
