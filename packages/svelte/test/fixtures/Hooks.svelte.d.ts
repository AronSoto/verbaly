import { SvelteComponent } from 'svelte';
import type { Verbaly } from 'verbaly';

export default class Hooks extends SvelteComponent<{
  instance: Verbaly;
}> {}
