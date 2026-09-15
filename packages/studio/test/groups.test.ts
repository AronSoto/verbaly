import { describe, expect, it } from 'vitest';
import { groupOf, groups, search, toPanel, visible } from '../src/ui/model';

const panel = toPanel({
  root: '/app',
  dir: '/app/locales',
  sourceLocale: 'en',
  locales: ['en', 'es'],
  scanning: true,
  catalogs: {
    en: {
      nav: { home: 'Home', account: 'My account' },
      cart: { empty: 'Empty', total: 'Total {amount}' },
      standalone: 'No group at all',
    },
    es: {
      nav: { home: 'Inicio', account: 'Mi cuenta' },
      cart: { empty: '', total: 'Total' },
      standalone: 'Sin grupo',
    },
  },
  origins: {},
  drafts: { es: ['nav.account'] },
  triage: {},
  check: { broken: [{ locale: 'es', key: 'cart.total', severity: 'error', issue: 'lost {amount}' }] },
  problems: [],
});

describe('the group of a key', () => {
  // Proved able to fail by splitting on the underscore: docs_cli would collapse into docs.
  it('is the first segment, which is the unit bundle.exclude already matches', () => {
    expect(groupOf('docs_cli.th_flag')).toBe('docs_cli');
    expect(groupOf('changelog_rel.v0_43_0.h2')).toBe('changelog_rel');
  });

  it('is nothing when the key has no separator, because a guess would be worse', () => {
    expect(groupOf('options_title')).toBeNull();
    expect(groupOf('standalone')).toBeNull();
    expect(groupOf('.leading')).toBeNull();
  });
});

describe('the groups of a catalog', () => {
  it('counts every group and leaves ungrouped keys out of the list', () => {
    const out = groups(panel.rows, ['es']);
    expect(out.map((g) => g.name)).toEqual(['cart', 'nav']);
    expect(out.find((g) => g.name === 'cart')!.total).toBe(2);
  });

  // Proved able to fail by counting every locale: an unticked language would inflate the numbers.
  it('counts problems only in the languages you ticked', () => {
    const [cart] = groups(panel.rows, ['es']);
    expect(cart!.broken).toBe(1);
    expect(cart!.missing).toBe(1);
    expect(groups(panel.rows, [])[0]!.broken).toBe(0);
  });

  it('reports the unread ones, which is what sends you to a group in the first place', () => {
    expect(groups(panel.rows, ['es']).find((g) => g.name === 'nav')!.draft).toBe(1);
  });
});

describe('filtering and searching by group', () => {
  // Proved able to fail by dropping the group clause: every row comes back.
  it('narrows the table to one group', () => {
    const rows = visible(panel.rows, { text: '', state: 'all', locales: ['es'], group: 'nav' });
    expect(rows.map((r) => r.key)).toEqual(['nav.home', 'nav.account']);
  });

  it('leaves the table whole when no group is asked for', () => {
    expect(visible(panel.rows, { text: '', state: 'all', locales: ['es'] })).toHaveLength(5);
  });

  it('carries the group on a search hit, so a result says where it lives', () => {
    expect(search(panel, 'Inicio')[0]!.group).toBe('nav');
    expect(search(panel, 'Sin grupo')[0]!.group).toBeNull();
  });
});
