import type { Component } from 'svelte';
import type { Panel } from './model';
import type { StudioApi } from './api';

// Written by hand, like @verbaly/svelte's Trans.svelte.d.ts: the build copies the component as
// source and there is no svelte2tsx step in this repo.
declare const PanelView: Component<{
  panel: Panel;
  api: StudioApi;
}>;

export default PanelView;
