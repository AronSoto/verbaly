<script>
  import TransNodes from './TransNodes.svelte';

  export let nodes = [];
  export let allowed;
  export let links = undefined;
</script>

{#each nodes as node}{#if typeof node === 'string'}{node}{:else if links && links[node.name]}<a href={links[node.name].href} target={links[node.name].target} rel={links[node.name].rel}><TransNodes nodes={node.children} {allowed} {links} /></a>{:else if allowed.has(node.name)}<svelte:element this={node.name}><TransNodes nodes={node.children} {allowed} {links} /></svelte:element>{:else}<TransNodes nodes={node.children} {allowed} {links} />{/if}{/each}
