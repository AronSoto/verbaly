import { emptyCatalog } from '../catalog/catalog';
import { escapeXml, inlineToMessage, messageToInline } from './inline';
import { decodeEntities, readAttributes, TAG_REST } from '../util/markup';
import type { ExchangeEntry } from './exchange';

// XLIFF 2.0 (writes) / 2.0 + 1.2 (reads); params/tags travel as <ph>/<pc> inline codes
export function toXliff(sourceLocale: string, locale: string, entries: ExchangeEntry[]): string {
  const units = entries
    .map(({ key, source, target, location }) =>
      [
        `    <unit id="${escapeXml(key)}">`,
        ...(location?.length
          ? [
              '      <notes>',
              ...location.map(
                (file) => `        <note category="location">${escapeXml(file)}</note>`,
              ),
              '      </notes>',
            ]
          : []),
        `      <segment state="${target ? 'translated' : 'initial'}">`,
        `        <source>${messageToInline(source)}</source>`,
        `        <target>${messageToInline(target)}</target>`,
        '      </segment>',
        '    </unit>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${escapeXml(sourceLocale)}" trgLang="${escapeXml(locale)}">`,
    `  <file id="verbaly" original="${escapeXml(`${locale}.json`)}">`,
    units,
    '  </file>',
    '</xliff>',
    '',
  ].join('\n');
}

const UNIT = `<(?:trans-)?unit\\b(${TAG_REST})>([\\s\\S]*?)</(?:trans-)?unit>`;
const TARGET = new RegExp(`<target\\b${TAG_REST}>([\\s\\S]*?)</target>`);
const SOURCE = new RegExp(`<source\\b${TAG_REST}>([\\s\\S]*?)</source>`);

// the first start tag of that name: 2.0 names the language on <xliff>, 1.2 on <file>
function tagAttribute(content: string, tag: string, name: string): string | undefined {
  const open = new RegExp(`<${tag}\\b(${TAG_REST})>`).exec(content);
  return (open && readAttributes(open[1]!).get(name)?.value) || undefined;
}

export function parseXliff(content: string): {
  locale?: string;
  entries: Record<string, string>;
  sources: Record<string, string>;
} {
  const head = (name: string): string | undefined =>
    tagAttribute(content, 'xliff', name) ?? tagAttribute(content, 'file', name);
  const locale = head('trgLang') ?? head('target-language');
  const entries = emptyCatalog();
  const sources = emptyCatalog();
  for (const match of content.matchAll(new RegExp(UNIT, 'g'))) {
    const id = readAttributes(match[1]!).get('id')?.value;
    if (!id) continue;
    const target = TARGET.exec(match[2]!)?.[1];
    entries[decodeEntities(id)] = target === undefined ? '' : inlineToMessage(stripCdata(target));
    const source = SOURCE.exec(match[2]!)?.[1];
    if (source !== undefined) sources[decodeEntities(id)] = inlineToMessage(stripCdata(source));
  }
  return { locale, entries, sources };
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
