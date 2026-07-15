<script>
  import TransNodes from './TransNodes.svelte';

  let { nodes = [], allowed, components, links } = $props();
</script>

{#each nodes as node}{#if typeof node === 'string'}{node}{:else if components && components[node.name]}{@const Component = components[node.name]}<Component><TransNodes nodes={node.children} {allowed} {components} {links} /></Component>{:else if links && links[node.name]}<a href={links[node.name].href} target={links[node.name].target} rel={links[node.name].rel}><TransNodes nodes={node.children} {allowed} {components} {links} /></a>{:else if allowed.has(node.name)}<svelte:element this={node.name}><TransNodes nodes={node.children} {allowed} {components} {links} /></svelte:element>{:else}<TransNodes nodes={node.children} {allowed} {components} {links} />{/if}{/each}
