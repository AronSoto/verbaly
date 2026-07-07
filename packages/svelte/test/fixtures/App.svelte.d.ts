import { SvelteComponent } from 'svelte';
import type { Params, Verbaly } from 'verbaly';

export default class App extends SvelteComponent<{
  instance: Verbaly;
  id: string;
  values?: Params;
}> {}
