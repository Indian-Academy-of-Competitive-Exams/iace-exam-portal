import { PIN_LENGTH } from '@iace/contracts';

/**
 * The PIN a bulk-imported student starts with: the first four digits of their
 * own mobile number.
 *
 * This is a deliberate trade, and worth naming plainly. It is GUESSABLE — the
 * number is on the roster, and anyone holding that roster can derive the PIN
 * for everyone on it. What it buys is that a batch of 400 students uploaded on
 * Monday can sign in on Monday, without the institute distributing 400 codes.
 *
 * The trade is only acceptable because the PIN is marked as ours rather than
 * theirs (`Student.pinIsDefault`), which keeps three things true:
 *
 *   - the roster still shows who has never chosen a PIN, so "signed in" does
 *     not silently become "was imported";
 *   - the student can be prompted to replace it;
 *   - a student who sets their own PIN clears the flag and never sees it again.
 *
 * TODO(test-portal): prompt for a replacement at first sign-in while this flag
 * is set, and refuse to start a test until it has been changed.
 */
export function defaultPinFor(mobile: string): string {
  return mobile.slice(0, PIN_LENGTH);
}
