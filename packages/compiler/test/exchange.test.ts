import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { exportCatalogs, importCatalogs, parseExchangeFile } from '../src/exchange';

function cfg(locales: string[] = ['en', 'es']) {
  return resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-')),
    sourceLocale: 'en',
    locales,
  });
}

function scratch(name: string, content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'verbaly-')), name);
  writeFileSync(file, content);
  return file;
}

describe('exportCatalogs', () => {
  it('writes one XLIFF per target locale with source + target', () => {
    const config = cfg(['en', 'es', 'pt']);
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', bye: 'Bye' },
      es: { greet: 'Hola {name}', bye: '' },
      pt: {},
    };
    const result = exportCatalogs(config, catalogs);
    expect(result.format).toBe('xliff');
    expect(result.files.map((f) => f.locale)).toEqual(['es', 'pt']);
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es).toContain('srcLang="en"');
    expect(es).toContain('trgLang="es"');
    expect(es).toContain('<unit id="greet">');
    expect(es).toContain('<source>Hello <ph id="name" disp="{name}"/></source>');
    expect(es).toContain('<target>Hola <ph id="name" disp="{name}"/></target>');
    expect(es).toContain('state="translated"');
    expect(es).toContain('state="initial"');
    expect(result.files[0]).toMatchObject({ total: 2, untranslated: 1 });
  });

  it('escapes XML, protects rich tags as <pc> and skips empty source entries', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { rich: 'The <em>gate</em> & more', blank: '' },
      es: {},
    };
    const result = exportCatalogs(config, catalogs);
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es).toContain(
      'The <pc id="em" dispStart="&lt;em&gt;" dispEnd="&lt;/em&gt;">gate</pc> &amp; more',
    );
    expect(es).not.toContain('blank');
  });

  it('csv format quotes fields and honors --missing', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { a: 'Hello, "world"', b: 'Done' },
      es: { a: '', b: 'Hecho' },
    };
    const result = exportCatalogs(config, catalogs, { format: 'csv', missing: true });
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es.startsWith('key,source,target,location\r\n')).toBe(true);
    expect(es).toContain('a,"Hello, ""world""",,');
    expect(es).not.toContain('Done');
  });

  it('tolerates a missing source catalog and a target with no catalog', () => {
    const config = cfg(['en', 'es']);
    // no en entry at all, es present but empty: export must not throw, just write empty files
    const result = exportCatalogs(config, { es: {} });
    expect(result.files.map((f) => f.locale)).toEqual(['es']);
    expect(result.files[0]).toMatchObject({ total: 0, untranslated: 0 });
  });

  it('mobile export tolerates a missing source and target catalog', () => {
    const config = cfg(['en', 'es']);
    const result = exportCatalogs(config, {}, { format: 'ios-strings' });
    expect(result.files.map((f) => f.locale)).toEqual(['en', 'es']);
    expect(result.files.every((f) => f.total === 0)).toBe(true);
  });

  it('writes origins as xliff location notes and a csv column', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { a: 'Hello' }, es: { a: '' } };
    const origins = { a: ['src/App.tsx', 'src/pages/home.vue'] };

    const xliff = exportCatalogs(config, catalogs, { origins });
    const xlf = readFileSync(xliff.files[0]!.path, 'utf8');
    expect(xlf).toContain('<note category="location">src/App.tsx</note>');
    expect(xlf).toContain('<note category="location">src/pages/home.vue</note>');

    const csv = exportCatalogs(config, catalogs, { format: 'csv', origins });
    const es = readFileSync(csv.files[0]!.path, 'utf8');
    expect(es).toContain('a,Hello,,src/App.tsx; src/pages/home.vue');
  });

  it('round-trips an xliff with location notes through import', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { a: 'Hello' }, es: { a: '' } };
    const result = exportCatalogs(config, catalogs, { origins: { a: ['src/App.tsx'] } });
    const path = result.files[0]!.path;
    const translated = readFileSync(path, 'utf8').replace(
      '<target></target>',
      '<target>Hola</target>',
    );
    writeFileSync(path, translated);
    const imported = importCatalogs(config, catalogs, [path]);
    expect(imported.imported.es).toEqual(['a']);
    expect(catalogs.es!.a).toBe('Hola');
  });
});

