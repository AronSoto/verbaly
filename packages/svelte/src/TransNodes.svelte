<script>
  import TransNodes from './TransNodes.svelte';

  export let nodes = [];
  export let allowed;
</script>

{#each nodes as node}{#if typeof node === 'string'}{node}{:else if allowed.has(node.name)}<svelte:element this={node.name}><TransNodes nodes={node.children} {allowed} /></svelte:element>{:else}<TransNodes nodes={node.children} {allowed} />{/if}{/each}
