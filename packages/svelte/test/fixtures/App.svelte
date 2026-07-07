<script>
  import { provideVerbaly } from '@verbaly/svelte';
  import Trans from '../../src/Trans.svelte';

  export let instance;
  export let id;
  export let values = undefined;

  provideVerbaly(instance);
</script>

<Trans {id} {values} />