describe('exportCatalogs: xliff inline codes', () => {
  it('keeps variant params raw so translators can edit their bodies', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { count: '{n | one: One file | other: # files} in {dir}' },
      es: {},
    };
    const result = exportCatalogs(config, catalogs);
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es).toContain('{n | one: One file | other: # files}');
    expect(es).toContain('<ph id="dir" disp="{dir}"/>');
  });

  it('gives repeated names unique ids and protects self-closing tags', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { two: '{name} vs {name}, then <br/>' },
      es: {},
    };
    const result = exportCatalogs(config, catalogs);
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es).toContain('<ph id="name" disp="{name}"/>');
    expect(es).toContain('<ph id="name2" disp="{name}"/>');
    expect(es).toContain('<ph id="br" disp="&lt;br/&gt;"/>');
  });

  it('round-trips params, tags, formats and escapes losslessly through import', () => {
    const config = cfg();
    const message =
      'Pay {price:currency/EUR} to <em>{name}</em>, use {{literal}} and <a>{n | one: one | other: # things}</a>';
    const catalogs: Catalogs = { en: { pay: message }, es: {} };
    const result = exportCatalogs(config, catalogs);
    const path = result.files[0]!.path;
    const xlf = readFileSync(path, 'utf8');
    expect(xlf).toContain('<ph id="price" disp="{price:currency/EUR}"/>');
    // translate = copy the source segment into the target, codes included
    const source = /<source>([\s\S]*?)<\/source>/.exec(xlf)![1]!;
    writeFileSync(path, xlf.replace('<target></target>', `<target>${source}</target>`));
    const imported = importCatalogs(config, catalogs, [path]);
    expect(imported.imported.es).toEqual(['pay']);
    expect(catalogs.es!.pay).toBe(message);
  });

  it('reconstructs from the semantic id when a TMS strips disp attributes', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello {name}', rich: 'A <em>b</em>' } };
    const file = scratch(
      'es.xlf',
      `<xliff version="2.0" srcLang="en" trgLang="es"><file id="v">` +
        `<unit id="greet"><segment><source>x</source><target>Hola <ph id="name"/></target></segment></unit>` +
        `<unit id="rich"><segment><source>x</source><target>El <pc id="em">be</pc></target></segment></unit>` +
        `</file></xliff>`,
    );
    const result = importCatalogs(config, catalogs, [file]);
    expect(result.imported.es).toEqual(['greet', 'rich']);
    expect(catalogs.es).toEqual({ greet: 'Hola {name}', rich: 'El <em>be</em>' });
  });
});

describe('exportCatalogs: po format', () => {
  it('writes gettext PO with msgctxt keys, locations and a Language header', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', multi: 'Line one\nsays "hi"' },
      es: { greet: 'Hola {name}', multi: '' },
    };
    const result = exportCatalogs(config, catalogs, {
      format: 'po',
      origins: { greet: ['src/App.tsx', 'src/pages/home.vue'] },
    });
    expect(result.format).toBe('po');
    expect(result.files[0]!.path.endsWith('es.po')).toBe(true);
    const es = readFileSync(result.files[0]!.path, 'utf8');
    expect(es).toContain('"Language: es\\n"');
    expect(es).toContain('#: src/App.tsx src/pages/home.vue');
    expect(es).toContain('msgctxt "greet"');
    expect(es).toContain('msgid "Hello {name}"');
    expect(es).toContain('msgstr "Hola {name}"');
    expect(es).toContain('msgid "Line one\\nsays \\"hi\\""');
    expect(es).toContain('msgstr ""');
    expect(result.files[0]).toMatchObject({ total: 2, untranslated: 1 });
  });

  it('full cycle: export po → translate the file → import', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello {name}' }, es: {} };
    const [exported] = exportCatalogs(config, catalogs, { format: 'po' }).files;
    const translated = readFileSync(exported!.path, 'utf8').replace(
      /msgstr ""(\r?\n\r?\n|\r?\n$)/,
      'msgstr "Hola {name}"$1',
    );
    writeFileSync(exported!.path, translated);
    const result = importCatalogs(config, catalogs, [exported!.path]);
    expect(result.imported).toEqual({ es: ['greet'] });
    expect(catalogs.es!.greet).toBe('Hola {name}');
  });
});

