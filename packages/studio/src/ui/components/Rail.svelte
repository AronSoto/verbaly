<script lang="ts">
  import { FILTER, GROUP, MARK_AS_READ, UNDO } from '../words';
  import type { Snippet } from 'svelte';
  import type { Group, LocaleHealth, MessageState } from '../model';

  type Which = 'all' | 'look' | 'missing' | 'draft' | 'broken';
  type View = 'overview' | 'messages' | 'health';

  interface Props {
    health: LocaleHealth[];
    shown: string[];
    state: Which;
    counts: Record<string, number>;
    pending: { locale: string; keys: string[] } | null;
    onToggle: (locale: string) => void;
    onState: (state: Which) => void;
    onRead: (locale: string) => void;
    onUndo: () => void;
    checks: { bad: number } | null;
    view: View;
    onView: (view: View) => void;
    groups: Group[];
    group: string | null;
    onGroup: (group: string | null) => void;
    actions: Snippet;
  }

  const {
    health,
    shown,
    state,
    counts,
    pending,
    checks,
    onToggle,
    onState,
    onRead,
    onUndo,
    view,
    onView,
    groups,
    group,
    onGroup,
    actions,
  }: Props = $props();

  const VIEWS: { id: View; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'messages', label: 'Messages' },
    { id: 'health', label: 'Health' },
  ];

  const ORDER: Which[] = ['all', 'look', 'missing', 'draft', 'broken'];

  // the second line is the state, and it is what makes the rail worth more than a dropdown
  function summary(h: LocaleHealth): string {
    if (h.source) return 'the one you write';
    if (h.broken) return `${h.broken} breaks your site`;
    if (h.missing) return `${h.missing} missing`;
    if (h.draft) return `${h.draft} nobody has read`;
    return 'all read';
  }

  function tone(h: LocaleHealth): MessageState {
    if (h.source) return 'done';
    if (h.broken) return 'broken';
    if (h.missing) return 'missing';
    if (h.draft) return 'draft';
    return 'done';
  }
</script>

<nav class="rail" aria-label="Languages and filters">
  <ul class="views">
    {#each VIEWS as item (item.id)}
      <li>
        <button
          class="nav"
          class:on={view === item.id}
          aria-current={view === item.id ? 'page' : undefined}
          onclick={() => onView(item.id)}
        >
          <span>{item.label}</span>
          {#if item.id === 'health' && checks}
            <span class="bad" class:clean={!checks.bad}>{checks.bad || 'ok'}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>

  {@render actions()}

  <h2 class="cap">Languages</h2>
  <ul class="langs">
    {#each health as h (h.locale)}
      <li>
        <label class="lang" class:source={h.source}>
          <input
            type="checkbox"
            checked={shown.includes(h.locale)}
            disabled={h.source}
            onchange={() => onToggle(h.locale)}
          />
          <span class="meta">
            <span class="name">{h.locale}</span>
            <span class="state" data-state={tone(h)}>{summary(h)}</span>
          </span>
        </label>
        {#if !h.source && h.draft > 0}
          <!-- no confirming dialog: the action is reversible and undo lives right here, not in a toast -->
          <button class="read" onclick={() => onRead(h.locale)}>
            {MARK_AS_READ}
            <span class="n">{h.draft}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if pending}
    <p class="undo">
      <span>{pending.keys.length} in {pending.locale} marked as read</span>
      <button onclick={onUndo}>{UNDO}</button>
    </p>
  {/if}

  {#if groups.length}
    <h2 class="cap">{GROUP.cap}</h2>
    <select
      class="groups"
      aria-label={GROUP.cap}
      value={group ?? ''}
      onchange={(event) => onGroup(event.currentTarget.value || null)}
    >
      <option value="">{GROUP.all}</option>
      {#each groups as item (item.name)}
        <option value={item.name}>
          {item.name} ({item.total}){item.broken + item.missing + item.draft > 0
            ? ` · ${item.broken + item.missing + item.draft} to do`
            : ''}
        </option>
      {/each}
    </select>
  {/if}

  <h2 class="cap">Show</h2>
  <ul class="filters">
    {#each ORDER as which (which)}
      <li>
        <button type="button" class:on={state === which} onclick={() => onState(which)}>
          <span>{FILTER[which]}</span>
          <span class="count">{counts[which] ?? 0}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .rail {
    width: var(--rail);
    flex: none;
    padding: 18px 14px;
    border-right: 1px solid var(--rule);
    background: var(--ground);
    overflow-y: auto;
  }

  .views {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--body);
    cursor: pointer;
    text-align: left;
  }

  .nav:hover {
    background: var(--hollow);
  }

  /* the current view is marked, not just hoverable: a rail with no anchor is a list of buttons */
  .nav.on {
    background: var(--done-tint);
    color: var(--done);
    font-weight: 500;
    box-shadow: inset 2px 0 0 var(--done);
  }

  .bad {
    margin-left: auto;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--broken-tint);
    color: var(--broken);
    font-family: var(--mono);
    font-size: 11px;
  }

  .bad.clean {
    background: var(--done-tint);
    color: var(--done);
  }

  .groups {
    width: 100%;
    margin-bottom: 18px;
    padding: 7px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--body);
    font: inherit;
    font-size: 13px;
  }

  .cap {
    margin: 0 0 8px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  ul {
    margin: 0 0 22px;
    padding: 0;
    list-style: none;
  }

  .lang {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 6px;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .lang:hover {
    background: var(--hollow);
  }

  .lang.source {
    cursor: default;
  }

  .lang input {
    margin: 4px 0 0;
    accent-color: var(--done);
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }

  .state {
    font-size: 11.5px;
    color: var(--muted);
  }

  .state[data-state='broken'] {
    color: var(--broken);
  }
  .state[data-state='missing'] {
    color: var(--missing);
  }
  .state[data-state='draft'] {
    color: var(--draft);
  }

  .read {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 6px 30px;
    padding: 3px 9px;
    border: 1px solid var(--draft);
    border-radius: 999px;
    background: var(--draft-tint);
    color: var(--draft);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }

  .read .n {
    font-family: var(--mono);
    opacity: 0.8;
  }

  /* undo lives in the rail and does not expire: for hundreds of messages a toast is not undo */
  .undo {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -14px 0 22px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--hollow);
    font-size: 11.5px;
    color: var(--body);
  }

  .undo button {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }

  .filters button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--body);
    cursor: pointer;
    text-align: left;
  }

  .filters button:hover {
    background: var(--hollow);
  }

  .filters button.on {
    background: var(--hollow);
    color: var(--ink);
    font-weight: 600;
  }

  /* the number is half the value: it says whether entering is worth it before you enter */
  .count {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
</style>
