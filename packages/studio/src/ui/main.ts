import { mount } from 'svelte';
import Panel from './Panel.svelte';
import { reactivePanel } from './store.svelte';
import './tokens.css';

// the token rides in the url the command printed, so the page can ask for its own state
const token = new URLSearchParams(location.search).get('t') ?? '';

async function boot() {
  const target = document.getElementById('app')!;
  const response = await fetch(`/api/state?t=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    target.textContent = body.error ?? `[verbaly] the server answered ${response.status}`;
    return;
  }
  mount(Panel, { target, props: { panel: reactivePanel(await response.json()), token } });
}

void boot();
