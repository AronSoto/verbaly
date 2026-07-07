import { SvelteComponent } from 'svelte';
import type { Params, Verbaly } from 'verbaly';

export interface TransProps {
  id: string;
  values?: Params;
  instance?: Verbaly;
  richTags?: string[];
}

export default class Trans extends SvelteComponent<TransProps> {}
