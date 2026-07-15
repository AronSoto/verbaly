import type { Component, Snippet } from 'svelte';
import type { Params, RichLink, Verbaly } from 'verbaly';

export interface TransProps {
  id: string;
  values?: Params;
  instance?: Verbaly;
  components?: Record<string, Component<{ children?: Snippet }>>;
  richTags?: string[];
  links?: Record<string, RichLink>;
}

declare const Trans: Component<TransProps>;
export default Trans;
