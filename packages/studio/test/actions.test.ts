import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDrafts, resolveConfig, type TranslateRequest } from '@verbaly/compiler';
import { planTranslate, runExtract, startTranslate } from '../src/actions';
import { writeMessage } from '../src/api';
import { read, running } from '../src/jobs';

const made: string[] = [];

// a provider is just a function, so the whole cycle runs without a key and without spending
const echo = async ({ messages }: TranslateRequest) =>
  Object.fromEntries(Object.entries(messages).map(([key, text]) => [key, `[x] ${text}`]));

function project(options: { scan?: boolean; provider?: typeof echo } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-actions-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ hi: 'Hi', bye: 'Bye' }, null, 2));
  writeFileSync(join(dir, 'es.json'), JSON.stringify({ hi: 'Hola', bye: '' }, null, 2));
  if (options.scan) {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'export const a = t`Brand new`;\n');
  }
  return resolveConfig({
    root,
    dir: 'locales',
    sourceLocale: 'en',
    locales: ['en', 'es'],
    include: options.scan ? undefined : [],
    translate: options.provider ? { provider: options.provider } : undefined,
  });
}

// several locales and more keys than one batch holds, which is when the counter can go wrong
function wide(options: { batchSize?: number; provider: typeof echo }) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-wide-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  const source: Record<string, string> = {};
  for (let i = 0; i < 6; i += 1) source[`k${i}`] = `Message ${i}`;
  writeFileSync(join(dir, 'en.json'), JSON.stringify(source, null, 2));
  for (const locale of ['es', 'pt']) writeFileSync(join(dir, `${locale}.json`), '{}');
  return resolveConfig({
    root,
    dir: 'locales',
    sourceLocale: 'en',
    locales: ['en', 'es', 'pt'],
    include: [],
    translate: { provider: options.provider, batchSize: options.batchSize },
  });
}

async function settle(id: string, seen: number[]): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const job = read(id);
    seen.push(job.done);
    if (job.state !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the job never finished');
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('extract, which is local and free and answers in the request', () => {
  // Proved able to fail by dropping the guard: it answers "0 added" and you believe it.
  it('refuses when scanning is off instead of reporting nothing found', async () => {
    await expect(runExtract(project())).rejects.toThrow(/scanning is off/);
  });

  it('adds what the code uses and writes the types', async () => {
    const cfg = project({ scan: true });
    const result = await runExtract(cfg);

    expect(result.found).toBe(1);
    expect(JSON.stringify(JSON.parse(readFileSync(join(cfg.dir, 'en.json'), 'utf8')))).toContain(
      'Brand new',
    );
    // where the config resolves the types, the same file the CLI and the dev servers write
    expect(existsSync(cfg.dts as string)).toBe(true);
  });

  // Proved able to fail by syncing without updateState: the draft of a gone translation stayed.
  it('keeps the review state in step with the catalogs, like the CLI does', async () => {
    const cfg = project({ scan: true });
    writeFileSync(
      join(cfg.dir, '.verbaly-state.json'),
      JSON.stringify({ drafts: { es: ['bye', 'hi'] } }),
    );
    const result = await runExtract(cfg);
    // bye has no translation, so it is missing, not a draft; hi keeps its flag
    expect(JSON.parse(readFileSync(join(cfg.dir, '.verbaly-state.json'), 'utf8')).drafts).toEqual({
      es: ['hi'],
    });
    expect(result.stateProblem).toBeUndefined();
  });

  it('says when a hand edit of a text the code owns was put back', async () => {
    const cfg = project({ scan: true });
    writeFileSync(join(cfg.root, 'src', 'app.ts'), "export const a = t.id('hi')`Hi there`;\n");
    const result = await runExtract(cfg);
    expect(result.replaced).toBe(1);
    expect(JSON.parse(readFileSync(join(cfg.dir, 'en.json'), 'utf8')).hi).toBe('Hi there');
  });
});

describe('translate, the one action that spends money', () => {
  // Proved able to fail by letting the plan call the provider for real: the bill arrives unasked.
  it('says what it would do without writing anything', async () => {
    let called = 0;
    const cfg = project({
      provider: async (request) => {
        called += 1;
        return echo(request);
      },
    });
    const before = readFileSync(join(cfg.dir, 'es.json'), 'utf8');

    const plan = await planTranslate(cfg);
    expect(plan.total).toBe(1);
    expect(plan.pending.es).toEqual(['bye']);
    expect(called).toBe(0);
    expect(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).toBe(before);
  });

  it('runs, writes, and leaves what a machine wrote as a draft', async () => {
    const cfg = project({ provider: echo });
    const job = await startTranslate(cfg);
    expect(job.state).toBe('running');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(read(job.id).state).toBe('done');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).bye).toBe('[x] Bye');
    // the panel does not get to change the rule that a machine translation waits for a human
    expect(loadDrafts(cfg)).toEqual({ es: ['bye'] });
  });

  // Proved able to fail by dropping the guard: two runs write the same files at the same time.
  it('refuses a second run while one is going', async () => {
    const slow = async (request: TranslateRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return echo(request);
    };
    const cfg = project({ provider: slow });
    await startTranslate(cfg);
    await expect(startTranslate(cfg)).rejects.toThrow(/already running/);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(running()).toBeNull();
  });

  // Proved able to fail by writing the run's own copy back: the person's fix becomes a draft.
  it('keeps a fix a person saved while the run was out, and never calls it a draft', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const cfg = project({
      provider: async (request) => {
        await gate;
        return echo(request);
      },
    });
    const job = await startTranslate(cfg);
    await writeMessage(cfg, 'es', 'bye', 'Adiós');
    release();
    await vi.waitFor(() => expect(read(job.id).state).toBe('done'));
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).bye).toBe('Adiós');
    expect(loadDrafts(cfg)).toEqual({});
    expect(read(job.id)).toMatchObject({ written: 0, kept: 1 });
  });

  // Proved able to fail with the old line: the panel said "1 batches did not answer" and no more.
  it('says what landed as well as what did not when a batch fails', async () => {
    const cfg = wide({
      provider: async (request) => {
        if (request.targetLocale === 'pt') {
          throw Object.assign(new Error('the api refused it'), { status: 400 });
        }
        return echo(request);
      },
    });
    const job = await startTranslate(cfg);
    await vi.waitFor(() => expect(read(job.id).state).toBe('failed'));
    expect(read(job.id).message).toBe(
      '6 messages translated, but 1 batch did not answer (the api refused it): run it again for the rest',
    );
  });

  it('answers 404 for a job id it never handed out', () => {
    expect(() => read('translate-does-not-exist')).toThrow(/no job called/);
  });
});

