<script lang="ts">
  import Marks from './Marks.svelte';
  import { preview } from '../validate';
  import { SIGNAL, STATE } from '../words';
  import type { Cell, Row } from '../model';

  interface Props {
    row: Row;
    shown: string[];
    editing: string | null;
    onEdit: (id: string | null) => void;
    onSave: (locale: string, key: string, text: string) => Promise<string | null>;
  }

  const { row, shown, editing, onEdit, onSave }: Props = $props();
  const cells = $derived(row.cells.filter((cell) => shown.includes(cell.locale)));
  // the row's own state is the worst of the languages you are comparing, so the tile never lies
  const worst = $derived(
    (['broken', 'missing', 'draft', 'done'] as const).find((s) =>
      cells.some((c) => c.state === s),
    ) ?? 'done',
  );

  let draft: string = $state('');
  let saving: boolean = $state(false);
  let refused: string | null = $state(null);

  const live = $derived(preview(row.source, draft));
  const id = (cell: Cell) => `${cell.locale} ${row.key}`;

  function open(cell: Cell) {
    draft = cell.text;
    refused = null;
    onEdit(id(cell));
  }

  async function commit(cell: Cell) {
    if (saving) return;
    saving = true;
    refused = await onSave(cell.locale, row.key, draft);
    saving = false;
    if (!refused) onEdit(null);
  }

  function keys(event: KeyboardEvent, cell: Cell) {
    if (event.key === 'Escape') onEdit(null);
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void commit(cell);
    }
  }
</script>

<article class="row" class:open={cells.some((c) => editing === id(c))} data-worst={worst}>
  <span class="tile" data-state={worst}><Marks state={worst} /></span>

  <span class="row-t">
    <span class="src">{row.source}</span>

    {#each cells as cell (cell.locale)}
      {#if editing === id(cell)}
        <span class="tl edit">
          <span class="disc" data-state={cell.state}>{cell.locale}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            class="tf"
            bind:value={draft}
            autofocus
            rows="2"
            aria-label="Translation for {cell.locale}"
            onkeydown={(event) => keys(event, cell)}
          ></textarea>
        </span>
        <span class="editbar">
          {#each live.params as param (param.name)}
            <span class="pm" class:gone={param.inSource && !param.inTarget}
              >{param.inSource && !param.inTarget ? '+' : ''}&#123;{param.name}&#125;</span
            >
          {/each}
          {#each live.problems as problem (problem)}
            <span class="vmsg">{problem}</span>
          {/each}
          <!-- the preview is a subset of the gate, so the server only speaks when it saw more -->
          {#if refused && !live.problems.length}
            <span class="vmsg">{refused}</span>
          {/if}
          <button class="btn sm" disabled={saving} onclick={() => commit(cell)}>
            {saving ? 'Saving' : 'Save'}
          </button>
          <button class="btn sm quiet" onclick={() => onEdit(null)}>Cancel</button>
          <span class="keys">Enter saves · Esc closes</span>
        </span>
      {:else}
        <span class="tl">
          <span class="disc" data-state={cell.state}>{cell.locale}</span>
          {#if cell.text}
            <button class="tv" onclick={() => open(cell)} title={cell.text}>{cell.text}</button>
          {:else}
            <button class="tv none" onclick={() => open(cell)}>{STATE.missing.long}</button>
          {/if}
          {#each cell.signals as signal (signal)}
            <span class="sig" title={SIGNAL[signal] ?? signal}>{SIGNAL[signal] ?? signal}</span>
          {/each}
        </span>
      {/if}
    {/each}
  </span>
</article>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    min-height: 64px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--rule);
  }

  .row:hover {
    background: var(--ground);
  }

  .row.open {
    background: var(--paper);
    box-shadow: inset 3px 0 0 var(--done);
    outline: 1px solid var(--rule);
    outline-offset: -1px;
  }

  .tile {
    width: 26px;
    height: 26px;
    flex: none;
    margin-top: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
  }

  .tile[data-state='done'] {
    color: var(--rule-strong);
  }
  .tile[data-state='draft'] {
    background: var(--draft-tint);
    color: var(--draft);
  }
  .tile[data-state='missing'] {
    background: var(--missing-tint);
    color: var(--missing);
  }
  .tile[data-state='broken'] {
    background: var(--broken);
    color: var(--paper);
  }

  .row-t {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  /* the original is context: one line, clipped, quieter than the thing you came to correct */
  .src {
    font-size: 13.5px;
    line-height: 1.3;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tl {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .tl.edit {
    align-items: flex-start;
  }

  /* a flag is not a language and Windows will not draw one: a disc with the code, in its state */
  .disc {
    width: 20px;
    height: 20px;
    flex: none;
    transform: translateY(3px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--hollow);
    color: var(--body);
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: -0.02em;
  }

  .disc[data-state='done'] {
    background: var(--done-tint);
    color: var(--done);
  }
  .disc[data-state='draft'] {
    background: var(--draft-tint);
    color: var(--draft);
  }
  .disc[data-state='missing'] {
    background: var(--missing-tint);
    color: var(--missing);
  }
  .disc[data-state='broken'] {
    background: var(--broken-tint);
    color: var(--broken);
  }

  .tv {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    font-family: var(--serif);
    font-size: 17px;
    line-height: 1.35;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
  }

  /* a signal is a margin note, never a state: it points, it does not judge */
  .sig {
    flex: none;
    font-size: 11px;
    color: var(--draft);
    background: var(--draft-tint);
    border-radius: 4px;
    padding: 1px 6px;
    white-space: nowrap;
  }

  .tv.none {
    font-family: var(--sans);
    font-size: 13px;
    font-style: italic;
    color: var(--missing);
  }

  .tf {
    flex: 1;
    min-width: 0;
    font-family: var(--serif);
    font-size: 17px;
    line-height: 1.45;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--done);
    border-radius: var(--radius);
    padding: 6px 10px;
    resize: vertical;
  }

  .tf:focus-visible {
    outline: 2px solid color-mix(in oklab, var(--done) 26%, transparent);
    outline-offset: 1px;
  }

  .editbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  /* a param is a chip so you can see it survive, and the one that did not is dashed and red */
  .pm {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--body);
    background: var(--hollow);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .pm.gone {
    background: var(--broken-tint);
    border: 1px dashed var(--broken);
    color: var(--broken);
  }

  .vmsg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--broken);
    background: var(--broken-tint);
    border-radius: var(--radius);
    padding: 4px 9px;
  }

  .btn {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--done);
    border-radius: var(--radius);
    background: var(--done);
    color: var(--paper);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn.quiet {
    background: var(--paper);
    color: var(--body);
    border-color: var(--rule-strong);
    font-weight: 400;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .keys {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }
</style>
