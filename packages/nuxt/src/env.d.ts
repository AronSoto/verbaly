// typecheck-only shims: both specifiers resolve in the consumer build, never shipped

declare module '#imports' {
  import type { Ref } from 'vue';
  export function defineNuxtPlugin<T>(plugin: T): T;
  export function useState<T>(key: string, init?: () => T): Ref<T>;
  export function useRuntimeConfig(): {
    public: Record<string, unknown>;
    app?: { baseURL?: string };
  };
  export function useHead(input: Record<string, unknown>): void;
  export function useRequestURL(): URL;
}

declare module 'virtual:verbaly' {
  import type { Routing, Verbaly } from 'verbaly';
  export const locales: string[];
  export const sourceLocale: string;
  export const routing: Routing;
  export function createRequestInstance(locale: string): Promise<Verbaly>;
}
