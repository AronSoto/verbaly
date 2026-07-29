export interface MobileEntry {
  key: string;
  text: string;
}

// Android qualifier: source = values/, two-letter region = -r, anything else BCP-47 b+
export function androidValuesDir(locale: string, sourceLocale: string): string {
  if (locale === sourceLocale) return 'values';
  const parts = locale.split('-');
  if (parts.length === 1) return `values-${locale}`;
  if (parts.length === 2 && /^[a-zA-Z]{2}$/.test(parts[1]!)) {
    return `values-${parts[0]}-r${parts[1]!.toUpperCase()}`;
  }
  return `values-b+${parts.join('+')}`;
}

export function toAndroidXml(entries: MobileEntry[]): string {
  const names = new Map<string, string>();
  const lines = entries.map(({ key, text }) => {
    const name = androidName(key);
    const clash = names.get(name);
    if (clash !== undefined) {
      throw new Error(
        `[verbaly] android-xml: keys "${clash}" and "${key}" both become resource name "${name}", rename one of them.`,
      );
    }
    names.set(name, key);
    return `  <string name="${name}">${androidText(text)}</string>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<resources>',
    ...lines,
    '</resources>',
    '',
  ].join('\n');
}

export function toIosStrings(entries: MobileEntry[]): string {
  const lines = entries.map(({ key, text }) => `"${iosText(key)}" = "${iosText(text)}";`);
  return [...lines, ''].join('\n');
}

// resource names must be identifiers: other chars collapse to _ (collisions rejected later)
function androidName(key: string): string {
  const name = key.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

// aapt unescapes XML then backslashes; a leading @ or ? would read as a resource reference
function androidText(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return /^[@?]/.test(escaped) ? `\\${escaped}` : escaped;
}

function iosText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
