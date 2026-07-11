<script>
  import { onDestroy } from 'svelte';
  import { normalizeLink, parseTags, RICH_TAGS } from 'verbaly';
  import { useVerbaly } from '@verbaly/svelte';
  import TransNodes from './TransNodes.svelte';

  export let id;
  export let values = undefined;
  export let instance = undefined;
  export let richTags = undefined;
  export let links = undefined;

  const v = instance ?? useVerbaly();
  let version = v.version;
  const unsubscribe = v.subscribe(() => (version = v.version));
  onDestroy(unsubscribe);

  $: allowed = new Set(richTags ?? RICH_TAGS);
  // normalize + sanitize hrefs once (never from messages)
  $: linkDefs = links
    ? Object.fromEntries(
        Object.entries(links).map(([name, link]) => [name, normalizeLink(link)]),
      )
    : undefined;
  // version keeps this reactive to locale/catalog changes
  $: nodes = (version, parseTags(v.t(id, values)));
</script>

<TransNodes {nodes} {allowed} links={linkDefs} />
