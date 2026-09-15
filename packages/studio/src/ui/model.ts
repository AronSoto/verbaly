// The shapes the panel reads: StudioState restated, so the UI never imports Node code.
export type MessageState = 'done' | 'draft' | 'missing' | 'broken';

export interface Cell {
  locale: string;
  text: string;
  state: MessageState;
  issue?: string;
  signals: string[];
}

export interface Row {
  key: string;
  source: string;
  cells: Cell[];
  origins: string[];
}

export interface LocaleHealth {
  locale: string;
  source: boolean;
  total: number;
  done: number;
  draft: number;
  missing: number;
  broken: number;
}

export interface Undefined {
  key: string;
  files: string[];
}

export interface Panel {
  root: string;
  scanning: boolean;
  sourceLocale: string;
  locales: string[];
  rows: Row[];
  // a key the code calls that no catalog defines: it fails the gate and has no row to live in
  undefined: Undefined[];
  problems: { scope: string; message: string }[];
}

type Catalogs = Record<string, Record<string, unknown>>;

export interface RawState {
  root: string;
  dir: string;
  sourceLocale: string;
  locales: string[];
  // include: [] means scanning is off, which is not the same as having found nothing
  scanning: boolean;
  catalogs: Catalogs;
  origins: Record<string, string[]>;
  drafts: Record<string, string[]>;
  triage: Record<string, Record<string, { signal: string; text: string }[]>>;
  check: {
    broken: { locale: string; key: string; severity: string; issue: string }[];
    unknown?: { key: string; files: string[] }[];
  };
  problems: { scope: string; message: string }[];
}

// a catalog arrives in the shape its file has, so the panel flattens it to read
function flatten(tree: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, path, out);
    }
  }
  return out;
}

export function toPanel(raw: RawState): Panel {
  const flat: Record<string, Record<string, string>> = {};
  for (const locale of raw.locales) flat[locale] = flatten(raw.catalogs[locale] ?? {});

  // the separator is the escape, never the byte: a raw NUL makes git call this file binary
  const broken = new Map<string, string>();
  for (const entry of raw.check.broken) {
    if (entry.severity === 'error') broken.set(`${entry.locale}\u0000${entry.key}`, entry.issue);
  }
  const drafts = new Map<string, Set<string>>();
  for (const [locale, keys] of Object.entries(raw.drafts)) drafts.set(locale, new Set(keys));

  const source = flat[raw.sourceLocale] ?? {};
  const targets = raw.locales.filter((locale) => locale !== raw.sourceLocale);

  const rows: Row[] = Object.keys(source).map((key) => ({
    key,
    source: source[key] ?? '',
    origins: raw.origins[key] ?? [],
    cells: targets.map((locale) => {
      const text = flat[locale]?.[key] ?? '';
      const issue = broken.get(`${locale}\u0000${key}`);
      const state: MessageState = issue
        ? 'broken'
        : !text
          ? 'missing'
          : drafts.get(locale)?.has(key)
            ? 'draft'
            : 'done';
      const signals = (raw.triage?.[locale]?.[key] ?? []).map((reason) => reason.signal);
      return { locale, text, state, issue, signals };
    }),
  }));

  return {
    root: raw.root,
    scanning: raw.scanning,
    sourceLocale: raw.sourceLocale,
    locales: raw.locales,
    rows,
    undefined: raw.check.unknown ?? [],
    problems: raw.problems,
  };
}

// a projection of the rows, never stored: a saved cell has to move the rail in the same breath
export function health(panel: Panel): LocaleHealth[] {
  return panel.locales.map((locale) => {
    const total = panel.rows.length;
    if (locale === panel.sourceLocale) {
      return { locale, source: true, total, done: total, draft: 0, missing: 0, broken: 0 };
    }
    const count = { done: 0, draft: 0, missing: 0, broken: 0 };
    for (const row of panel.rows) {
      const cell = row.cells.find((c) => c.locale === locale);
      if (cell) count[cell.state]++;
    }
    return { locale, source: false, total, ...count };
  });
}