describe('exportCatalogs: mobile formats', () => {
  it('android-xml writes drop-in values dirs, ships the source as default, skips untranslated', () => {
    const config = cfg(['en', 'es', 'pt-BR']);
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', bye: "It's over" },
      es: { greet: 'Hola {name}', bye: '' },
      'pt-BR': { greet: 'Olá {name}', bye: 'Acabou' },
    };
    const result = exportCatalogs(config, catalogs, { format: 'android-xml' });
    expect(result.format).toBe('android-xml');
    expect(result.files.map((f) => f.locale)).toEqual(['en', 'es', 'pt-BR']);
    const [en, es, pt] = result.files;
    expect(en!.path.replace(/\\/g, '/')).toContain('/values/strings.xml');
    expect(es!.path.replace(/\\/g, '/')).toContain('/values-es/strings.xml');
    expect(pt!.path.replace(/\\/g, '/')).toContain('/values-pt-rBR/strings.xml');
    const esXml = readFileSync(es!.path, 'utf8');
    expect(esXml).toContain('<string name="greet">Hola {name}</string>');
    expect(esXml).not.toContain('bye');
    expect(es).toMatchObject({ total: 1, untranslated: 1 });
    const enXml = readFileSync(en!.path, 'utf8');
    expect(enXml).toContain("It\\'s over");
    expect(en).toMatchObject({ total: 2, untranslated: 0 });
  });

  it('android-xml uses BCP-47 b+ qualifier for script-tagged locales', () => {
    const config = cfg(['en', 'zh-Hant-TW']);
    const catalogs: Catalogs = { en: { a: 'A' }, 'zh-Hant-TW': { a: '甲' } };
    const result = exportCatalogs(config, catalogs, { format: 'android-xml' });
    const zh = result.files.find((f) => f.locale === 'zh-Hant-TW')!;
    expect(zh.path.replace(/\\/g, '/')).toContain('/values-b+zh+Hant+TW/strings.xml');
  });

  it('android-xml escapes markup and sanitizes resource names', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { 'hero.title': 'The <em>gate</em> & more', '7days': '@home?\nok' },
      es: { 'hero.title': 'La <em>puerta</em> & más', '7days': '@casa' },
    };
    const result = exportCatalogs(config, catalogs, { format: 'android-xml' });
    const es = readFileSync(result.files[1]!.path, 'utf8');
    expect(es).toContain(
      '<string name="hero_title">La &lt;em&gt;puerta&lt;/em&gt; &amp; más</string>',
    );
    expect(es).toContain('<string name="_7days">\\@casa</string>');
    const en = readFileSync(result.files[0]!.path, 'utf8');
    expect(en).toContain('\\@home?\\nok');
  });

  it('android-xml rejects keys that collide after sanitizing', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { 'a.b': 'One', a_b: 'Two' }, es: {} };
    expect(() => exportCatalogs(config, catalogs, { format: 'android-xml' })).toThrow(
      /both become resource name "a_b"/,
    );
  });

  it('ios-strings writes lproj folders with escaped values', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { greet: 'Say "hi"\nnow', bye: 'Bye' },
      es: { greet: 'Di "hola"', bye: '' },
    };
    const result = exportCatalogs(config, catalogs, { format: 'ios-strings' });
    expect(result.files.map((f) => f.locale)).toEqual(['en', 'es']);
    expect(result.files[1]!.path.replace(/\\/g, '/')).toContain('es.lproj/Localizable.strings');
    const es = readFileSync(result.files[1]!.path, 'utf8');
    expect(es).toBe('"greet" = "Di \\"hola\\"";\n');
    const en = readFileSync(result.files[0]!.path, 'utf8');
    expect(en).toContain('"bye" = "Bye";');
    expect(en).toContain('"greet" = "Say \\"hi\\"\\nnow";');
  });
});

