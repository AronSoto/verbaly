// gettext PO: msgctxt carries the key (keys are hashes), fuzzy or empty msgstr = untranslated

export interface PoEntry {
  key: string;
  source: string;
  target: string;
  location?: string[];
}

export function toPo(sourceLocale: string, locale: string, entries: PoEntry[]): string {
  const header = [
    'msgid ""',
    'msgstr ""',
    `${poString('Project-Id-Version: verbaly\n')}`,
    `${poString('MIME-Version: 1.0\n')}`,
    `${poString('Content-Type: text/plain; charset=UTF-8\n')}`,
    `${poString('Content-Transfer-Encoding: 8bit\n')}`,
    `${poString(`Language: ${locale}\n`)}`,
    `${poString(`X-Source-Language: ${sourceLocale}\n`)}`,
  ].join('\n');
  const blocks = entries.map(({ key, source, target, location }) =>
    [
      ...(location?.length ? [`#: ${location.join(' ')}`] : []),
      `msgctxt ${poString(key)}`,
      `msgid ${poString(source)}`,
      `msgstr ${poString(target)}`,
    ].join('\n'),
  );
  return [header, ...blocks, ''].join('\n\n');
}

export function parsePo(content: string): { locale?: string; entries: Record<string, string> } {
  const entries: Record<string, string> = {};
  let locale: string | undefined;

  let msgctxt: string | undefined;
  let msgid: string | undefined;
  let msgstr: string | undefined;
  let fuzzy = false;
  let field: 'msgctxt' | 'msgid' | 'msgstr' | 'other' | undefined;

  const finish = () => {
    if (msgid === '' && msgctxt === undefined) {
      const lang = /^Language:[ \t]*(.+?)[ \t]*$/m.exec(msgstr ?? '')?.[1];
      if (lang) locale = lang;
    } else if (msgctxt !== undefined && msgid !== undefined) {
      entries[msgctxt] = fuzzy ? '' : (msgstr ?? '');
    }
    msgctxt = msgid = msgstr = field = undefined;
    fuzzy = false;
  };

  // Windows editors may prepend a BOM; strip it before the first line parses
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r\n|[\r\n]/)) {
    const line = raw.trim();
    if (line === '') {
      finish();
      continue;
    }
    if (line.startsWith('#')) {
      if (/^#,.*\bfuzzy\b/.test(line)) fuzzy = true;
      continue;
    }
    const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(.*)$/.exec(line);
    if (keyword) {
      const [, name, rest] = keyword as unknown as [string, string, string];
      const value = poUnquote(rest);
      if (value === undefined) continue;
      if (name === 'msgctxt') {
        msgctxt = value;
        field = 'msgctxt';
      } else if (name === 'msgid') {
        msgid = value;
        field = 'msgid';
      } else if (name === 'msgstr' || name === 'msgstr[0]') {
        msgstr = value;
        field = 'msgstr';
      } else {
        // msgid_plural / msgstr[n>0]: verbaly plurals live inside one message, discard
        field = 'other';
      }
      continue;
    }
    const continuation = poUnquote(line);
    if (continuation === undefined || field === undefined || field === 'other') continue;
    if (field === 'msgctxt') msgctxt = (msgctxt ?? '') + continuation;
    else if (field === 'msgid') msgid = (msgid ?? '') + continuation;
    else msgstr = (msgstr ?? '') + continuation;
  }
  finish();
  return { locale, entries };
}

function poString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

function poUnquote(text: string): string | undefined {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(text);
  if (!match) return undefined;
  return match[1]!.replace(/\\(.)/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    if (ch === 'r') return '\r';
    return ch;
  });
}
