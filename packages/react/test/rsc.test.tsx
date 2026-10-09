import * as React from 'react';
import { createVerbaly } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { Trans } from '../src/server';

describe('@verbaly/react/server under the React a Server Component gets', () => {
  it('runs on the react-server build, the premise every test below stands on', () => {
    expect((React as Record<string, unknown>).createContext).toBeUndefined();
  });

  it('loads and renders a Trans there, where the client entry cannot even load', async () => {
    const instance = createVerbaly({ locale: 'es', messages: { es: { m: 'Hola <b>mundo</b>' } } });
    const element = Trans({ id: 'm', instance });
    expect(React.isValidElement(element)).toBe(true);
    await expect(import('../src/index')).rejects.toThrow();
  });
});