describe('importCatalogs', () => {
  const XLIFF = `<?xml version="1.0" encoding="UTF-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="es">
  <file id="verbaly" original="es.json">
    <unit id="greet">
      <segment state="translated">
        <source>Hello {name}</source>
        <target>Hola {name}</target>
      </segment>
    </unit>
    <unit id="rich">
      <segment state="translated">
        <source>The &lt;em&gt;gate&lt;/em&gt;</source>
        <target>El &lt;em&gt;gate&lt;/em&gt;</target>
      </segment>
    </unit>
  </file>
</xliff>
`;

  it('round-trips an exported XLIFF back into the catalog', () => {
    const config = cfg();
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', rich: 'The <em>gate</em>' },
      es: { greet: '', rich: '' },
    };
    const file = scratch('es.xlf', XLIFF);
    const result = importCatalogs(config, catalogs, [file]);
    expect(result.imported).toEqual({ es: ['greet', 'rich'] });
    expect(catalogs.es).toEqual({ greet: 'Hola {name}', rich: 'El <em>gate</em>' });
  });

  it('full cycle: export → translate the file → import', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello {name}' }, es: {} };
    const [exported] = exportCatalogs(config, catalogs).files;
    const translated = readFileSync(exported!.path, 'utf8').replace(
      '<target></target>',
      '<target>Hola {name}</target>',
    );
    writeFileSync(exported!.path, translated);
    const result = importCatalogs(config, catalogs, [exported!.path]);
    expect(result.imported).toEqual({ es: ['greet'] });
    expect(catalogs.es!.greet).toBe('Hola {name}');
  });

  it('rejects targets that break params or tags, keeps catalog intact', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello {name}' }, es: { greet: '' } };
    const file = scratch('es.csv', 'key,source,target\r\ngreet,Hello {name},Hola {nombre}\r\n');
    const result = importCatalogs(config, catalogs, [file]);
    expect(result.rejected).toEqual({ es: ['greet'] });
    expect(catalogs.es!.greet).toBe('');
  });

  it('keeps existing translations unless overwrite', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello' }, es: { greet: 'Hola' } };
    const file = scratch('es.csv', 'key,source,target\r\ngreet,Hello,Buenas\r\n');
    const kept = importCatalogs(config, catalogs, [file]);
    expect(kept.skipped).toEqual({ es: ['greet'] });
    expect(catalogs.es!.greet).toBe('Hola');
    const replaced = importCatalogs(config, catalogs, [file], { overwrite: true });
    expect(replaced.imported).toEqual({ es: ['greet'] });
    expect(catalogs.es!.greet).toBe('Buenas');
  });

  it('ignores unknown keys and empty targets, dry-run writes nothing', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello' }, es: { greet: '' } };
    const file = scratch(
      'es.csv',
      'key,source,target\r\ngreet,Hello,Hola\r\ngone,Old,Viejo\r\nempty,Hey,\r\n',
    );
    const result = importCatalogs(config, catalogs, [file], { dryRun: true });
    expect(result.imported).toEqual({ es: ['greet'] });
    expect(result.unknown).toEqual({ es: ['gone'] });
    expect(catalogs.es!.greet).toBe('');
  });

  it('rejects a garbage locale from a renamed file', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello' } };
    const file = scratch('es (1).csv', 'key,source,target\r\ngreet,Hello,Hola\r\n');
    expect(() => importCatalogs(config, catalogs, [file])).toThrow(/--locale/);
    expect(importCatalogs(config, catalogs, [file], { locale: 'es' }).imported).toEqual({
      es: ['greet'],
    });
  });

  it('refuses to import into the source locale', () => {
    const config = cfg();
    const catalogs: Catalogs = { en: { greet: 'Hello' } };
    const file = scratch('en.csv', 'key,source,target\r\ngreet,Hello,Hi\r\n');
    expect(() => importCatalogs(config, catalogs, [file])).toThrow(/source locale/);
  });
});

