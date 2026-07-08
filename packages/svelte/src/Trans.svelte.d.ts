import { SvelteComponent } from 'svelte';
import type { Params, RichLink, Verbaly } from 'verbaly';

export interface TransProps {
  id: string;
  values?: Params;
  instance?: Verbaly;
  richTags?: string[];
  links?: Record<string, RichLink>;
}

export default class Trans extends SvelteComponent<TransProps> {}
