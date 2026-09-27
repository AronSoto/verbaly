import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';
import type { ResolvedConfig } from './config';
import { SOURCE_FILE_RE } from './plugin';

// only these watch a tree natively: elsewhere Node walks it in sync and watches every entry
const NATIVE_TREE = process.platform === 'darwin' || process.platform === 'win32';

export interface TreeOptions {
  keep?: string;
  native?: boolean;
  persistent?: boolean;
}

// every change under root, named from root; node_modules alone can use up the inotify limit
export function watchTree(
  root: string,
  options: TreeOptions,
  onFile: (file: string) => void,
): () => void {
  // by top-level name, '' being the root itself
  const watchers = new Map<string, FSWatcher>();
  const close = (name: string): void => {
    watchers.get(name)?.close();
    watchers.delete(name);
  };
  const open = (
    name: string,
    recursive: boolean,
    listener: (_event: string, file: string | null) => void,
  ): void => {
    const watcher = watch(
      join(root, name),
      { recursive, persistent: options.persistent ?? true },
      listener,
    );
    // an error nobody listens to ends the process, and a quiet stop would end the watching
    watcher.on('error', (error) => {
      close(name);
      console.warn(`[verbaly] stopped watching ${name || 'the project'}:`, error);
    });
    watchers.set(name, watcher);
  };

  if (options.native ?? NATIVE_TREE) {
    open('', true, (_event, file) => {
      if (file) onFile(file);
    });
  } else {
    // the top level by hand, so a directory that holds no code is never walked at all
    const sync = (name: string): void => {
      // the root hears of a directory only when it is made, removed or moved: reopen, never reuse
      close(name);
      if (name !== options.keep && (name === 'node_modules' || name.startsWith('.'))) return;
      try {
        if (!statSync(join(root, name)).isDirectory()) return;
      } catch {
        return;
      }
      open(name, true, (_event, file) => {
        if (file) onFile(`${name}/${file}`);
      });
    };
    open('', false, (_event, file) => {
      if (!file) return;
      sync(file);
      onFile(file);
    });
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) sync(entry.name);
    }
  }
  return () => {
    for (const name of [...watchers.keys()]) close(name);
  };
}

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

  const close = watchTree(cfg.root, {}, (filename) => {
    if (!filename) return;
    const file = filename.replaceAll('\\', '/');
    if (file.includes('node_modules/') || file.endsWith('.d.ts')) return;
    if (catalogDir && file.startsWith(`${catalogDir}/`)) return;
    if (SOURCE_FILE_RE.test(file)) schedule();
  });

  return (): void => {
    clearTimeout(timer);
    close();
  };
}
