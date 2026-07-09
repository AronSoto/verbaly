<script>
  import { provideVerbaly, useT, useLocale } from '../../src/index';

  export let instance;

  provideVerbaly(instance);
  const t = useT();
  const locale = useLocale();
</script>

<p>{$t('hello')}</p>
<button on:click={() => locale.set('en')}>{$locale}</button>
