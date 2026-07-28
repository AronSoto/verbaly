import { describe, expect, it } from 'vitest';
import { PLURAL_CATEGORIES, validateMessage, validatePair } from '../src/validate';

const errors = (issues: { severity: string; message: string }[]): string[] =>
  issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
const warnings = (issues: { severity: string; message: string }[]): string[] =>
  issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message);

describe('validateMessage', () => {
  it('accepts a plain message and a complete plural block', () => {
    expect(validateMessage('Hello {name}', 'en')).toEqual([]);
    expect(validateMessage('{count | one: one item | other: # items}', 'en')).toEqual([]);
  });

  it('errors on a plural block with no other case (it renders empty)', () => {
    const issues = validateMessage('{count | one: one item | few: # items}', 'pl');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{count}');
    expect(errors(issues)[0]).toContain('renders empty');
  });

  it('leaves a select block without other alone: that is the author design', () => {
    expect(validateMessage('{gender | male: he | female: she}', 'en')).toEqual([]);
  });

  it('warns when the locale needs plural forms the message does not carry', () => {
    const issues = validateMessage('{count | one: 1 element | other: # elementow}', 'pl');
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toHaveLength(1);
    expect(warnings(issues)[0]).toContain('pl');
    expect(warnings(issues)[0]).toContain('few');
    expect(warnings(issues)[0]).toContain('many');
  });

  it('says nothing when the locale needs exactly what the message has', () => {
    expect(validateMessage('{count | one: uno | other: # varios}', 'es')).toEqual([]);
  });

  it('ignores a category no integer count can select', () => {
    // es, fr, pt and it declare "many" for compact forms ("1 millón"), never for a counter:
    // demanding it would warn on every Spanish plural in every project
    for (const locale of ['es', 'fr', 'pt', 'it']) {
      expect(validateMessage('{count | one: 1 | other: #}', locale)).toEqual([]);
    }
    // cs declares "many" for decimals only, so the report stops at few
    const cs = warnings(validateMessage('{count | one: 1 | other: #}', 'cs'));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toContain('few');
    expect(cs[0]).not.toContain('many');
  });

  it('reports every form a counter reaches in Arabic', () => {
    const issues = warnings(validateMessage('{count | one: 1 | other: #}', 'ar'));
    expect(issues).toHaveLength(1);
    for (const category of ['zero', 'two', 'few', 'many']) {
      expect(issues[0]).toContain(category);
    }
  });

  it('says nothing for a locale with a single form', () => {
    expect(validateMessage('{count | other: #}', 'ja')).toEqual([]);
  });

  it('skips the locale check entirely without a locale', () => {
    expect(validateMessage('{count | one: 1 | other: #}')).toEqual([]);
  });

  it('survives a garbage locale tag', () => {
    expect(validateMessage('{count | one: 1 | other: #}', 'not a locale!!')).toEqual([]);
  });

  it('reaches a plural block nested inside another variant', () => {
    const issues = validateMessage('{a | one: {b | one: x | two: y} | other: z}', 'en');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{b}');
  });

  it('exposes the CLDR category names it keys on', () => {
    expect([...PLURAL_CATEGORIES].sort()).toEqual(['few', 'many', 'one', 'two', 'zero']);
    expect(PLURAL_CATEGORIES.has('other')).toBe(false);
  });
});

