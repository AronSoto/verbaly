<script lang="ts">
  import Marks from './Marks.svelte';
  import { marked } from '../model';
  import { SEARCH } from '../words';
  import type { Hit } from '../model';

  interface Props {
    query: string;
    hits: Hit[];
    sourceLocale: string;
    onPick: (key: string) => void;
    onClose: () => void;
  }

  const { query, hits, sourceLocale, onPick, onClose }: Props = $props();

  let at = $state(0);

  // a new query starts at the top, or the arrow keys would carry the old position into it
  $effect(() => {
    void query;
    at = 0;
  });

  export function move(step: number): void {
    if (!hits.length) return;
    at = (at + step + hits.length) % hits.length;
  }

  export function choose(): void {
    const hit = hits[at];
    if (hit) onPick(hit.key);
  }
</script>

<div class="sheet" role="dialog" aria-label={SEARCH.label}>
  <p class="head">
    <span>{SEARCH.scope}</span>
    <b>{hits.length === 1 ? SEARCH.oneHit : SEARCH.hits(hits.length)}</b>
  </p>

  {#if hits.length === 0}
    <p class="none">{SEARCH.none}</p>
  {:else}
    <ul>
      {#each hits as hit, i (hit.key)}
        {@const parts = marked(hit.text, query)}
        <li>
          <button class="hit" class:on={i === at} onclick={() => onPick(hit.key)}>
            <span class="tile" data-state={hit.state}><Marks state={hit.state} /></span>
            <span class="what">
              <span class="found">{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</span>
              {#if hit.group}<span class="group">{hit.group}</span>{/if}
              {#if !hit.locales.includes(sourceLocale)}
                <span class="src">{hit.source}</span>
              {/if}
            </span>
            <span class="where">
              {#each hit.locales as locale (locale)}<b class="disc">{locale}</b>{/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="keys">
    <kbd>↑</kbd><kbd>↓</kbd>{SEARCH.moveKeys}
    <kbd>enter</kbd>{SEARCH.openKeys}
    <kbd>esc</kbd>{SEARCH.closeKeys}
    <button class="close" onclick={onClose}>{SEARCH.close}</button>
  </p>
</div>

<style>
  .sheet {
    position: absolute;
    top: 46px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    width: 660px;
    max-width: calc(100% - 32px);
    max-height: 70%;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 0 0 14px 14px;
    box-shadow: 0 24px 60px -24px rgb(0 0 0 / 0.45);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    padding: 10px 18px;
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
    color: var(--muted);
  }

  .head b {
    margin-left: auto;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--draft-tint);
    color: var(--draft);
    font-weight: 500;
    white-space: nowrap;
  }

  .none {
    margin: 0;
    padding: 18px;
    font-size: 13px;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }

  .hit {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 18px;
    border: 0;
    border-bottom: 1px solid var(--rule);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .hit:hover,
  .hit.on {
    background: var(--ground);
  }

  /* the arrow keys move a mark that the mouse does not own, so it has its own rule */
  .hit.on {
    box-shadow: inset 3px 0 0 var(--done);
  }

  .tile {
    width: 22px;
    height: 22px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
  }

  /* the same four rules the row uses: a state that reads differently in two places is two states */
  .tile[data-state='done'] {
    color: var(--rule-strong);
  }

  .tile[data-state='broken'] {
    background: var(--broken);
    color: var(--paper);
  }

  .tile[data-state='missing'] {
    background: var(--missing-tint);
    color: var(--missing);
  }

  .tile[data-state='draft'] {
    background: var(--draft-tint);
    color: var(--draft);
  }

  .what {
    flex: 1;
    min-width: 0;
  }

  .found {
    display: block;
    font-family: var(--serif);
    font-size: 15px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  mark {
    background: var(--draft-tint);
    color: inherit;
    border-radius: 3px;
    padding: 0 2px;
  }

  /* the group sits with the source line: it is context for the hit, never the hit itself */
  .group {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--hollow);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
  }

  .src {
    display: block;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .where {
    flex: none;
    display: flex;
    gap: 4px;
  }

  .disc {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--hollow);
    color: var(--body);
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 400;
    text-transform: uppercase;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 8px 18px;
    border-top: 1px solid var(--rule);
    font-size: 11px;
    color: var(--muted);
  }

  kbd {
    font-family: var(--mono);
    font-size: 10px;
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0 4px;
  }

  .close {
    margin-left: auto;
    border: 0;
    background: none;
    font: inherit;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
