import type { ResolvedConfig } from '@verbaly/compiler';
import { basename, relative } from 'node:path';
import { GENERATED_DIR, syncAndWrite, type Compiler, type RequestOptions } from './codegen';
import type { CodeTexts } from './report';

// one watcher per project root: next.config can be evaluated more than once
const active = new Map<string, () => void>();

export function startWatcher(
  compiler: Compiler,
  cfg: ResolvedConfig,
  requestOptions: RequestOptions,
  startTexts?: CodeTexts,
): () => void {
  const existing = active.get(cfg.root);
  if (existing) return existing;

  const catalogDir = relative(cfg.root, cfg.dir).replaceAll('\\', '/');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let queued = false;
  let texts = startTexts;

  async function refresh(): Promise<void> {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const catalogs = compiler.loadCatalogs(cfg);
      const registry = await compiler.extractProject(cfg);
      texts = await syncAndWrite(compiler, cfg, catalogs, registry, requestOptions, texts);
    } catch (error) {
      // a catalog saved half-typed is broken JSON for a moment: one line, never a stack trace
      const reason = compiler.formatCliError(error).replace(/^\[verbaly\] /, '');
      console.warn(`[verbaly] live extraction paused: ${reason}`);
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
    timer = setTimeout(() => void refresh(), 150);
  }

  const keep = catalogDir.split('/')[0];
  const close = compiler.watchTree(cfg.root, { keep, persistent: false }, (filename) => {
    if (!filename) return;
    const file = filename.replaceAll('\\', '/');
    if (
      file.startsWith(`${GENERATED_DIR}/`) ||
      file.startsWith('.next/') ||
      file.includes('node_modules/') ||
      file.endsWith('.d.ts')
    ) {
      return;
    }
    // a dotfile there is the state sidecar this pipeline writes: it changes no message
    const isCatalog =
      file.startsWith(`${catalogDir}/`) && file.endsWith('.json') && !basename(file).startsWith('.');
    if (isCatalog || compiler.SOURCE_FILE_RE.test(file)) schedule();
  });

  const dispose = (): void => {
    clearTimeout(timer);
    close();
    active.delete(cfg.root);
  };
  active.set(cfg.root, dispose);
  return dispose;
}

// test hook
export function stopWatcher(root: string): void {
  active.get(root)?.();
}
