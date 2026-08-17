import { PIN_LENGTH } from '@iace/contracts';

/**
 * The PIN a bulk-imported student starts with: the first four digits of their own mobile.
 * GUESSABLE by anyone holding the roster — a deliberate trade so a batch uploaded on
 * Monday can sign in on Monday. `pinIsDefault` forces the replacement.
 */
export function defaultPinFor(mobile: string): string {
  return mobile.slice(0, PIN_LENGTH);
}
