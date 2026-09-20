import type { Catalog } from '@verbaly/compiler';

export type TriageSignal = 'divergent' | 'collision' | 'echo' | 'digits' | 'code' | 'url';

export interface TriageReason {
  signal: TriageSignal;
  text: string;
}

export type TriageResult = Record<string, TriageReason[]>;

// check() already caught the structure, so these only point at the few worth reading first.
export interface TriageInput {
  source: Catalog;
  target: Catalog;
  reviewed: ReviewedLocale[];
}

// the locale rides with the catalog because a reason that cannot name the language explains nothing
export interface ReviewedLocale {
  locale: string;
  catalog: Catalog;
}

const DIGITS = /\d[\d.,]*/g;
const URLS = /https?:\/\/[^\s<)"']+/g;
const CODE = /<code>([^<]+)<\/code>/g;

function bag(text: string, re: RegExp, normalize?: (v: string) => string): string[] {
  const found = text.match(re) ?? [];
  return (normalize ? found.map(normalize) : found).sort();
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// A number or a url at the end of a clause takes the punctuation with it, and that is not a signal.
const trimPunct = (v: string) => v.replace(/[.,;:!?)\]]+$/, '');
// A separator is idiomatic (3.09 is 3,09 in Spanish); canonizing keeps 1.5 apart from 15.
const bareDigits = (v: string) => trimPunct(v).replaceAll(/[.,]/g, '.');

function push(out: TriageResult, key: string, reason: TriageReason): void {
  (out[key] ??= []).push(reason);
}

// the column is three short lines, so a reason quotes the evidence and never the whole message
function clip(text: string, max = 42): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const quote = (text: string, max?: number) => `"${clip(text, max)}"`;

// what the source has and the translation does not, which is the half worth naming
function lost(from: string[], to: string[]): string[] {
  const rest = [...to];
  const out: string[] = [];
  for (const item of from) {
    const at = rest.indexOf(item);
    if (at < 0) out.push(item);
    else rest.splice(at, 1);
  }
  return out;
}

// "the numbers moved" is a label; naming the one that moved is what saves the reader a diff
function movedText(kind: string, from: string[], to: string[]): string {
  const gone = lost(from, to);
  const added = lost(to, from);
  if (gone.length && added.length) {
    return `the source ${kind} ${quote(gone[0]!)}, this one ${kind} ${quote(added[0]!)}`;
  }
  if (gone.length) return `the source ${kind} ${quote(gone[0]!)} and this one does not`;
  return `this one ${kind} ${quote(added[0]!)} and the source does not`;
}

export function triage({ source, target, reviewed }: TriageInput): TriageResult {
  // null-prototype: a source text of "__proto__" or "toString" is a string, not a member of Object
  const out: TriageResult = Object.create(null);
  const keys = Object.keys(source);

  // One source text that two humans rendered two ways is ambiguous, so the machine had no chance.
  const bySource: Record<string, string[]> = Object.create(null);
  for (const key of keys) {
    const text = source[key]?.trim();
    if (text) (bySource[text] ??= []).push(key);
  }
  for (const [text, group] of Object.entries(bySource)) {
    if (group.length < 2) continue;

    // the first reviewed locale that disagreed with itself, and the two renderings it used
    let split: { locale: string; first: string; second: string } | undefined;
    for (const { locale, catalog } of reviewed) {
      const seen = [...new Set(group.map((k) => catalog[k]?.trim() ?? '').filter(Boolean))];
      if (seen.length > 1) {
        split = { locale, first: seen[0]!, second: seen[1]! };
        break;
      }
    }
    if (split) {
      for (const key of group) {
        push(out, key, {
          signal: 'divergent',
          text: `${split.locale} already says this two ways: ${quote(split.first, 32)} and ${quote(split.second, 32)}`,
        });
      }
    }

    // The same ambiguity seen from the result instead of from the history.
    const targets = new Set(group.map((key) => target[key]?.trim() ?? '').filter(Boolean));
    if (!split && targets.size > 1) {
      for (const key of group) {
        const mine = target[key]?.trim() ?? '';
        const other = group.find((k) => k !== key && (target[k]?.trim() ?? '') !== mine && target[k]?.trim());
        push(out, key, {
          signal: 'collision',
          text: other
            ? `${other} has the same source text and says ${quote(target[other]!.trim())}`
            : `${quote(text)} came back as two different translations`,
        });
      }
    }
  }

  for (const key of keys) {
    const src = source[key]?.trim() ?? '';
    const trg = target[key]?.trim() ?? '';
    if (!src || !trg) continue;

    // Only the locales with an opinion on this key vote: alone it fires on every do-not-translate.
    const voters = reviewed.filter(({ catalog }) => {
      const value = catalog[key]?.trim();
      return value !== undefined && value !== '';
    });
    if (trg === src && voters.length > 0 && voters.every(({ catalog }) => catalog[key]?.trim() !== src)) {
      const names = voters.map(({ locale }) => locale).join(' and ');
      push(out, key, { signal: 'echo', text: `still the source text, and ${names} did translate it` });
    }

    // a translation that adds a number is idiomatic ("refresh" is "F5"); one that changes it is not
    const srcDigits = bag(src, DIGITS, bareDigits);
    const trgDigits = bag(trg, DIGITS, bareDigits);
    if (srcDigits.length > 0 && !same(srcDigits, trgDigits)) {
      push(out, key, { signal: 'digits', text: movedText('says', srcDigits, trgDigits) });
    }
    const srcUrls = bag(src, URLS, trimPunct);
    const trgUrls = bag(trg, URLS, trimPunct);
    if (!same(srcUrls, trgUrls)) {
      push(out, key, { signal: 'url', text: movedText('links to', srcUrls, trgUrls) });
    }
    const srcCode = bag(src, CODE);
    const trgCode = bag(trg, CODE);
    if (!same(srcCode, trgCode)) {
      push(out, key, { signal: 'code', text: movedText('shows the code', srcCode, trgCode) });
    }
  }

  return out;
}
