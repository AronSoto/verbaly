<script>
  import { onDestroy } from 'svelte';
  import { normalizeLink, parseTags, RICH_TAGS } from 'verbaly';
  import { useVerbaly } from '@verbaly/svelte';
  import TransNodes from './TransNodes.svelte';

  let { id, values, instance, components, richTags, links } = $props();

  // the instance is fixed at mount on purpose
  // svelte-ignore state_referenced_locally
  const v = instance ?? useVerbaly();
  let version = $state(v.version);
  onDestroy(v.subscribe(() => (version = v.version)));

  const allowed = $derived(new Set(richTags ?? RICH_TAGS));
  // normalize + sanitize hrefs once (never from messages)
  const linkDefs = $derived(
    links
      ? Object.fromEntries(
          Object.entries(links).map(([name, link]) => [name, normalizeLink(link)]),
        )
      : undefined,
  );
  // version keeps this reactive to locale/catalog changes
  const nodes = $derived.by(() => {
    void version;
    return parseTags(v.t(id, values));
  });
</script>

<TransNodes {nodes} {allowed} {components} links={linkDefs} />
