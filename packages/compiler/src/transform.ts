import MagicString from 'magic-string';
import { analyze, type Analysis } from './analyze';

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

export function transformCode(
  code: string,
  file: string,
  analysis?: Analysis,
): TransformResult | null {
  const { tagged } = analysis ?? analyze(code, file);
  if (tagged.length === 0) return null;

  const s = new MagicString(code);
  for (const msg of tagged) {
    const seen = new Set<string>();
    const entries = msg.params.filter((p) => !seen.has(p.name) && seen.add(p.name));
    const pairs = entries
      .map((p) => `${JSON.stringify(p.name)}: ${code.slice(p.start, p.end)}`)
      .join(', ');

    if (msg.jsx) {
      const values = entries.length ? ` values={{ ${pairs} }}` : '';
      const components = msg.jsx.components.length
        ? ` components={{ ${msg.jsx.components
            .map((c) => `${JSON.stringify(c.name)}: ${c.source}`)
            .join(', ')} }}`
        : '';
      s.overwrite(
        msg.start,
        msg.end,
        `<${msg.jsx.name} id=${JSON.stringify(msg.key)}${values}${components} />`,
      );
      continue;
    }

    const tagSource = code.slice(msg.tagStart, msg.tagEnd);
    const args = entries.length ? `, { ${pairs} }` : '';
    s.overwrite(msg.start, msg.end, `${tagSource}(${JSON.stringify(msg.key)}${args})`);
  }
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
