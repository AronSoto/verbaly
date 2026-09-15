import { describe, expect, it } from 'vitest';
import { validateMessage, validatePair } from '../src/validate';

const errors = (issues: { severity: string; message: string }[]): string[] =>
  issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);

describe('the gate looks inside an ICU message', () => {
  // Proved able to fail by dropping parseIcu from validate.ts: every one of these returns [].
  it('catches a plural block a translation flattened into plain text', () => {
    const source = '{count, plural, one {# file} other {# files}}';
    const issues = validatePair(source, 'archivos');
    expect(errors(issues)).toHaveLength(2);
    expect(errors(issues).join(' ')).toContain('{count}');
    expect(errors(issues).join(' ')).toContain('flattened into plain text');
  });

  it('catches a parameter the translation dropped', () => {
    const issues = validatePair('{name} has {count, number} points', '{name} tiene puntos');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{count}');
  });

  it('catches a parameter the translation invented', () => {
    const issues = validatePair('{count, number} points', '{count, number} puntos de {user}');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('{user}');
  });

  it('errors on an ICU plural with no other case, which renders empty', () => {
    const issues = validateMessage('{count, plural, one {# file} few {# files}}', 'pl');
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain('renders empty');
  });

  it('reads an exact case, so losing =0 is reported as falling back to other', () => {
    const source = '{count, plural, =0 {none} one {# file} other {# files}}';
    const issues = validatePair(source, '{count, plural, one {# archivo} other {# archivos}}');
    expect(issues.filter((issue) => issue.severity === 'warning')).toHaveLength(1);
    expect(issues[0]!.message).toContain('=0');
  });

  it('compares across syntaxes, because both sides are read with the parser they need', () => {
    const icu = '{count, plural, one {# file} other {# files}}';
    expect(validatePair(icu, '{count | one: # archivo | other: # archivos}')).toEqual([]);
  });

  it('accepts a correct ICU translation', () => {
    const source = '{count, plural, one {# file} other {# files}}';
    expect(validatePair(source, '{count, plural, one {# archivo} other {# archivos}}')).toEqual([]);
  });

  // a docs page that shows the syntax writes its braces as entities, so nothing here fires
  it('leaves a message that only displays the syntax alone', () => {
    const shown = 'Write &#123;count, plural, one &#123;# file&#125;&#125; and it is parsed';
    expect(validateMessage(shown, 'en')).toEqual([]);
    expect(validatePair(shown, shown)).toEqual([]);
  });
});
