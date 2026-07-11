import { loadCatalogs, type Catalogs } from './catalog';
import { check, formatCheckResult } from './check';
import { VIRTUAL_ID, generateLocaleModule, generateRuntimeModule } from './codegen';
import type { ResolvedConfig } from './config';
import type { MessageRegistry } from './registry';

// shared bundler-plugin primitives — @verbaly/vite and @verbaly/unplugin
// adapt these to their hook signatures instead of copying them

export const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
export const LOCALE_MODULE_PREFIX = `${RESOLVED_VIRTUAL_ID}/locale/`;
export const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

export function resolveVirtualId(id: string): string | undefined {
  if (id === VIRTUAL_ID || id.startsWith(`${VIRTUAL_ID}/`)) return '\0' + id;
  return undefined;
}

export function loadVirtualModule(
  id: string,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
): string | undefined {
  if (id === RESOLVED_VIRTUAL_ID) return generateRuntimeModule(cfg);
  if (id.startsWith(LOCALE_MODULE_PREFIX)) {
    return generateLocaleModule(catalogs[id.slice(LOCALE_MODULE_PREFIX.length)] ?? {});
  }
  return undefined;
}

export function isTransformTarget(id: string): boolean {
  return SOURCE_FILE_RE.test(id) && !id.includes('node_modules') && !id.startsWith('\0');
}

// the one build-blocking error message, kept in one place
export function runBuildGate(cfg: ResolvedConfig, registry: MessageRegistry): void {
  const result = check(cfg, loadCatalogs(cfg), registry);
  if (!result.ok) {
    throw new Error(
      `[verbaly] build blocked\n${formatCheckResult(result)}\n` +
        `Run \`npx verbaly extract\` and fill the missing translations.`,
    );
  }
}
