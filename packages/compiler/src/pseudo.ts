import type { Catalog, Catalogs } from './catalog';
import type { ResolvedConfig } from './config';

export const PSEUDO_LOCALE = 'en-XA';

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'đ',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Đ',
  E: 'É',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ĺ',
  M: 'Ḿ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẍ',
  Y: 'Ý',
  Z: 'Ž',
};

const TAG_AT = /<\/?[a-zA-Z][\w-]*\/?>/y;

// params, variant blocks, tags and escapes survive verbatim
export function pseudoLocalize(message: string): string {
  let out = '';
  let letters = 0;
  let i = 0;
  while (i < message.length) {
    const two = message.slice(i, i + 2);
    if (two === '{{' || two === '}}' || two === '||' || two === '##') {
      out += two;
      i += 2;
      continue;
    }
    const ch = message[i]!;
    if (ch === '{') {
      const end = matchBrace(message, i);
      out += message.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '<') {
      TAG_AT.lastIndex = i;
      const m = TAG_AT.exec(message);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const mapped = ACCENTS[ch];
    if (mapped) {
      out += mapped;
      letters += 1;
    } else {
      out += ch;
    }
    i += 1;
  }
  const pad = '~'.repeat(Math.ceil(letters / 3));
  return `⟦${out}${pad ? ' ' + pad : ''}⟧`;
}

function matchBrace(message: string, start: number): number {
  let depth = 0;
  for (let i = start; i < message.length; i++) {
    const two = message.slice(i, i + 2);
    if (two === '{{' || two === '}}') {
      i += 1;
      continue;
    }
    const ch = message[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return message.length; // unbalanced → verbatim
}

// regenerates the whole pseudo catalog from the source catalog
export function pseudoCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  locale: string = PSEUDO_LOCALE,
): string[] {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const target: Catalog = {};
  for (const [key, msg] of Object.entries(source)) {
    target[key] = msg ? pseudoLocalize(msg) : '';
  }
  catalogs[locale] = target;
  return Object.keys(target).filter((key) => target[key]);
}