// Proved able to fail by counting every locale: a gap a target already had reads as new text.
it('counts one new message, not one per language that was missing it', async () => {
  const root = mkdtempSync(join(tmpdir(), "verbaly-found-"));
  made.push(root);
  mkdirSync(join(root, 'locales'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ hi: 'Hi', bye: 'Bye' }));
  writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ hi: 'Hola' }));
  writeFileSync(join(root, 'locales', 'pt.json'), JSON.stringify({ hi: 'Oi' }));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const a = t`Brand new`;');
  const cfg = resolveConfig({
    root,
    dir: 'locales',
    sourceLocale: 'en',
    locales: ['en', 'es', 'pt'],
  });

  const result = await runExtract(cfg);

  expect(result.found).toBe(1);
  expect(result.added.es).toHaveLength(2);
});

describe('the progress a running job reports', () => {
  // Proved able to fail by assigning instead of adding in advance(): it stops short of the total.
  it('counts keys up to the total the plan promised, and never walks backwards', async () => {
    const slow = async (request: TranslateRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return echo(request);
    };
    const cfg = wide({ batchSize: 2, provider: slow });

    const job = await startTranslate(cfg);
    // twelve missing messages across two locales, in batches of two, so six batches interleave
    expect(job.total).toBe(12);

    const seen: number[] = [];
    await settle(job.id, seen);

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(read(job.id).done).toBe(12);
    expect(read(job.id).state).toBe('done');
  });

  // Proved able to fail by dropping batchSize from the run: one batch per locale, not three.
  it('batches the way the project says, so the panel and the command cost the same', async () => {
    const sizes: number[] = [];
    const counting = async (request: TranslateRequest) => {
      sizes.push(Object.keys(request.messages).length);
      return echo(request);
    };
    const cfg = wide({ batchSize: 2, provider: counting });

    const job = await startTranslate(cfg);
    await settle(job.id, []);

    expect(sizes).toHaveLength(6);
    expect(new Set(sizes)).toEqual(new Set([2]));
  });

  // Proved able to fail by passing 0 to start(): the bar has no denominator and shows nothing.
  it('takes its denominator from the plan even when nobody asked for the plan', async () => {
    const cfg = wide({ provider: echo });
    const plan = await planTranslate(cfg);
    const job = await startTranslate(cfg);

    expect(job.total).toBe(plan.total);
    await settle(job.id, []);
  });
});
