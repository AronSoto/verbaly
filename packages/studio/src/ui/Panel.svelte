<script lang="ts">
  import HealthView from './Health.svelte';
  import Rail from './Rail.svelte';
  import RowView from './Row.svelte';
  import { applyState, health, visible, type Panel } from './model';
  import Actions from './Actions.svelte';
  import type { Check, StudioApi } from './api';

  interface Props {
    panel: Panel;
    api: StudioApi;
  }

  const { panel, api }: Props = $props();

  let editing: string | null = $state(null);
  let note: { text: string; file: string } | null = $state(null);
  let pending: { locale: string; keys: string[] } | null = $state(null);
  let view: 'messages' | 'health' = $state('messages');
  let checks: { ok: boolean; entries: Check[] } | null = $state(null);

  // doctor reads the disk, so it is asked once at boot and again whenever you open the view
  async function openHealth() {
    view = 'health';
    const result = await api.health();
    if (result.error) {
      note = { text: result.error, file: '' };
      return;
    }
    if (result.value) checks = result.value;
  }

  $effect(() => {
    void api.health().then((result) => {
      if (result.value) checks = result.value;
    });
  });

  // a command rewrote the catalogs, so the panel re-reads them instead of patching key by key
  async function refresh(said: string) {
    const answer = await api.state();
    if (answer.error || !answer.value) {
      note = { text: answer.error ?? '[verbaly] the server sent no state', file: '' };
      return;
    }
    // the open editor and the undo both point at keys this run may have moved under them
    editing = null;
    pending = null;
    applyState(panel, answer.value);
    note = { text: said, file: '' };
    const next = await api.health();
    if (next.value) checks = next.value;
  }

  // the flag says who wrote the text, so both directions are a write and both report what moved
  async function setRead(locale: string, keys: string[] | undefined, undo: boolean) {
    const result = await api.setRead(locale, keys, undo);
    if (result.error) {
      note = { text: result.error, file: '' };
      return;
    }
    const moved = new Set(result.value?.keys ?? []);
    for (const row of panel.rows) {
      if (!moved.has(row.key)) continue;
      const cell = row.cells.find((c) => c.locale === locale);
      if (cell?.text) cell.state = undo ? 'draft' : 'done';
    }
    pending = undo ? null : { locale, keys: result.value?.keys ?? [] };
  }

  // the row shows what the server refused; the panel only celebrates what it accepted
  async function save(locale: string, key: string, text: string): Promise<string | null> {
    const result = await api.save(locale, key, text);
    if (result.error) return result.error;
    const row = panel.rows.find((r) => r.key === key);
    const cell = row?.cells.find((c) => c.locale === locale);
    if (cell) {
      cell.text = text;
      cell.state = text ? 'done' : 'missing';
      cell.issue = undefined;
    }
    note = { text, file: `${locale}.json` };
    return null;
  }

  // `state` would shadow the rune, so the filter is named for what it reads like at the call site
  let only: 'all' | 'look' | 'missing' | 'draft' | 'broken' = $state('all');
  let text: string = $state('');
  // null means nobody has picked yet, so the default follows the project instead of freezing at mount
  let picked: string[] | null = $state(null);

  const targets = $derived(panel.locales.filter((locale) => locale !== panel.sourceLocale));
  const shown = $derived(picked ?? targets.slice(0, 1));

  const rail = $derived(health(panel));
  const rows = $derived(visible(panel.rows, { text, state: only, locales: shown }));

  // every count is over the languages actually shown, so the rail never promises rows a filter hides
  const counts = $derived.by(() => {
    const out: Record<string, number> = { all: 0, look: 0, missing: 0, draft: 0, broken: 0 };
    for (const id of ['all', 'look', 'missing', 'draft', 'broken'] as const) {
      out[id] = visible(panel.rows, { text, state: id, locales: shown }).length;
    }
    return out;
  });

  // a virtual window is a slice here: it measured 0.000 ms on the real catalog, so no library
  const STEP = 60;
  let limit: number = $state(STEP);
  $effect(() => {
    void text;
    void only;
    void shown;
    limit = STEP;
  });

  function onScroll(event: Event) {
    const el = event.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && limit < rows.length) {
      limit += STEP;
    }
  }

  function toggle(locale: string) {
    picked = shown.includes(locale)
      ? shown.filter((other: string) => other !== locale)
      : [...shown, locale];
  }
