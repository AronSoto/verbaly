<script lang="ts">
  import type { MessageState } from '../model';

  // Each ink carries its own mark, so the ladder reads in greyscale and to a colourblind eye.
  const { state }: { state: MessageState } = $props();

  const WORD: Record<MessageState, string> = {
    done: 'translated',
    draft: 'written by a machine',
    missing: 'not translated, shows in your source language',
    broken: 'breaks your site',
  };
</script>

{#if state === 'done'}
  <svg viewBox="0 0 22 22" width="15" height="15" aria-hidden="true">
    <path d="M5 11h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
{:else if state === 'missing'}
  <svg viewBox="0 0 22 22" width="15" height="15" aria-hidden="true" fill="none">
    <path
      d="M6 12.5 11 7l5 5.5"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path d="M11 8v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  </svg>
{:else if state === 'draft'}
  <svg viewBox="0 0 22 22" width="15" height="15" aria-hidden="true" fill="none">
    <path
      d="M4.5 12.5c1.6-2.2 3.2-2.2 4.8 0s3.2 2.2 4.8 0 3.2-2.2 4.8 0"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
    />
  </svg>
{:else}
  <svg viewBox="0 0 22 22" width="15" height="15" aria-hidden="true">
    <path d="M11 6v6.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <circle cx="11" cy="16" r="1.2" fill="currentColor" />
  </svg>
{/if}
<span class="sr">{WORD[state]}</span>

<style>
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
