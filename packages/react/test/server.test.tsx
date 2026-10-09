import { renderToStaticMarkup } from 'react-dom/server';
import { createVerbaly } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { useT } from '../src/index';
import { renderTrans, Trans } from '../src/server';

function makeInstance() {
  return createVerbaly({
    locale: 'es',
    messages: {
      es: { agree: 'Lee los <terms>términos</terms>, {name}', bold: 'a <b>b</b><br/>c' },
    },
  });
}

describe('@verbaly/react/server, the entry a Server Component imports', () => {
  it('renders a Trans from its instance, outside any React render', () => {
    // called as a plain function: a hook in there would throw, a context would be empty
    const element = Trans({
      id: 'agree',
      values: { name: 'Ana' },
      components: { terms: <a href="/terms" /> },
      instance: makeInstance(),
    });
    expect(renderToStaticMarkup(element)).toBe('Lee los <a href="/terms">términos</a>, Ana');
  });

  it('keeps the contract of the client Trans: whitelisted tags and void tags', () => {
    expect(renderToStaticMarkup(renderTrans(makeInstance(), { id: 'bold' }))).toBe(
      'a <b>b</b><br/>c',
    );
  });
});

describe('a hook rendered on a server with no provider above it', () => {
  // Proved able to fail by dropping the document guard: the server rendered the app's language.
  it('never reads the app instance, which belongs to no request', () => {
    const APP = Symbol.for('verbaly.app');
    (globalThis as Record<symbol, unknown>)[APP] = makeInstance();
    function Hello() {
      return <p>{useT()('agree' as never)}</p>;
    }
    try {
      expect(() => renderToStaticMarkup(<Hello />)).toThrow(/requires a <VerbalyProvider>/);
    } finally {
      delete (globalThis as Record<symbol, unknown>)[APP];
    }
  });
});

describe('the children form the README teaches', () => {
  it('type checks in TSX and, never compiled, renders its children as written', () => {
    const element = renderTrans(makeInstance(), {
      children: (
        <>
          Read the <a href="/terms">terms</a>
        </>
      ),
    });
    expect(renderToStaticMarkup(element)).toBe('Read the <a href="/terms">terms</a>');
  });
});