describe('parseExchangeFile', () => {
  it('reads XLIFF 1.2 (trans-unit + target-language) and CDATA', () => {
    const file = scratch(
      'legacy.xlf',
      `<?xml version="1.0"?>
<xliff version="1.2">
  <file source-language="en" target-language="pt" original="pt.json" datatype="plaintext">
    <body>
      <trans-unit id="greet">
        <source>Hello</source>
        <target><![CDATA[Olá <em>you</em>]]></target>
      </trans-unit>
    </body>
  </file>
</xliff>`,
    );
    const parsed = parseExchangeFile(file);
    expect(parsed.locale).toBe('pt');
    expect(parsed.entries).toEqual({ greet: 'Olá <em>you</em>' });
  });

  it('csv falls back to the filename for the locale, --locale wins', () => {
    const file = scratch('pt.csv', 'key,source,target\r\ngreet,Hello,Olá\r\n');
    expect(parseExchangeFile(file).locale).toBe('pt');
    expect(parseExchangeFile(file, 'es').locale).toBe('es');
  });

  it('rejects unsupported extensions and CSV without headers', () => {
    const file = scratch('es.txt', 'whatever');
    expect(() => parseExchangeFile(file)).toThrow(/unsupported format/);
    const noHeader = scratch('es.csv', 'greet,Hello,Hola\r\n');
    expect(() => parseExchangeFile(noHeader)).toThrow(/header/);
  });

  it('decodes numeric entities in XLIFF targets', () => {
    const file = scratch(
      'es.xlf',
      `<xliff version="2.0" srcLang="en" trgLang="es"><file id="v"><unit id="a"><segment><source>Hi</source><target>&#72;ola &#x2014; s&#237;</target></segment></unit></file></xliff>`,
    );
    expect(parseExchangeFile(file).entries).toEqual({ a: 'Hola — sí' });
  });

  it('throws on an XLIFF with no target language and no --locale', () => {
    const file = scratch(
      'catalog.xlf',
      `<xliff version="2.0" srcLang="en"><file id="v"><unit id="a"><segment><source>Hi</source><target>Hola</target></segment></unit></file></xliff>`,
    );
    expect(() => parseExchangeFile(file)).toThrow(/no trgLang\/target-language/);
    expect(parseExchangeFile(file, 'es').entries).toEqual({ a: 'Hola' });
  });

  it('skips units without an id and reads a missing target as untranslated', () => {
    const file = scratch(
      'es.xlf',
      `<xliff version="2.0" srcLang="en" trgLang="es"><file id="v">` +
        `<unit><segment><source>No id</source><target>Ignorado</target></segment></unit>` +
        `<unit id="empty"><segment><source>Pending</source></segment></unit>` +
        `</file></xliff>`,
    );
    expect(parseExchangeFile(file).entries).toEqual({ empty: '' });
  });

  it('decodes named apos and quot entities in ids and targets', () => {
    const file = scratch(
      'es.xlf',
      `<xliff version="2.0" srcLang="en" trgLang="es"><file id="v">` +
        `<unit id="it&apos;s"><segment><source>x</source><target>a &quot;b&quot; &apos;c&apos;</target></segment></unit>` +
        `</file></xliff>`,
    );
    expect(parseExchangeFile(file).entries).toEqual({ "it's": `a "b" 'c'` });
  });

  it('parses quoted CSV fields with embedded commas, quotes and newlines', () => {
    const file = scratch(
      'es.csv',
      'key,source,target\r\n' + 'multi,"Hello, ""world""","Hola,\nmundo ""x"""\r\n',
    );
    expect(parseExchangeFile(file).entries).toEqual({ multi: 'Hola,\nmundo "x"' });
  });

  it('reads CSV rows shorter than the header as empty targets', () => {
    const file = scratch('es.csv', 'key,source,target\r\nlonely\r\n');
    expect(parseExchangeFile(file).entries).toEqual({ lonely: '' });
  });

  it('po: reads the Language header, fuzzy as untranslated and multiline strings', () => {
    const file = scratch(
      'whatever.po',
      [
        'msgid ""',
        'msgstr ""',
        '"Language: pt\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '',
        'msgctxt "greet"',
        'msgid "Hello"',
        'msgstr ""',
        '"Olá "',
        '"mundo"',
        '',
        '#, fuzzy',
        'msgctxt "draft"',
        'msgid "Bye"',
        'msgstr "Tchau"',
        '',
        'msgid "no context"',
        'msgstr "ignored"',
        '',
      ].join('\n'),
    );
    const parsed = parseExchangeFile(file);
    expect(parsed.locale).toBe('pt');
    expect(parsed.entries).toEqual({ greet: 'Olá mundo', draft: '' });
  });

  it('po: falls back to the filename for the locale, --locale wins', () => {
    const file = scratch('pt.po', 'msgctxt "greet"\nmsgid "Hello"\nmsgstr "Olá"\n');
    expect(parseExchangeFile(file).locale).toBe('pt');
    expect(parseExchangeFile(file, 'es').locale).toBe('es');
    expect(parseExchangeFile(file).entries).toEqual({ greet: 'Olá' });
  });

  it('po: a gettext plural block keeps the singular and discards the rest', () => {
    const file = scratch(
      'es.po',
      [
        'msgctxt "count"',
        'msgid "one item"',
        'msgid_plural "%d items"',
        'msgstr[0] "un elemento"',
        'msgstr[1] "%d "',
        '"elementos"',
        '',
      ].join('\n'),
    );
    expect(parseExchangeFile(file).entries).toEqual({ count: 'un elemento' });
  });

  it('po: a value that is not a quoted string drops its entry, never half-writes it', () => {
    const file = scratch('es.po', 'msgctxt "ok"\nmsgid Hello\nmsgstr "Hola"\n');
    expect(parseExchangeFile(file).entries).toEqual({});
  });

  it('po: msgctxt and msgid wrap across lines the way msgstr already did', () => {
    const file = scratch(
      'es.po',
      [
        'msgctxt "very"',
        '"LongKey"',
        'msgid "a"',
        '"b"',
        'msgstr "x"',
        '',
      ].join('\n'),
    );
    expect(parseExchangeFile(file).entries).toEqual({ veryLongKey: 'x' });
  });
  it('po: unescapes backslash sequences in values', () => {
    const file = scratch('es.po', 'msgctxt "path"\nmsgid "x"\nmsgstr "a\\tb\\n\\"c\\" \\\\end"\n');
    expect(parseExchangeFile(file).entries).toEqual({ path: 'a\tb\n"c" \\end' });
  });
});
