import { relative } from 'node:path';

// one spelling on every OS: what a catalog, a report and a glob compare
export function slashed(path: string): string {
  return path.replaceAll('\\', '/');
}

// a file as the project names it: from the root, with forward slashes
export function relativePath(root: string, file: string): string {
  return slashed(relative(root, file));
}
