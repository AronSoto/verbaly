// Intl is the one reader that decides whether a string is a locale tag, so it answers here too
export function isLocaleTag(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

// pt_BR is how gettext, Java and many backends write pt-BR: the one misspelling with a sure fix
export function suggestTag(tag: string): string | undefined {
  const near = tag.replace(/_/g, '-');
  return near !== tag && isLocaleTag(near) ? near : undefined;
}

// the project's own spelling of a tag written another way: pt_BR and PT-br both mean pt-BR
export function projectLocale(tag: string, locales: string[]): string | undefined {
  if (locales.includes(tag)) return tag;
  const plain = (value: string): string => value.replace(/_/g, '-').toLowerCase();
  return locales.find((locale) => plain(locale) === plain(tag));
}
