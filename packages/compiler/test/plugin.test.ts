import { describe, expect, it } from 'vitest';
import { stableKey } from '../src/key';
import { transformSource } from '../src/plugin';
import { MessageRegistry } from '../src/registry';

const KEY = stableKey('Hola {name}');

describe('transformSource', () => {
  it('returns the file messages as a catalog, not the analysis behind them', () => {
    const registry = new MessageRegistry();
    const { messages, result } = transformSource(
      'const s = t`Hola ${name}`;',
      'src/app.ts',
      registry,
    );
    expect(messages).toEqual({ [KEY]: 'Hola {name}' });
    expect(result?.code).toContain(JSON.stringify(KEY));
  });

  it('registers the file so the gate sees it', () => {
    const registry = new MessageRegistry();
    transformSource('const s = t`Hola ${name}`;', 'src/app.ts', registry);
    expect([...registry.messages().keys()]).toEqual([KEY]);
  });

  it('keeps the first message for a repeated explicit key, like the registry does', () => {
    const registry = new MessageRegistry();
    const code = "const a = t.id('greet')`One`;\nconst b = t.id('greet')`Two`;";
    expect(transformSource(code, 'src/app.ts', registry).messages).toEqual({ greet: 'One' });
  });

  it('returns no messages and no rewrite for a file with nothing to extract', () => {
    const registry = new MessageRegistry();
    const { messages, result } = transformSource('export const n = 1;', 'src/app.ts', registry);
    expect(messages).toEqual({});
    expect(result).toBeNull();
  });
});
