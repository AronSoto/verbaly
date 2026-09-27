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
  // null prototype: a tag named constructor in a message must never find the one on Object
  const componentDefs = $derived(
    components ? Object.assign(Object.create(null), components) : undefined,
  );
  // normalize + sanitize hrefs once (never from messages)
  const linkDefs = $derived.by(() => {
    if (!links) return undefined;
    const defs = Object.create(null);
    for (const [name, link] of Object.entries(links)) defs[name] = normalizeLink(link);
    return defs;
  });
  // version keeps this reactive to locale/catalog changes
  const nodes = $derived.by(() => {
    void version;
    return parseTags(v.t(id, values));
  });
</script>

<TransNodes {nodes} {allowed} components={componentDefs} links={linkDefs} />
