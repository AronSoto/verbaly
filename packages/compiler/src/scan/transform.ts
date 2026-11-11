import MagicString from 'magic-string';
import type { Analysis } from './analyze';
import { analyzeFile } from './sfc';
import { APP_ID } from '../util/ids';
import { singleQuoted } from '../util/text';
import { warnParseError } from '../util/warn';

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

function quote(text: string, single: boolean | undefined): string {
  return single ? singleQuoted(text) : JSON.stringify(text);
}

export function transformCode(
  code: string,
  file: string,
  analysis?: Analysis,
  // appImport: load verbaly/app where an adapter is imported, for a bundler that generates it
  options: { appImport?: boolean } = {},
): TransformResult | null {
  const own = analysis ?? analyzeFile(code, file);
  if (!analysis && own.parseError) warnParseError(file, own.parseError);
  const { tagged } = own;
  const appAt = options.appImport && !own.appImported ? own.adapterImport : undefined;
  if (tagged.length === 0 && appAt === undefined) return null;

  const s = new MagicString(code);
  // on the import's own line: every line after it keeps its number
  if (appAt !== undefined) s.appendLeft(appAt, `import '${APP_ID}'; `);
  for (const msg of tagged) {
    const seen = new Set<string>();
    const entries = msg.params.filter((p) => !seen.has(p.name) && seen.add(p.name));
    const pairs = entries
      .map((p) => `${quote(p.name, msg.singleQuote)}: ${code.slice(p.start, p.end)}`)
      .join(', ');

    if (msg.jsx) {
      const values = entries.length ? ` values={{ ${pairs} }}` : '';
      const components = msg.jsx.components.length
        ? ` components={{ ${msg.jsx.components
            .map((c) => `${JSON.stringify(c.name)}: ${c.source}`)
            .join(', ')} }}`
        : '';
      // a quoted jsx attribute has no escapes: a key with a quote or a backslash goes in braces
      const quoted = JSON.stringify(msg.key);
      const id = quoted === `"${msg.key}"` ? quoted : `{${quoted}}`;
      s.overwrite(msg.start, msg.end, `<${msg.jsx.name} id=${id}${values}${components} />`);
      continue;
    }

    const tagSource = code.slice(msg.tagStart, msg.tagEnd);
    const args = entries.length ? `, { ${pairs} }` : '';
    s.overwrite(msg.start, msg.end, `${tagSource}(${quote(msg.key, msg.singleQuote)}${args})`);
  }
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
