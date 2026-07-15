import { watch } from 'node:fs';
import { relative } from 'node:path';
import type { ResolvedConfig } from './config';
import { SOURCE_FILE_RE } from './plugin';

export interface WatchProjectOptions {
  debounce?: number;
}

// source files only: extract's own catalog/dts writes must never retrigger a run
export function watchProject(
  cfg: ResolvedConfig,
  run: () => Promise<void>,
  options: WatchProjectOptions = {},
): () => void {
  const catalogDir = relative(cfg.root, cfg.dir).replaceAll('\\', '/');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let queued = false;

  async function refresh(): Promise<void> {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await run();
    } catch (error) {
      console.warn('[verbaly] watch run failed:', error);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), options.debounce ?? 150);
  }

  const watcher = watch(cfg.root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const file = filename.replaceAll('\\', '/');
    if (file.includes('node_modules/') || file.endsWith('.d.ts')) return;
    if (catalogDir && file.startsWith(`${catalogDir}/`)) return;
    if (SOURCE_FILE_RE.test(file)) schedule();
  });

  return (): void => {
    clearTimeout(timer);
    watcher.close();
  };
}
