import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// the built panel sits beside the compiled server, so it is found relative to this file, never cwd
const UI = resolve(fileURLToPath(new URL('.', import.meta.url)), 'ui');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export interface Asset {
  body: Buffer;
  type: string;
}

export const uiBuilt = (): boolean => existsSync(join(UI, 'index.html'));

// A path is resolved and then checked to still be inside UI: ../ and an absolute one both land out.
export function readAsset(pathname: string): Asset | undefined {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  const target = resolve(join(UI, normalize(wanted)));
  if (target !== UI && !target.startsWith(UI + (process.platform === 'win32' ? '\\' : '/'))) {
    return undefined;
  }
  if (!existsSync(target) || !statSync(target).isFile()) return undefined;
  const dot = target.lastIndexOf('.');
  return {
    body: readFileSync(target),
    type: TYPES[target.slice(dot).toLowerCase()] ?? 'application/octet-stream',
  };
}
