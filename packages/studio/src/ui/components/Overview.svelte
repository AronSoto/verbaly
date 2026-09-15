<script lang="ts">
  import Marks from './Marks.svelte';
  import { OVERVIEW, WAITING, WHY } from '../words';
  import type { LocaleHealth, Undefined } from '../model';

  // the overview only ever sends you to a problem, so "done" is not one of its filters
  type Problem = 'broken' | 'missing' | 'draft';
  type Task = { id: keyof typeof WAITING; n: number };

  interface Props {
    health: LocaleHealth[];
    undefinedKeys: Undefined[];
    locales: string[];
    total: number;
    checks: { ok: number; total: number } | null;
    commits: { sha: string; author: string; date: string; subject: string }[] | null;
    onFilter: (state: Problem) => void;
    onHealth: () => void;
  }

  const { health, undefinedKeys, locales, total, checks, commits, onFilter, onHealth }: Props =
    $props();

  const targets = $derived(health.filter((entry) => !entry.source));

  // counted over every target language at once: the first screen is the project, not one locale
  const tasks = $derived.by(() => {
    const sum = (pick: (entry: LocaleHealth) => number) =>
      targets.reduce((n, entry) => n + pick(entry), 0);
    const out: Task[] = [
      { id: 'broken', n: sum((e) => e.broken) },
      { id: 'missing', n: sum((e) => e.missing) },
      { id: 'draft', n: sum((e) => e.draft) },
      { id: 'undefined', n: undefinedKeys.length },
    ];
    return out.filter((task) => task.n > 0);
  });

  const waiting = $derived(tasks.reduce((n, task) => n + task.n, 0));

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  // the card says when, not a timestamp: a date you have to subtract is not an answer
  function when(iso: string): string {
    const days = Math.round((Date.parse(iso) - Date.now()) / 86400000);
    if (days > -1) return relative.format(0, 'day');
    if (days > -31) return relative.format(days, 'day');
    return relative.format(Math.round(days / 30), 'month');
  }
</script>

<main class="overview">
  <header>
    <span class="chip">{OVERVIEW.here}</span>
    {#if waiting > 0}
      <h2>{waiting} {waiting === 1 ? 'thing is' : 'things are'} waiting for you.</h2>
    {:else}
      <h2>{OVERVIEW.clear}</h2>
      <p>{OVERVIEW.clearWhy}</p>
    {/if}
  </header>

  <div class="cols">
    <section class="jobs" aria-label="What needs you">
      {#each tasks as task (task.id)}
        <div class="job">
          <!-- same ink and same mark as broken, because it is the same consequence: the build fails -->
          <span class="tile" data-state={task.id === 'undefined' ? 'broken' : task.id}>
            <Marks state={task.id === 'undefined' ? 'broken' : (task.id as Problem)} />
          </span>
          <span class="what">
            <b>{task.n} {task.n === 1 ? WAITING[task.id].one : WAITING[task.id].many}</b>
            <span>{WHY[task.id]}</span>
            {#if task.id === 'undefined'}
              <code class="keys">{undefinedKeys.slice(0, 3).map((k) => k.key).join(' · ')}</code>
            {/if}
          </span>
          {#if task.id !== 'undefined'}
            <button onclick={() => onFilter(task.id as Problem)}>{OVERVIEW.open}</button>
          {/if}
        </div>
      {/each}
    </section>

    <aside class="side">
      <div class="card">
        <button class="ring" onclick={onHealth} disabled={!checks}>
          <b>{OVERVIEW.project}</b>
          <strong>{checks && checks.ok === checks.total ? OVERVIEW.healthy : OVERVIEW.problems}</strong>
          <span>{checks ? `${checks.ok} of ${checks.total} ${OVERVIEW.checks}` : '…'}</span>
        </button>
        <p class="kv"><b>{OVERVIEW.countMessages}</b><strong>{total}</strong></p>
        <p class="kv"><b>{OVERVIEW.countLocales}</b><strong>{locales.length}</strong></p>
      </div>

      <div class="card">
        <p class="head">{OVERVIEW.history}</p>
        {#if commits === null}
          <p class="empty">…</p>
        {:else if commits.length === 0}
          <p class="empty">{OVERVIEW.noHistory}</p>
        {:else}
          {#each commits as commit (commit.sha)}
            <p class="commit">
              <code>{commit.sha}</code>
              <span><b>{commit.subject}</b><span>{commit.author} · {when(commit.date)}</span></span>
            </p>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
</main>

<style>
  .overview {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--ground);
  }

  header {
    padding: 28px 24px 20px;
  }

  .chip {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--done-tint);
    color: var(--done);
    font-size: 12px;
    font-weight: 500;
  }

  h2 {
    margin: 14px 0 0;
    max-width: 24ch;
    font-size: 30px;
    font-weight: 500;
    letter-spacing: -0.024em;
    line-height: 1.16;
    color: var(--ink);
  }

  header p {
    margin: 10px 0 0;
    font-size: 14px;
    color: var(--muted);
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 20px;
    padding: 0 24px 28px;
    align-items: start;
  }

  .card,
  .jobs {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 14px;
    overflow: hidden;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .job {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-top: 1px solid var(--rule);
  }

  .job:first-child {
    border-top: 0;
  }

  .tile {
    width: 26px;
    height: 26px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
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

  .what b {
    display: block;
    font-size: 15px;
    font-weight: 500;
    color: var(--ink);
  }

  .what > span {
    display: block;
    font-size: 13px;
    color: var(--muted);
  }

  .keys {
    display: block;
    margin-top: 4px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: none;
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--body);
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:hover {
    background: var(--ground);
  }

  .ring {
    width: 100%;
    height: auto;
    display: block;
    padding: 18px 20px;
    text-align: left;
    border: 0;
    border-radius: 0;
  }

  .ring:disabled {
    cursor: default;
  }

  .ring b {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--muted);
  }

  .ring strong {
    display: block;
    margin-top: 2px;
    font-size: 17px;
    font-weight: 500;
    color: var(--ink);
  }

  .ring span {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--muted);
  }

  .kv {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    padding: 0 20px;
    height: 44px;
    border-top: 1px solid var(--rule);
  }

  .kv b {
    flex: 1;
    font-size: 13px;
    font-weight: 400;
    color: var(--body);
  }

  .kv strong {
    font-size: 15px;
    font-weight: 500;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  .head {
    margin: 0;
    padding: 16px 20px;
    border-bottom: 1px solid var(--rule);
    font-size: 15px;
    font-weight: 500;
    color: var(--ink);
  }

  .empty {
    margin: 0;
    padding: 16px 20px;
    font-size: 13px;
    color: var(--muted);
  }

  .commit {
    display: flex;
    gap: 12px;
    margin: 0;
    padding: 10px 20px;
    align-items: flex-start;
  }

  .commit code {
    flex: none;
    margin-top: 2px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .commit > span {
    flex: 1;
    min-width: 0;
  }

  .commit b {
    display: block;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.45;
    color: var(--body);
  }

  .commit span span {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--muted);
  }

  @media (max-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
