<script lang="ts">
  interface Entry {
    level: 'ok' | 'warn' | 'error';
    check: string;
    message: string;
    fix?: string;
  }

  interface Props {
    entries: Entry[];
    ok: boolean;
    onClose: () => void;
  }

  const { entries, ok, onClose }: Props = $props();

  // doctor names the part of the compiler that answered; this says what it means for your project
  const TITLE: Record<string, string> = {
    config: 'Your settings',
    cli: 'The verbaly command',
    catalogs: 'Your catalogs',
    routing: 'Where the language lives in your urls',
    plugin: 'The piece that wires your build',
    types: 'The generated types',
    sources: 'Reading your code',
    orphans: 'Keys nothing in your code uses',
    bundle: 'What the browser downloads',
    translations: 'The translations themselves',
  };

  const bad = $derived(entries.filter((e) => e.level !== 'ok').length);
</script>

<section class="health" aria-label="Health">
  <header>
    <h2>{ok ? 'Nothing is broken' : `${bad} of ${entries.length} need you`}</h2>
    <p>
      This is the same check <code>npx verbaly doctor</code> runs, read out loud. It looks at your
      settings, your catalogs and the way your build is wired, and it never changes anything.
    </p>
    <button class="close" onclick={onClose}>Back to the messages</button>
  </header>

  <ul>
    <!-- doctor can report the same check twice, so the position is the only unique key here -->
    {#each entries as entry, i (i)}
      <li data-level={entry.level}>
        <span class="mark" aria-hidden="true">
          {#if entry.level === 'ok'}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.4 8.4 3 3 6.2-6.8" /></svg>
          {:else if entry.level === 'warn'}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 4v5" /><path d="M8 12h.01" /></svg>
          {:else}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          {/if}
        </span>
        <span class="body">
          <b>{TITLE[entry.check] ?? entry.check}</b>
          <span class="msg">{entry.message}</span>
          {#if entry.fix}
            <span class="fix">{entry.fix}</span>
          {/if}
        </span>
        <span class="sr">{entry.level}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .health {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--paper);
  }

  header {
    padding: 28px 24px 20px;
    border-bottom: 1px solid var(--rule);
  }

  h2 {
    margin: 0;
    font-size: 21px;
    font-weight: 500;
    letter-spacing: -0.014em;
    color: var(--ink);
  }

  header p {
    margin: 8px 0 0;
    max-width: 64ch;
    font-size: 13px;
    color: var(--muted);
  }

  .close {
    margin-top: 16px;
    padding: 5px 12px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--body);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .close:hover {
    background: var(--ground);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--rule);
  }

  .mark {
    width: 20px;
    height: 20px;
    flex: none;
    margin-top: 1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--done-tint);
    color: var(--done);
  }

  [data-level='warn'] .mark {
    background: var(--missing-tint);
    color: var(--missing);
  }

  [data-level='error'] .mark {
    background: var(--broken-tint);
    color: var(--broken);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  b {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
  }

  .msg {
    font-size: 13px;
    color: var(--body);
  }

  /* the remedy is the whole point of a diagnosis, so it never hides behind a disclosure */
  .fix {
    margin-top: 4px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--draft);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
