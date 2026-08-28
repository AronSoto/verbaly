import { relativeTimeFormat } from './intl';
import type { Formatter } from './types';
import { warnOnce } from './warn';

// seconds per unit, largest first (auto pick)
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

// the type and never the value (the warn set must stay bounded); only number|Date reaches here
function describe(value: unknown): string {
  if (!(value instanceof Date)) return `a ${typeof value}`;
  return Number.isNaN(value.getTime()) ? 'an invalid Date' : 'a Date';
}

// the one format that ships only where a message asks for it: it is 318 B and most apps never do
export const relativeFormatter: Formatter = (value, locale, arg, info) => {
  const where = info?.key ? ` in "${info.key}"` : '';
  const degrade = (problem: string): string => {
    warnOnce(`{${info?.param ?? '…'}:relative}${where} ${problem}`);
    return String(value);
  };

  if (typeof value === 'number' && !arg) return degrade('needs an argument like /day');
  if (typeof value !== 'number' && !(value instanceof Date)) {
    return degrade('needs a number or a Date');
  }

  try {
    const fmt = relativeTimeFormat(locale);
    if (typeof value === 'number') return fmt.format(value, arg as Intl.RelativeTimeFormatUnit);
    const diffSec = (value.getTime() - Date.now()) / 1000;
    if (arg) {
      const per = REL_UNITS.find(([unit]) => unit === arg)?.[1];
      if (!per) throw new RangeError(arg);
      return fmt.format(Math.round(diffSec / per), arg as Intl.RelativeTimeFormatUnit);
    }
    const [unit, per] = REL_UNITS.find(([, s]) => Math.abs(diffSec) >= s) ?? ['second', 1];
    return fmt.format(Math.round(diffSec / per), unit);
  } catch {
    // an invalid Date lands here too, so the warn names both suspects instead of blaming the unit
    return degrade(`cannot format ${describe(value)} as "${arg}"`);
  }
};
