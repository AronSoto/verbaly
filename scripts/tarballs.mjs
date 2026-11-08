// what the release checks share: running a command as a user would, and packing this build
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// one string: a shell joins args without quoting them, and a user folder can hold a space
export function run(cmd, args, cwd, options = {}) {
  const line = [cmd, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
  return execFileSync(line, { cwd, encoding: 'utf8', stdio: 'pipe', shell: true, ...options });
}

export function tryRun(cmd, args, cwd, options = {}) {
  try {
    return { ok: true, out: run(cmd, args, cwd, options) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function newest(dir) {
  let time = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) time = Math.max(time, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return time;
}

// a dist older than its src packs the last build, and the check passes on code nobody changed
export function pack(destination, names) {
  const tarballs = {};
  for (const name of names) {
    const dir = join(root, 'packages', name);
    if (!existsSync(join(dir, 'dist')))
      throw new Error(`run pnpm build first: ${name} has no dist`);
    if (newest(join(dir, 'src')) > newest(join(dir, 'dist'))) {
      throw new Error(`run pnpm build first: ${name} has changes newer than its dist`);
    }
    const out = run('pnpm', ['pack', '--pack-destination', destination], dir);
    tarballs[name] = out.trim().split(/\r?\n/).pop();
  }
  return tarballs;
}
