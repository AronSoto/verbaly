import i18next from 'i18next';
import { bench, describe } from 'vitest';
import { createVerbaly } from '../src/instance';

const v = createVerbaly({
  locale: 'en',
  messages: {
    en: {
      plain: 'Hello world',
      param: 'Hello {name}, you have {count} messages',
      plural: '{count | one: one message | other: # messages}',
      money: 'Total: {total:currency/USD}',
    },
  },
});

await i18next.init({
  lng: 'en',
  initImmediate: false,
  resources: {
    en: {
      translation: {
        plain: 'Hello world',
        param: 'Hello {{name}}, you have {{count}} messages',
        plural_one: 'one message',
        plural_other: '{{count}} messages',
        money: 'Total: {{total, currency(USD)}}',
      },
    },
  },
});

describe('plain lookup', () => {
  bench('verbaly', () => {
    v.t('plain');
  });
  bench('i18next', () => {
    i18next.t('plain');
  });
});

describe('interpolation (2 params)', () => {
  bench('verbaly', () => {
    v.t('param', { name: 'Aron', count: 3 });
  });
  bench('i18next', () => {
    i18next.t('param', { name: 'Aron', count: 3 });
  });
});

describe('plural', () => {
  bench('verbaly', () => {
    v.t('plural', { count: 3 });
  });
  bench('i18next', () => {
    i18next.t('plural', { count: 3 });
  });
});

describe('currency format', () => {
  bench('verbaly', () => {
    v.t('money', { total: 1234.5 });
  });
  bench('i18next', () => {
    i18next.t('money', { total: 1234.5 });
  });
});
