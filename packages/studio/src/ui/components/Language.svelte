<script lang="ts">
  import { localeName } from 'verbaly';
  import { messages, TRIAGE } from '../words';

  export type Chip = 'all' | 'look' | 'clean';

  interface Props {
    locale: string;
    total: number;
    unread: number;
    broken: number;
    flagged: number;
    chip: Chip | null;
    onChip: (chip: Chip) => void;
    onApprove: () => void;
  }

  const { locale, total, unread, broken, flagged, chip, onChip, onApprove }: Props = $props();

  // the endonym, because a language names itself better than its tag does; the tag keeps the disc
  const name = $derived(localeName(locale));

  // the order is the argument: it already shipped, nothing is broken, and only these need you
  const lines = $derived(
    [
      unread > 0 ? TRIAGE.written(unread) : TRIAGE.nothingUnread,
      broken > 0 ? TRIAGE.broken(broken) : TRIAGE.sound,
      flagged > 0 ? TRIAGE.flagged(flagged) : TRIAGE.clean,
    ].join(' '),
  );

  const chips = $derived([
    { id: 'all' as const, label: TRIAGE.chipAll, n: total },
    { id: 'look' as const, label: TRIAGE.chipLook, n: flagged },
    { id: 'clean' as const, label: TRIAGE.chipClean, n: total - flagged },
  ]);
</script>

<header class="langbar">
  <div class="text">
    <h2>{name}</h2>
    <p class="live"><span class="disc">{locale}</span>{messages(total)}. <b>{TRIAGE.live}</b></p>
    <p class="why">{lines}</p>
  </div>
  <div class="go">
    <button class="btn" disabled={unread === 0} onclick={onApprove}>{TRIAGE.approve(name)}</button>
    <span class="sub">{unread > 0 ? TRIAGE.approveSub(unread) : TRIAGE.nothingUnread}</span>
  </div>
</header>

<div class="chips">
  {#each chips as item (item.id)}
    <button
      class="pill"
      class:on={chip === item.id}
      class:look={item.id === 'look'}
      aria-pressed={chip === item.id}
      onclick={() => onChip(item.id)}
    >
      {item.label} <b>{item.n}</b>
    </button>
  {/each}
</div>

<style>
  .langbar {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 24px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 21px;
    font-weight: 500;
    letter-spacing: -0.014em;
    color: var(--ink);
  }

  .live {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 0;
    font-size: 13.5px;
    color: var(--body);
  }

  .live b {
    font-weight: 500;
    color: var(--ink);
  }

  .disc {
    width: 20px;
    height: 20px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--done-tint);
    color: var(--done);
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
  }

  .why {
    margin: 4px 0 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--muted);
    max-width: 80ch;
  }

  .go {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .btn {
    height: 36px;
    padding: 0 16px;
    border: 1px solid var(--done);
    border-radius: var(--radius);
    background: var(--done);
    color: var(--paper);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn:disabled {
    border-color: var(--rule);
    background: var(--ground);
    color: var(--muted);
    cursor: default;
  }

  .sub {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .chips {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }

  .pill {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--paper);
    color: var(--body);
    font-family: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .pill b {
    margin-left: 3px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .pill:hover {
    background: var(--ground);
  }

  .pill.on {
    border-color: var(--done);
    background: var(--done-tint);
    color: var(--done);
  }

  .pill.look.on {
    border-color: var(--missing);
    background: var(--missing-tint);
    color: var(--missing);
  }
</style>
