// structural shims for typecheck only: both specifiers resolve in the consumer's Nuxt build
// (never shipped: module.d.ts doesn't reference them and the runtime plugin emits no dts)

declare module '#imports' {
  import type { Ref } from 'vue';
  export function defineNuxtPlugin<T>(plugin: T): T;
  export function useState<T>(key: string, init?: () => T): Ref<T>;
  export function useRuntimeConfig(): { public: Record<string, unknown> };
  export function useHead(input: Record<string, unknown>): void;
}

declare module 'virtual:verbaly' {
  import type { Verbaly } from 'verbaly';
  export const locales: string[];
  export const sourceLocale: string;
  export function createRequestInstance(locale: string): Promise<Verbaly>;
}
