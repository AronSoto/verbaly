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

// a bundler serves any UI library, so the adapter in its install line is the project's own
const HOSTS: (HostSetup & { dep: string; bundler?: true })[] = [
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
    bundler: true,
    dep: 'vite',
    pkg: '@verbaly/vite',
    install: ['verbaly', '@verbaly/vite'],
    wire: 'add verbaly() to the plugins in vite.config',
  },
  {
    name: 'webpack',
    bundler: true,
    dep: 'webpack',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly webpack plugin to your build config',
  },
  {
    name: 'rspack',
    bundler: true,
    dep: '@rspack/core',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly rspack plugin to your build config',
  },
  {
    name: 'rollup',
    bundler: true,
    dep: 'rollup',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly rollup plugin to your build config',
  },
  {
    name: 'esbuild',
    bundler: true,
    dep: 'esbuild',
    pkg: '@verbaly/unplugin',
    install: ['verbaly', '@verbaly/unplugin'],
    wire: 'add the verbaly esbuild plugin to your build config',
  },
];

// any of these wires the build; the detected host only decides which one we recommend
export const WIRING_PACKAGES = [...new Set(HOSTS.map((host) => host.pkg))];

// package.json as it parses, or nothing: a folder without one, or one that is not an object
function readManifest(root: string): Record<string, unknown> | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readDependencies(root: string): Record<string, string> {
  const manifest = readManifest(root);
  return {
    ...(manifest?.dependencies as Record<string, string> | undefined),
    ...(manifest?.devDependencies as Record<string, string> | undefined),
  };
}

// each adapter, and what in package.json says the project renders with its library
const ADAPTERS: [string, string[]][] = [
  ['@verbaly/react', ['react', 'preact', '@verbaly/react']],
  ['@verbaly/vue', ['vue', 'nuxt', '@verbaly/vue']],
  ['@verbaly/svelte', ['svelte', '@sveltejs/kit', '@verbaly/svelte']],
];

function adaptersIn(deps: Record<string, string>): string[] {
  return ADAPTERS.filter(([, libs]) => libs.some((lib) => deps[lib])).map(([adapter]) => adapter);
}

// where a component takes useT from: none when the project declares no UI library
export function componentAdapters(root: string): string[] {
  return adaptersIn(readDependencies(root));
}

export function detectHost(root: string): HostSetup | undefined {
  const deps = readDependencies(root);
  const host = HOSTS.find((entry) => deps[entry.dep]);
  if (!host?.bundler) return host;
  // the adapter goes after the runtime, where the adapter READMEs write it
  const install = [...host.install.slice(0, 1), ...adaptersIn(deps), ...host.install.slice(1)];
  return { ...host, install };
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
  // no package.json, or one that does not parse: the lockfiles still answer
  const declared = readManifest(root)?.packageManager;
  const name = typeof declared === 'string' ? declared.split('@')[0] : undefined;
  if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') return name;
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

// a package manager links a bin for a direct dependency only, and ours is usually transitive
export function cliReachable(root: string): boolean {
  const bin = join(root, 'node_modules', '.bin');
  return existsSync(join(bin, 'verbaly')) || existsSync(join(bin, 'verbaly.CMD'));
}

export const CLI_INSTALL_FIX =
  'add `@verbaly/compiler` to your dev dependencies, then `npx verbaly` resolves';

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
