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
  reviewed: Catalog[];
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
    const divergent = reviewed.some(
      (catalog) => new Set(group.map((k) => catalog[k]?.trim() ?? '').filter(Boolean)).size > 1,
    );
    if (divergent) {
      for (const key of group) {
        push(out, key, { signal: 'divergent', text: `"${text}" was already translated two ways` });
      }
    }
    // The same ambiguity seen from the result instead of from the history.
    const targets = new Set(group.map((key) => target[key]?.trim() ?? '').filter(Boolean));
    if (!divergent && targets.size > 1) {
      for (const key of group) {
        push(out, key, { signal: 'collision', text: `"${text}" came back as two different translations` });
      }
    }
  }

  for (const key of keys) {
    const src = source[key]?.trim() ?? '';
    const trg = target[key]?.trim() ?? '';
    if (!src || !trg) continue;

    // Only the locales with an opinion on this key vote: alone it fires on every do-not-translate.
    const opinions = reviewed.map((c) => c[key]?.trim()).filter((v) => v !== undefined && v !== '');
    if (trg === src && opinions.length > 0 && opinions.every((v) => v !== src)) {
      push(out, key, { signal: 'echo', text: 'still identical to the source' });
    }

    // a translation that adds a number is idiomatic ("refresh" is "F5"); one that changes it is not
    const srcDigits = bag(src, DIGITS, bareDigits);
    if (srcDigits.length > 0 && !same(srcDigits, bag(trg, DIGITS, bareDigits))) {
      push(out, key, { signal: 'digits', text: 'the numbers do not match the source' });
    }
    if (!same(bag(src, URLS, trimPunct), bag(trg, URLS, trimPunct))) {
      push(out, key, { signal: 'url', text: 'a URL changed' });
    }
    if (!same(bag(src, CODE), bag(trg, CODE))) {
      push(out, key, { signal: 'code', text: 'the contents of a <code> span changed' });
    }
  }

  return out;
}
