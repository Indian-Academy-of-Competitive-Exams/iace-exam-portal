import { z } from 'zod';

// ============================================================================
// Canonical names for branches and groups: UPPERCASE, letters and digits,
// single-spaced. Input is NORMALISED into that form before it is validated, so a
// case- or space-different duplicate is impossible rather than merely reported.
// Only characters that cannot be tidied — punctuation, symbols — are refused.
// ============================================================================

/** What a canonical name looks like once normalised. */
export const CANONICAL_NAME_PATTERN = /^[A-Z0-9]+( [A-Z0-9]+)*$/;

/** Uppercase, collapse whitespace, trim. Shared, or the form's live preview would lie. */
export function canonicalName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

const CANONICAL_NAME_MESSAGE = 'Use capital letters, numbers and single spaces only';

/** `min`/`max` apply to the NORMALISED value, so spaces cannot smuggle a name past them. */
export function canonicalNameSchema(options: { min?: number; max: number; label: string }) {
  const { min = 2, max, label } = options;

  return z
    .string()
    .transform(canonicalName)
    .pipe(
      z
        .string()
        .min(min, `Give the ${label} a name`)
        .max(max, `A ${label} name cannot be longer than ${max} characters`)
        .regex(CANONICAL_NAME_PATTERN, CANONICAL_NAME_MESSAGE),
    );
}

export const BRANCH_NAME_MAX = 60;
export const GROUP_NAME_MAX = 80;

/** e.g. AMEERPET, RTC X ROADS, ONLINE. */
export const branchNameSchema = canonicalNameSchema({ max: BRANCH_NAME_MAX, label: 'branch' });

/** e.g. SSC CGL MORNING, RRB JE 2026 B2. */
export const groupNameSchema = canonicalNameSchema({ max: GROUP_NAME_MAX, label: 'group' });