describe('validatePair', () => {
  it('accepts a faithful translation', () => {
    expect(validatePair('Hello {name}', 'Hola {name}')).toEqual([]);
    expect(validatePair('<em>Save</em> now', '<em>Guarda</em> ya')).toEqual([]);
  });

  it('errors on a dropped param', () => {
    const issues = validatePair('Hello {name}', 'Hola');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{name}');
    expect(errors(issues)[0]).toContain('never reaches the text');
  });

  it('errors on a renamed param, naming both sides', () => {
    const issues = validatePair('Hello {name}', 'Hola {nombre}');
    expect(errors(issues)).toHaveLength(2);
    expect(errors(issues).join(' ')).toContain('{name}');
    expect(errors(issues).join(' ')).toContain('{nombre}');
  });

  it('lists several dropped params in one issue', () => {
    const issues = validatePair('{a} {b} {c}', '{a}');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{b} and {c}');
  });

  it('errors on a dropped rich tag and on an invented one', () => {
    const dropped = errors(validatePair('<em>a</em>', 'a'));
    expect(dropped).toHaveLength(1);
    // the pair is named once: "</em> and <em>" would read like two separate problems
    expect(dropped[0]).toBe('<em> is missing from the translation');
    expect(errors(validatePair('a', '<em>a</em>'))).toHaveLength(1);
  });

  it('counts repeated tags, so losing one of two is caught', () => {
    const issues = validatePair('<em>a</em> and <em>b</em>', '<em>a</em> and b');
    expect(errors(issues)).toHaveLength(1);
  });

  it('leaves angle-bracket prose alone: a lone <Enter> is text, not markup', () => {
    // rich rendering drops an unclosed tag and plain text prints it verbatim, so neither
    // shape is structure the translation has to keep. Demanding it failed correct work
    expect(validatePair('Press <Enter> to continue', 'Pulsa <Intro> para continuar')).toEqual([]);
    expect(validatePair('Use <T> for the type', 'Usa <T> para el tipo')).toEqual([]);
  });

  it('still catches a closed tag inside prose that also carries a lone one', () => {
    const issues = validatePair('Press <Enter> to <em>save</em>', 'Pulsa <Intro> para guardar');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('<em>');
  });

  it('catches a half-closed pair, the wrapper is gone at render time', () => {
    const issues = validatePair('Read the <em>docs</em>', 'Lee la <em>documentacion');
    expect(errors(issues)).toHaveLength(1);
  });

  it('accepts a self-closing tag round trip and flags losing it', () => {
    expect(validatePair('one<br/>two', 'uno<br/>dos')).toEqual([]);
    expect(errors(validatePair('one<br/>two', 'uno dos'))).toHaveLength(1);
    expect(errors(validatePair('one<br/>two', 'uno dos'))[0]).toContain('<br/>');
  });

  it('errors when a plural block is flattened into plain text', () => {
    const issues = validatePair('{count | one: one item | other: # items}', '{count} elementos');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('plural block');
    expect(errors(issues)[0]).toContain('flattened');
  });

  it('errors when a select block loses its other case', () => {
    const issues = validatePair(
      '{gender | male: he | female: she | other: they}',
      '{gender | male: el | female: ella}',
    );
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('"other"');
  });

  it('does not repeat the other-case report for a plural block', () => {
    // validateMessage owns that one, so the pair check stays quiet about it
    const issues = validatePair(
      '{count | one: one item | other: # items}',
      '{count | one: un elemento}',
    );
    expect(errors(issues)).toEqual([]);
  });

  it('warns when an exact case is dropped, it still renders via other', () => {
    const issues = validatePair(
      '{count | =0: nothing yet | one: one item | other: # items}',
      '{count | one: un elemento | other: # elementos}',
    );
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toHaveLength(1);
    expect(warnings(issues)[0]).toContain('=0');
  });

  it('accepts a translation that adds plural forms the source did not need', () => {
    expect(
      validatePair(
        '{count | one: one item | other: # items}',
        '{count | one: 1 element | few: # elementy | many: # elementow | other: # elementu}',
      ),
    ).toEqual([]);
  });

  it('treats an escaped brace as text, not as a param', () => {
    expect(validatePair('a {{literal}} b', 'a {{literal}} b')).toEqual([]);
  });

  it('accepts an ICU source translated back to ICU', () => {
    expect(
      validatePair(
        '{count, plural, one {one item} other {# items}}',
        '{count, plural, one {un elemento} other {# elementos}}',
      ),
    ).toEqual([]);
  });
});
