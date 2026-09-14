<script lang="ts">
  import { onMount } from 'svelte';
  import { ACTION, messages } from './words';
  import type { Job, Plan, StudioApi } from './api';

  interface Props {
    api: StudioApi;
    scanning: boolean;
    targets: number;
    shown: string[];
    onDone: (said: string) => Promise<void> | void;
  }

  const { api, scanning, targets, shown, onDone }: Props = $props();

  type Phase =
    | { at: 'idle' }
    | { at: 'finding' }
    | { at: 'planning' }
    | { at: 'plan'; plan: Plan }
    | { at: 'running'; job: Job }
    | { at: 'said'; text: string; bad: boolean };

  // the annotation goes on the rune: on the declaration, phase narrows to its first member
  let phase = $state<Phase>({ at: 'idle' });
  const busy = $derived(phase.at === 'finding' || phase.at === 'planning' || phase.at === 'running');

  function said(text: string, bad = false) {
    phase = { at: 'said', text, bad };
  }

  async function find() {
    phase = { at: 'finding' };
    const answer = await api.extract();
    if (answer.error || !answer.value) return said(answer.error ?? 'no answer', true);
    const { found } = answer.value;
    if (!found) return said(ACTION.nothingNew);
    const wrote = `${messages(found)} your code uses and your catalogs did not have`;
    await onDone(wrote);
    said(wrote);
  }

  async function plan() {
    phase = { at: 'planning' };
    const answer = await api.plan(shown);
    if (answer.error || !answer.value) return said(answer.error ?? 'no answer', true);
    if (!answer.value.total) return said(ACTION.nothingMissing);
    phase = { at: 'plan', plan: answer.value };
  }

  // the bar is asked, never pushed: translate writes partial results, so a reload must not lose it
  async function poll(id: string) {
    const answer = await api.job(id);
    if (answer.error || !answer.value) return said(answer.error ?? 'no answer', true);
    const job = answer.value;
    if (job.state === 'running') {
      phase = { at: 'running', job };
      return;
    }
    // every translation a machine wrote is a draft, and the panel has to say so out loud
    const wrote = `${messages(job.done)} translated, unread until you read them`;
    await onDone(wrote);
    said(job.state === 'failed' ? (job.message ?? 'the run failed') : wrote, job.state === 'failed');
  }

  async function go() {
    const answer = await api.translate(shown);
    if (answer.error || !answer.value) return said(answer.error ?? 'no answer', true);
    phase = { at: 'running', job: answer.value };
  }

  // a run outlives the page that started it, so the bar comes back instead of the job hiding
  onMount(() => {
    void api.job().then((answer) => {
      if (answer.value && phase.at === 'idle') phase = { at: 'running', job: answer.value };
    });
  });

  $effect(() => {
    if (phase.at !== 'running') return;
    const id = phase.job.id;
    const timer = setInterval(() => void poll(id), 1000);
    return () => clearInterval(timer);
  });

  // a disabled control still owes you the reason, and the reason is not always the same one
  const why = $derived(
    !targets ? ACTION.onlyLocale : shown.length ? ACTION.translateWhy : ACTION.pickFirst,
  );

  const share = $derived(
    phase.at === 'running' && phase.job.total ? phase.job.done / phase.job.total : 0,
  );
</script>

<section class="acts" aria-label="Commands">
  <h2 class="cap">Commands</h2>

  {#if phase.at === 'plan'}
    <div class="bill">
      <p class="lede">{messages(phase.plan.total)} in {Object.keys(phase.plan.pending).join(', ')}</p>
      <p class="why">{ACTION.translateWhy}</p>
      <div class="pair">
        <button class="go" onclick={go}>{ACTION.translate}</button>
        <button class="plain" onclick={() => (phase = { at: 'idle' })}>{ACTION.cancel}</button>
      </div>
    </div>
  {:else if phase.at === 'running'}
    <div class="bill">
      <p class="lede">{ACTION.running} {phase.job.locale ?? ''}</p>
      <div class="track"><span class="fill" style="width: {Math.round(share * 100)}%"></span></div>
      <p class="why">{phase.job.done} of {phase.job.total}</p>
    </div>
  {:else}
    <button class="act" disabled={busy || !scanning} onclick={find}>
      <span class="name">{phase.at === 'finding' ? ACTION.working : ACTION.find}</span>
      <span class="why">{scanning ? ACTION.findWhy : ACTION.scanOff}</span>
    </button>
    <button class="act" disabled={busy || !shown.length} onclick={plan}>
      <span class="name">{ACTION.translate}</span>
      <span class="why">{why}</span>
    </button>
  {/if}

  {#if phase.at === 'said'}
    <p class="said" class:bad={phase.bad}>{phase.text}</p>
  {/if}
</section>

<style>
  .acts {
    margin-bottom: 22px;
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

  .act {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    margin-bottom: 4px;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    font: inherit;
    color: var(--body);
    cursor: pointer;
    text-align: left;
  }

  .act:hover:not(:disabled) {
    background: var(--hollow);
  }

  .act:disabled {
    cursor: default;
  }

  /* only the name dims: the line under it is where a disabled button says why it is disabled */
  .act:disabled .name {
    opacity: 0.55;
  }

  .name {
    font-size: 13px;
    color: var(--ink);
  }

  .why {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--muted);
  }

  .bill {
    padding: 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper);
  }

  .lede {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--ink);
  }

  .pair {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }

  .go {
    flex: 1;
    padding: 5px 10px;
    border: 0;
    border-radius: var(--radius);
    background: var(--done);
    /* paper turns with the theme, so the label stays legible on both greens */
    color: var(--paper);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .plain {
    padding: 5px 10px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: none;
    color: var(--body);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  /* the one thing on this screen that moves, because it reports a run that is really happening */
  .track {
    height: 4px;
    margin: 8px 0 6px;
    border-radius: 999px;
    background: var(--hollow);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--done);
    transition: width 0.3s linear;
  }

  .said {
    margin: 6px 0 0;
    padding: 0 8px;
    font-size: 11.5px;
    color: var(--muted);
  }

  .said.bad {
    color: var(--broken);
  }
</style>
