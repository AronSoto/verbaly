import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from 'jsonc-parser';
import picomatch from 'picomatch';

export type IncludeState = 'present' | 'added' | 'missing' | 'no-tsconfig' | 'unreadable';

interface TsconfigShape {
  include?: unknown;
  files?: unknown;
}

// tsconfig.json as TypeScript reads it: comments and trailing commas are legal there
function readTsconfig(root: string): { path: string; text: string; json: TsconfigShape } | string {
  const path = join(root, 'tsconfig.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return 'no-tsconfig';
  }
  const errors: ParseError[] = [];
  const json = parse(text, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length > 0 || typeof json !== 'object' || json === null || Array.isArray(json)) {
    return 'unreadable';
  }
  return { path, text, json: json as TsconfigShape };
}

// as TypeScript matches an entry: a glob skips dot folders, and a bare folder means all inside it
function covered(list: unknown, entry: string): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((item) => {
    if (typeof item !== 'string') return false;
    const pattern = item.replace(/^\.\//, '').replace(/\/+$/, '');
    return picomatch(pattern)(entry) || picomatch(`${pattern}/**/*`)(entry);
  });
}

// the indentation the file already uses, so the new line looks like the ones around it
function formatting(text: string): FormattingOptions {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
  return {
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

// whether TypeScript reads the generated file: never true for a file outside the project
export function typesIncluded(root: string, file: string): IncludeState {
  const read = readTsconfig(root);
  if (typeof read === 'string') return read as IncludeState;
  const entry = relative(root, file).replaceAll('\\', '/');
  const { include, files } = read.json;
  if (covered(include, entry) || covered(files, entry)) return 'present';
  return 'missing';
}

// TypeScript never walks into a dot folder by itself: .verbaly/ needs a line, like .next/types
export function includeTypes(root: string, file: string): IncludeState {
  const read = readTsconfig(root);
  if (typeof read === 'string') return read as IncludeState;
  const entry = relative(root, file).replaceAll('\\', '/');
  const { include, files } = read.json;
  if (covered(include, entry) || covered(files, entry)) return 'present';

  const options = { formattingOptions: formatting(read.text) };
  // a files list with no include means include defaults to nothing, so the entry goes there
  const edits = Array.isArray(include)
    ? modify(read.text, ['include', -1], entry, { ...options, isArrayInsertion: true })
    : Array.isArray(files) && include === undefined
      ? modify(read.text, ['files', -1], entry, { ...options, isArrayInsertion: true })
      : modify(read.text, ['include'], ['**/*', entry], options);
  writeFileSync(read.path, applyEdits(read.text, edits));
  return 'added';
}
