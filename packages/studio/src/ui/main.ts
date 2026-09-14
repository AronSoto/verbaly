import { mount } from 'svelte';
import Panel from './Panel.svelte';
import { serverApi } from './api';
import { reactivePanel } from './store.svelte';
import './tokens.css';
import './boot.css';

// the token rides in the url the command printed, so the page can ask for its own state
const token = new URLSearchParams(location.search).get('t') ?? '';

async function boot() {
  const target = document.getElementById('app')!;
  const api = serverApi(token);
  const first = await api.state();
  if (first.error || !first.value) {
    target.textContent = first.error ?? '[verbaly] the server sent no state';
    return;
  }
  mount(Panel, { target, props: { panel: reactivePanel(first.value), api } });
}

void boot();
