// the first ten minutes: install as the docs teach, then run the commands we tell people to run
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['core', 'compiler', 'vite'];

// two questions, two sources: the registry answers bin linking, the tarballs answer this build
const SHAPES = [
  {
    name: 'docs minimal, published',
    source: 'registry',
    specs: ['verbaly', '@verbaly/vite'],
    cli: false,
  },
  { name: 'with the CLI, this build', source: 'tarballs', specs: PACKAGES, cli: true },
];

const CONFIG = JSON.stringify({ dir: 'locales', sourceLocale: 'es', locales: ['es'] });
const SOURCE = 'export const greet = (name) => t`Hola ${name}`;\n';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', shell: true });
}

function tryRun(cmd, args, cwd) {
  try {
    return { ok: true, out: run(cmd, args, cwd) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function available(pm) {
  return tryRun(pm, ['--version'], root).ok;
}

function pack(destination) {
  const tarballs = {};
  for (const name of PACKAGES) {
    const dir = join(root, 'packages', name);
    if (!existsSync(join(dir, 'dist'))) throw new Error(`run pnpm build first: ${name} has no dist`);
    const out = run('pnpm', ['pack', '--pack-destination', destination], dir);
    tarballs[name] = out.trim().split(/\r?\n/).pop();
  }
  return tarballs;
}

function fixture(tarballs, shape, pm) {
  const dir = mkdtempSync(join(tmpdir(), `verbaly-first-contact-${pm}-`));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'probe', private: true }));
  // pnpm 11 exits non-zero on a blocked postinstall, and esbuild has one
  let workspace = 'allowBuilds:\n  esbuild: true\n';
  // pnpm goes to the registry for a version not published yet, and npm rejects a direct override
  if (shape.source === 'tarballs') {
    const spec = (name) => `file:${tarballs[name].replaceAll('\\', '/')}`;
    workspace += `overrides:\n  'verbaly': '${spec('core')}'\n  '@verbaly/compiler': '${spec('compiler')}'\n`;
  }
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), workspace);
  writeFileSync(join(dir, 'verbaly.config.json'), CONFIG);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.js'), SOURCE);
  const specs = shape.source === 'tarballs' ? shape.specs.map((name) => tarballs[name]) : shape.specs;
  const install = pm === 'npm' ? ['install', '--no-audit', '--no-fund'] : ['add'];
  const result = tryRun(pm, [...install, ...specs], dir);
  if (!result.ok) {
    throw new Error(`${pm} install failed: ${result.out.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  return dir;
}

// npm exec swallows a flag it recognises, so the separator is what makes this the user's command
function exec(pm, dir, args) {
  return tryRun(pm, ['exec', '--', 'verbaly', ...args], dir);
}

// the two answers that must agree: what the shell really does, and what doctor tells the user
function measure(dir, pm) {
  const help = exec(pm, dir, ['--help']);
  const runs = help.ok && help.out.includes('verbaly extract');
  // doctor has to run even where the project cannot reach it, or the lie is the thing unmeasured
  const local = join(dir, 'node_modules', '@verbaly', 'compiler', 'dist', 'cli.js');
  const cli = existsSync(local) ? local : join(root, 'packages', 'compiler', 'dist', 'cli.js');
  const doctor = tryRun('node', [cli, 'doctor', '--root', dir], root);
  return { runs, says: /✓ cli:/.test(doctor.out), doctor: doctor.out };
}

function cycle(dir, pm) {
  for (const step of ['init', 'extract', 'check']) {
    const result = exec(pm, dir, [step]);
    if (!result.ok) return { ok: false, step, out: result.out };
  }
  return { ok: true };
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const managers = (requested.length > 0 ? requested : ['pnpm', 'npm']).filter((pm) => {
  if (available(pm)) return true;
  console.log(`- ${pm}: not installed, skipped`);
  return false;
});

const packed = mkdtempSync(join(tmpdir(), 'verbaly-tarballs-'));
const tarballs = pack(packed);
console.log(`[verbaly] first contact: ${managers.join(', ')}\n`);

let failed = false;
const keep = [];
const fail = (pm, shape, message, dir) => {
  console.log(`✗ ${pm} · ${shape.name}: ${message}`);
  failed = true;
  if (dir) keep.push(dir);
};

for (const pm of managers) {
  for (const shape of SHAPES) {
    let dir;
    try {
      dir = fixture(tarballs, shape, pm);
    } catch (error) {
      fail(pm, shape, error.message);
      continue;
    }
    const { runs, says, doctor } = measure(dir, pm);

    // doctor lying about the CLI is the whole bug class: a remedy nobody can run
    if (runs !== says) {
      const said = says ? 'it is available' : 'it is not linked';
      fail(pm, shape, `the command ${runs ? 'runs' : 'does not run'} but doctor says ${said}`, dir);
      console.log(doctor.split('\n').filter((line) => line.includes('cli:')).join('\n'));
    } else if (shape.cli && !runs) {
      fail(pm, shape, 'the install the docs teach gives no working verbaly command', dir);
    } else {
      const flow = shape.cli ? cycle(dir, pm) : { ok: true };
      if (!flow.ok) {
        fail(pm, shape, `verbaly ${flow.step} failed\n${flow.out}`, dir);
      } else {
        const note = shape.cli
          ? 'command runs, init/extract/check green'
          : 'compiler is transitive, command absent, and doctor says so';
        console.log(`✓ ${pm} · ${shape.name}: ${note}`);
      }
    }
    if (!keep.includes(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

rmSync(packed, { recursive: true, force: true });
for (const dir of keep) console.log(`  kept for inspection: ${dir}`);
if (failed) process.exit(1);
console.log('\n[verbaly] first contact ✓');
