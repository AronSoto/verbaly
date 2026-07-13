import { shallowRef, type Ref } from 'vue';

export const headInputs: unknown[] = [];
const states = new Map<string, Ref<unknown>>();
let runtimePublic: Record<string, unknown> = {};

export function resetNuxtMock(publicConfig: Record<string, unknown> = {}): void {
  states.clear();
  headInputs.length = 0;
  runtimePublic = publicConfig;
}

// simulates a value already hydrated from the SSR payload
export function seedState(key: string, value: unknown): void {
  states.set(key, shallowRef(value));
}

export function defineNuxtPlugin<T>(plugin: T): T {
  return plugin;
}

export function useState<T>(key: string, init?: () => T): Ref<T> {
  let state = states.get(key);
  if (!state) {
    state = shallowRef(init ? init() : undefined);
    states.set(key, state);
  }
  return state as Ref<T>;
}

export function useRuntimeConfig(): { public: Record<string, unknown> } {
  return { public: runtimePublic };
}

export function useHead(input: Record<string, unknown>): void {
  headInputs.push(input);
}