// A command rewrote the catalogs, so every row comes back rather than being patched key by key.
export function applyState(panel: Panel, raw: RawState): void {
  Object.assign(panel, toPanel(raw));
}

export type Empty = 'noCatalogs' | 'oneLocale' | 'pickOne' | 'noMatch';

// An empty screen that names what to click instead of what is true is the worst first run.
export function emptyReason(panel: Panel, shown: string[], rows: Row[]): Empty | null {
  if (!panel.rows.length) return 'noCatalogs';
  if (panel.locales.length < 2) return 'oneLocale';
  if (!shown.length) return 'pickOne';
  if (!rows.length) return 'noMatch';
  return null;
}

export interface Filter {
  text: string;
  state: MessageState | 'all' | 'look';
  locales: string[];
  group?: string | null;
}

export interface Group {
  name: string;
  total: number;
  broken: number;
  missing: number;
  draft: number;
}

// The first segment, the unit `bundle.exclude` matches: an underscore guess measures worse.
export function groupOf(key: string): string | null {
  const at = key.indexOf('.');
  return at > 0 ? key.slice(0, at) : null;
}

// Counted over the ticked languages, so a group's numbers agree with the table under it.
export function groups(rows: Row[], locales: string[]): Group[] {
  const shown = new Set(locales);
  const out = new Map<string, Group>();
  for (const row of rows) {
    const name = groupOf(row.key);
    if (name === null) continue;
    const group = out.get(name) ?? { name, total: 0, broken: 0, missing: 0, draft: 0 };
    group.total += 1;
    for (const cell of row.cells) {
      if (!shown.has(cell.locale)) continue;
      if (cell.state !== 'done') group[cell.state] += 1;
    }
    out.set(name, group);
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

// One pass over every row: measured at 0.9 ms on 1573 messages, so nothing here is memoized.
export function visible(rows: Row[], filter: Filter): Row[] {
  const needle = filter.text.trim().toLowerCase();
  const shown = new Set(filter.locales);
  return rows.filter((row) => {
    const cells = row.cells.filter((cell) => shown.has(cell.locale));
    if (filter.state === 'look' && !cells.some((cell) => cell.signals.length)) return false;
    if (filter.state !== 'all' && filter.state !== 'look') {
      if (!cells.some((cell) => cell.state === filter.state)) return false;
    }
    if (filter.group && groupOf(row.key) !== filter.group) return false;
    if (!needle) return true;
    if (row.source.toLowerCase().includes(needle)) return true;
    return cells.some((cell) => cell.text.toLowerCase().includes(needle));
  });
}

export interface Hit {
  key: string;
  group: string | null;
  source: string;
  // every language whose text matched, the source among them: this is what the table cannot say
  locales: string[];
  text: string;
  state: MessageState;
}

const WORST: MessageState[] = ['broken', 'missing', 'draft', 'done'];

// the tile answers "is this message fine", so it reads the whole row and not the matched cell
function worst(row: Row): MessageState {
  for (const state of WORST) {
    if (row.cells.some((cell) => cell.state === state)) return state;
  }
  return 'done';
}

// Search reads every language, never only the ticked ones, and never the key: nobody recalls one.
export function search(panel: Panel, query: string, limit = 40): Hit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: Hit[] = [];
  for (const row of panel.rows) {
    const locales: string[] = [];
    if (row.source.toLowerCase().includes(needle)) locales.push(panel.sourceLocale);
    for (const cell of row.cells) {
      if (cell.text.toLowerCase().includes(needle)) locales.push(cell.locale);
    }
    if (!locales.length) continue;
    const first = locales[0]!;
    const text =
      first === panel.sourceLocale
        ? row.source
        : (row.cells.find((cell) => cell.locale === first)?.text ?? '');
    hits.push({
      key: row.key,
      group: groupOf(row.key),
      source: row.source,
      locales,
      text,
      state: worst(row),
    });
    if (hits.length === limit) break;
  }
  return hits;
}

// the sheet marks what you typed, and the split is on the text so no markup is ever built by hand
export function marked(text: string, query: string): [string, string, string] {
  const needle = query.trim();
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [text, '', ''];
  return [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)];
}
