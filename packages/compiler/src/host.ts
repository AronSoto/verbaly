import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Host =
  'nuxt' | 'next' | 'sveltekit' | 'astro' | 'vite' | 'webpack' | 'rspack' | 'rollup' | 'esbuild';

export interface HostSetup {
  name: Host;
  // the package that wires the build, which is how doctor tells the setup is done
  pkg: string;
  // what that package's README installs, so init and doctor never contradict it
  install: string[];
  wire: string;
}

const HOSTS: (HostSetup & { dep: string })[] = [
  {
    name: 'nuxt',
    dep: 'nuxt',
    pkg: '@verbaly/nuxt',
    install: ['verbaly', '@verbaly/nuxt', '@verbaly/vue'],
    wire: "add '@verbaly/nuxt' to the modules in nuxt.config",
  },
  {
    name: 'next',
    dep: 'next',
    pkg: '@verbaly/next',
    install: ['verbaly', '@verbaly/next', '@verbaly/react'],
    wire: 'wrap the export of next.config with withVerbaly',
  },
  {
    name: 'sveltekit',
    dep: '@sveltejs/kit',
    pkg: '@verbaly/vite',
    install: ['verbaly', '@verbaly/sveltekit', '@verbaly/svelte', '@verbaly/vite'],
    wire: 'add verbaly() to the plugins in vite.config (per-request locale: @verbaly/sveltekit)',
  },
  {
    name: 'astro',
    dep: 'astro',
    pkg: '@verbaly/astro',
    install: ['verbaly', '@verbaly/astro'],
    wire: 'add verbaly() to the integrations in astro.config',
  },
  {
    name: 'vite',
    dep: 'vite',
    pkg: '@verbaly/vite',
    install: ['verbaly', '@verbaly/vite'],
    wire: 'add verbaly() to the plugins in vite.config',
  },
  {
    name: 'webpack',
    dep: 'webpack',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly webpack plugin to your build config',
  },
  {
    name: 'rspack',
    dep: '@rspack/core',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly rspack plugin to your build config',
  },
  {
    name: 'rollup',
    dep: 'rollup',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly rollup plugin to your build config',
  },
  {
    name: 'esbuild',
    dep: 'esbuild',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly esbuild plugin to your build config',
  },
];

// any of these wires the build; the detected host only decides which one we recommend
export const WIRING_PACKAGES = [...new Set(HOSTS.map((host) => host.pkg))];

export function readDependencies(root: string): Record<string, string> {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return {};
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

export function detectHost(root: string): HostSetup | undefined {
  const deps = readDependencies(root);
  return HOSTS.find((host) => deps[host.dep]);
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

// the project's own manager: packageManager first, then the nearest lockfile (a workspace root)
export function packageManager(root: string): PackageManager {
  try {
    const declared = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        packageManager?: unknown;
      }
    ).packageManager;
    const name = typeof declared === 'string' ? declared.split('@')[0] : undefined;
    if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') return name;
  } catch {
    // no package.json, or one that does not parse: the lockfiles still answer
  }
  for (let dir = root; ; dir = dirname(dir)) {
    const found = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (found) return found[1];
    if (dirname(dir) === dir) return 'npm';
  }
}

export function installCommand(root: string, packages: string[], dev = false): string {
  const manager = packageManager(root);
  const verb = manager === 'npm' ? 'install' : 'add';
  const flag = dev ? (manager === 'bun' ? ' -d' : ' -D') : '';
  return `${manager} ${verb}${flag} ${packages.join(' ')}`;
}

// where each framework keeps generated types; .verbaly/ is ours, and tsconfig needs its line
const TYPE_SLOTS: Partial<Record<Host, string[]>> = {
  next: ['.verbaly', 'types.d.ts'],
  astro: ['.astro', 'integrations', '_verbaly_astro', 'verbaly.d.ts'],
  nuxt: ['.nuxt', 'verbaly.d.ts'],
};

// the framework's slot, else src/ (the folder every app template's tsconfig includes), else root
export function defaultTypesPath(root: string, host = detectHost(root)?.name): string {
  const slot = host && TYPE_SLOTS[host];
  if (slot) return join(root, ...slot);
  return existsSync(join(root, 'src'))
    ? join(root, 'src', 'verbaly.d.ts')
    : join(root, 'verbaly.d.ts');
}
