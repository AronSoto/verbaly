// structural shim for typecheck only: the specifier resolves in the consumer's Next build
// via the bundler alias withVerbaly sets (never shipped: public dts only references 'verbaly')

declare module 'virtual:verbaly' {
  import type { Verbaly, VerbalyOptions } from 'verbaly';
  export const locales: string[];
  export const sourceLocale: string;
  export const requestOptions: { cookie?: string | false; fallback?: string } | undefined;
  export function createInstance(options?: VerbalyOptions): Verbaly;
  export function createRequestInstance(locale: string): Promise<Verbaly>;
  export function loadMessages(locale: string): Promise<Record<string, string>>;
}