</script>

<div class="shell">
  <header class="bar">
    <span class="brand">verbaly <b>studio</b></span>
    <input
      class="search"
      type="search"
      bind:value={text}
      placeholder="Search the text, not the key"
      aria-label="Search the text, not the key"
    />
    <span class="root" title={panel.root}>{panel.root}</span>
  </header>

  {#if panel.problems.length}
    <ul class="problems">
      {#each panel.problems as problem (problem.scope + problem.message)}
        <li><code>{problem.scope}</code> {problem.message}</li>
      {/each}
    </ul>
  {/if}

  <div class="body">
    <Rail
      health={rail}
      {shown}
      state={only}
      {counts}
      {pending}
      checks={checks ? { bad: checks.entries.filter((e) => e.level !== 'ok').length } : null}
      onToggle={toggle}
      onState={(next) => (only = next)}
      onRead={(locale) => setRead(locale, undefined, false)}
      onUndo={() => pending && setRead(pending.locale, pending.keys, true)}
      onHealth={openHealth}
    >
      {#snippet actions()}
        <Actions {api} {shown} onDone={refresh} />
      {/snippet}
    </Rail>

    {#if view === 'health'}
      <HealthView
        entries={checks?.entries ?? []}
        ok={checks?.ok ?? true}
        onClose={() => (view = 'messages')}
      />
    {:else}
    <main class="table" onscroll={onScroll}>
      {#if !shown.length}
        <p class="note">Tick a language in the rail to see its translations.</p>
      {:else if !rows.length}
        <p class="note">Nothing matches. Every message here is in the state you asked for.</p>
      {:else}
        {#each rows.slice(0, limit) as row (row.key)}
          <RowView {row} {shown} {editing} onEdit={(id) => (editing = id)} onSave={save} />
        {/each}
        {#if limit < rows.length}
          <p class="note">{rows.length - limit} more below</p>
        {/if}
      {/if}
    </main>
    {/if}
  </div>

  {#if note}
    <p class="snack" role="status">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3.4 8.4 3 3 6.2-6.8" />
      </svg>
      {#if note.file}Saved in <code>{note.file}</code>{:else}{note.text}{/if}
      <button onclick={() => (note = null)}>Dismiss</button>
    </p>
  {/if}
</div>

<style>
  .shell {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* the bar stays ink in both themes: the one brand colour cannot vanish on a theme switch */
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: none;
    padding: 0 16px;
    height: 48px;
    background: var(--bar);
    color: var(--on-bar);
    /* the bar keeps its value in both themes, so in dark it needs an edge: it measured 1.01:1 */
    box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.12);
  }

  .brand {
    font-size: 13px;
    letter-spacing: 0.02em;
    opacity: 0.75;
    white-space: nowrap;
  }

  .brand b {
    opacity: 1;
    font-weight: 600;
  }

  .search {
    flex: 1;
    max-width: 520px;
    padding: 6px 12px;
    border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: var(--radius);
    background: rgb(255 255 255 / 0.06);
    color: var(--on-bar);
    font: inherit;
    font-size: 13px;
  }

  .search::placeholder {
    color: rgb(255 255 255 / 0.45);
  }

  .search:focus-visible {
    outline: 2px solid var(--done);
    outline-offset: 1px;
  }

  .root {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11.5px;
    opacity: 0.55;
    max-width: 30ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .problems {
    margin: 0;
    padding: 8px 16px;
    list-style: none;
    background: var(--broken-tint);
    color: var(--broken);
    font-size: 12.5px;
    border-bottom: 1px solid var(--rule);
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .table {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--paper);
  }

  .note {
    margin: 0;
    padding: 24px 20px;
    color: var(--muted);
    font-size: 13px;
  }

  /* the one thing that moves: it reports a write that really happened, and it waits to be dismissed */
  .snack {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    height: 44px;
    padding: 0 12px 0 20px;
    background: var(--bar);
    color: var(--on-bar);
    border-radius: var(--radius);
    font-size: 13px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgb(6 16 5 / 0.18), 0 34px 64px -28px rgb(6 16 5 / 0.4);
  }

  .snack svg {
    color: #8ed67f;
  }

  .snack button {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.14);
    color: inherit;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
</style>
