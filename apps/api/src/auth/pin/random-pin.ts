/**
 * The PIN a roster import issues. Four digits is 10,000 candidates, so the only
 * thing between a leaked roster and the accounts on it is that this number was
 * derived from nothing — least of all from the mobile it is sent to.
 */
import { randomBytes } from 'node:crypto';
import { PIN_LENGTH } from '@iace/contracts';

/** 250, not 256: 250..255 would fold onto 0..5 and make the low digits likelier. */
const UNBIASED_CEILING = 250;

export function randomPin(length: number = PIN_LENGTH): string {
  const digits: number[] = [];

  while (digits.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= UNBIASED_CEILING) continue;
      digits.push(byte % 10);
      if (digits.length === length) break;
    }
  }

  return digits.join('');
}
