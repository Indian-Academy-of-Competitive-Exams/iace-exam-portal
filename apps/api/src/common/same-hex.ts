import { timingSafeEqual } from 'node:crypto';

/** Constant-time, so how much of a guessed digest matched never shows in the response time. */
export function sameHex(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
