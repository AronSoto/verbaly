import type { ResolvedConfig } from '@verbaly/compiler';
import { watch } from 'node:fs';
import { relative } from 'node:path';
import { GENERATED_DIR, writeGeneratedModules, type Compiler, type RequestOptions } from './codegen';

// one watcher per project root — next.config can be evaluated more than once
const active = new Map<string, () => void>();

export function startWatcher(
  compiler: Compiler,
  cfg: ResolvedConfig,
  requestOptions: RequestOptions,
): () => void {
  const existing = active.get(cfg.root);
  if (existing) return existing;

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
      const catalogs = compiler.loadCatalogs(cfg);
      const registry = await compiler.extractProject(cfg);
      const { added } = compiler.syncCatalogs(cfg, catalogs, registry);
      for (const locale of Object.keys(added)) {
        compiler.writeCatalog(cfg, locale, catalogs[locale] ?? {});
      }
      compiler.writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
      writeGeneratedModules(compiler, cfg, catalogs, requestOptions);
    } catch (error) {
      console.warn('[verbaly] live extraction failed:', error);
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

  const watcher = watch(cfg.root, { recursive: true }, (_event, filename) => {
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
    const isCatalog = file.startsWith(`${catalogDir}/`) && file.endsWith('.json');
    if (isCatalog || compiler.SOURCE_FILE_RE.test(file)) schedule();
  });
  watcher.unref?.();

  const dispose = (): void => {
    clearTimeout(timer);
    watcher.close();
    active.delete(cfg.root);
  };
  active.set(cfg.root, dispose);
  return dispose;
}

// test hook
export function stopWatcher(root: string): void {
  active.get(root)?.();
}
