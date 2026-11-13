import { lockNews } from '../catalog/lock';
import type { ResolvedConfig } from '../config/config';
import { formatFinding } from '../gate/findings';

// a write that brought the lock into being is said once, where it happened
export function sayLockNews(cfg: ResolvedConfig, before: string | undefined): void {
  const news = lockNews(cfg, before);
  if (news) console.log(`  ${formatFinding({ kind: 'lock', ...news }, cfg.root)}`);
}

export function byLocale(entries: { locale: string; key: string }[]): [string, string[]][] {
  const out = new Map<string, string[]>();
  for (const { locale, key } of entries) {
    const keys = out.get(locale);
    if (keys) keys.push(key);
    else out.set(locale, [key]);
  }
  return [...out];
}
