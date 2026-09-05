import i18next from 'i18next';
import { Bench } from 'tinybench';
import { test } from 'vitest';
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

const cases: Array<[string, () => void, () => void]> = [
  ['plain lookup', () => void v.t('plain'), () => void i18next.t('plain')],
  [
    'interpolation (2 params)',
    () => void v.t('param', { name: 'Aron', count: 3 }),
    () => void i18next.t('param', { name: 'Aron', count: 3 }),
  ],
  [
    'plural',
    () => void v.t('plural', { count: 3 }),
    () => void i18next.t('plural', { count: 3 }),
  ],
  [
    'currency format',
    () => void v.t('money', { total: 1234.5 }),
    () => void i18next.t('money', { total: 1234.5 }),
  ],
];

// vitest 5 dropped its bench runner, so this drives tinybench (what vitest ran under) itself
test('verbaly against i18next', async () => {
  for (const [name, ours, theirs] of cases) {
    const bench = new Bench({ time: 500 });
    bench.add('verbaly', ours).add('i18next', theirs);
    await bench.run();
    const [a, b] = bench.tasks.map((task) => task.result!.throughput.mean);
    const ops = bench.tasks
      .map((task) => `${task.name} ${Math.round(task.result!.throughput.mean)} ops/s`)
      .join('  |  ');
    console.log(`${name.padEnd(26)} ${ops}  ${(a! / b!).toFixed(1)}x`);
  }
});
