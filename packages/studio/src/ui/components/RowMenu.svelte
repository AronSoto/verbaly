<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { originsReason, type Row } from '../model';
  import { MENU } from '../words';
  import type { KeyCommit } from '../api';

  interface Props {
    row: Row;
    locale: string | null;
    scanning: boolean;
    anchor: HTMLElement;
    onEdit: () => void;
    onNote: (text: string) => void;
    onCommit: (key: string) => Promise<KeyCommit | null>;
    onClose: () => void;
  }

  const { row, locale, scanning, anchor, onEdit, onNote, onCommit, onClose }: Props = $props();

  const WIDTH = 308;
  const GAP = 6;

  let box: HTMLDivElement | undefined = $state();
  let at: { top: number; left: number } = $state({ top: -9999, left: -9999 });
  // the annotation goes on the rune: on the variable, Svelte 5 narrows it to the first member
  let found = $state<KeyCommit | null>(null);
  let listing: boolean = $state(false);

  const off = $derived(originsReason(scanning, row.origins));

  // what the clipboard entry shows: the payload when there is one, the reason when there is not
  const commitNote = $derived(
    found === null
      ? MENU.reading
      : found.commit
        ? found.commit.sha
        : MENU[found.reason ?? 'nogit'],
  );

  function place(): void {
    const rect = anchor.getBoundingClientRect();
    const height = box?.offsetHeight ?? 0;
    const below = rect.bottom + GAP;
    // a menu on the last row would hang past the window, so it flips above its own trigger
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - GAP) : below;
    const left = Math.min(Math.max(8, rect.right - WIDTH), window.innerWidth - WIDTH - 8);
    at = { top, left };
  }

  // measured denied in an embedded browser, and three of five entries are a copy: this is the way back
  function selectAndCopy(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(field);
    field.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {
      done = false;
    }
    field.remove();
    return done;
  }

  async function copy(text: string, said: string): Promise<void> {
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      done = selectAndCopy(text);
    }
    onNote(done ? said : MENU.noClipboard);
    onClose();
    anchor.focus();
  }

  function items(): HTMLElement[] {
    return [...(box?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  }

  function keys(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      onClose();
      anchor.focus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const all = items();
    const now = all.indexOf(document.activeElement as HTMLElement);
    all[(now + step + all.length) % all.length]?.focus();
  }

  // the list of files changes the height, so a menu placed below has to be placed again
  async function toggleFiles(): Promise<void> {
    listing = !listing;
    await tick();
    place();
  }

  // a fixed menu is not clipped by the table, and for the same reason it does not scroll with it
  onMount(() => {
    let live = true;
    place();
    items()[0]?.focus();
    void onCommit(row.key).then((answer) => {
      if (live) found = answer ?? { key: row.key, commit: null, reason: 'nogit' };
    });
    const leave = () => onClose();
    window.addEventListener('scroll', leave, true);
    window.addEventListener('resize', leave);
    return () => {
      live = false;
      window.removeEventListener('scroll', leave, true);
      window.removeEventListener('resize', leave);
    };
  });

  function outside(event: PointerEvent): void {
    const target = event.target as Node;
    if (!box?.contains(target) && !anchor.contains(target)) onClose();
  }
</script>

<svelte:window onpointerdown={outside} />

<div
  class="menu"
  role="menu"
  tabindex="-1"
  aria-label={MENU.open}
  bind:this={box}
  style="top:{at.top}px;left:{at.left}px"
  onkeydown={keys}
>
  <button
    class="mi"
    role="menuitem"
    aria-disabled={locale === null}
    onclick={() => (locale === null ? onNote(MENU.nothingToEdit) : onEdit())}
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9 7-5 5 5 5" /><path d="m15 7 5 5-5 5" />
    </svg>
    {MENU.edit}<i>{locale ?? ''}</i>
  </button>

  <button class="mi" role="menuitem" onclick={() => copy(row.key, MENU.copiedKey)}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" />
    </svg>
    {MENU.copyKey}<i>{row.key}</i>
  </button>

  <button class="mi" role="menuitem" onclick={() => copy(row.source, MENU.copiedSource)}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
    </svg>
    {MENU.copySource}
  </button>

  <div class="msep"></div>

  <button
    class="mi"
    role="menuitem"
    aria-disabled={!found?.commit}
    title={found?.commit
      ? `${found.commit.subject} · ${found.commit.author} · ${found.commit.date.slice(0, 10)}`
      : undefined}
    onclick={() => found?.commit && copy(found.commit.sha, MENU.copiedSha)}
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 1.8" />
    </svg>
    {MENU.commit}<i>{commitNote}</i>
  </button>

  <button
    class="mi"
    role="menuitem"
    aria-disabled={off !== null}
    aria-expanded={off === null ? listing : undefined}
    onclick={() => off === null && toggleFiles()}
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 5h5v5" /><path d="m19 5-8 8" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
    {MENU.origins}<i
      >{off
        ? MENU[off]
        : row.origins.length > 1
          ? `${row.origins[0]} +${row.origins.length - 1}`
          : row.origins[0]}</i
    >
  </button>

  {#if listing && off === null}
    <ul class="files">
      {#each row.origins as file (file)}
        <li>{file}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* fixed, because the table scrolls and an absolute menu on the last row is clipped by it */
  .menu {
    position: fixed;
    z-index: 8;
    width: 308px;
    padding: 4px 0;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 10px;
    /* the menu sits on the same paper as the table, so the shadow is what makes it a layer */
    box-shadow: var(--lift);
  }

  .mi {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13.5px;
    color: var(--body);
    text-align: left;
    cursor: pointer;
  }

  .mi svg {
    flex: none;
    color: var(--muted);
  }

  .mi i {
    margin-left: auto;
    font-style: normal;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    max-width: 154px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mi:hover,
  .mi:focus-visible {
    background: var(--ground);
    outline: none;
  }

  .mi[aria-disabled='true'] {
    color: var(--muted);
    cursor: not-allowed;
  }

  .mi[aria-disabled='true']:hover {
    background: none;
  }

  .msep {
    height: 1px;
    margin: 4px 0;
    background: var(--rule);
  }

  /* the trailing note clips a path to 154px, so seeing the whole list is what the entry is for */
  .files {
    margin: 0;
    padding: 2px 12px 8px 39px;
    list-style: none;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.6;
    color: var(--muted);
    word-break: break-all;
  }
</style>
