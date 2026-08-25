/**
 * Numbers typed into a form. A control holds a string, so every numeric field has three
 * answers — blank, a number, and characters that are neither — and the third is the one
 * a screen has to notice: read as blank it becomes "unlimited" or zero without a word.
 */

/** Blank, or anything that is not a finite number, is "not set" — `isNotNumeric` tells them apart. */
export function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  return trimmed === '' || !Number.isFinite(value) ? null : value;
}

/** For a field whose blank has a meaning of its own, like a count that starts at zero. */
export function numberOr(raw: string, fallback: number): number {
  return optionalNumber(raw) ?? fallback;
}

/** Typed, and not a number: the one answer a form refuses rather than reads as blank. */
export function isNotNumeric(raw: string): boolean {
  return raw.trim() !== '' && optionalNumber(raw) === null;
}
