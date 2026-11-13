import { emptyCatalog } from '../catalog/catalog';
import type { ExchangeEntry } from './exchange';

// CSV (RFC 4180); import reads columns by header name, so location round-trips inert
export function toCsv(entries: ExchangeEntry[]): string {
  const rows = entries.map(
    ({ key, source, target, location }) =>
      `${csvField(key)},${csvField(source)},${csvField(target)},${csvField(location?.join('; ') ?? '')}`,
  );
  return ['key,source,target,location', ...rows, ''].join('\r\n');
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(content: string): {
  entries: Record<string, string>;
  sources: Record<string, string>;
} {
  const rows = csvRows(content, csvSeparator(content));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const keyCol = header.indexOf('key');
  const targetCol = header.indexOf('target');
  const sourceCol = header.indexOf('source');
  if (keyCol === -1 || targetCol === -1) {
    throw new Error('[verbaly] CSV needs a header row with "key" and "target" columns');
  }
  const entries = emptyCatalog();
  const sources = emptyCatalog();
  for (const row of rows.slice(1)) {
    const key = row[keyCol];
    if (!key) continue;
    entries[key] = row[targetCol] ?? '';
    const source = sourceCol === -1 ? undefined : row[sourceCol];
    if (source) sources[key] = source;
  }
  return { entries, sources };
}

// a spreadsheet saves with the list separator of its region: ; where the comma marks decimals
function csvSeparator(content: string): string {
  let quoted = false;
  const seen = new Set<string>();
  for (const char of content) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted) seen.add(char);
  }
  return seen.has(',') ? ',' : seen.has(';') ? ';' : seen.has('\t') ? '\t' : ',';
}

function csvRows(content: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}
