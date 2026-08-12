import { z } from 'zod';

// ============================================================================
// Canonical names for branches and groups.
//
// These two lists are the vocabulary the whole platform routes access through,
// and they are typed by hand, by different people, over years. Left free, they
// drift: "SSC CGL Morning", "ssc cgl morning", "SSC  CGL Morning" and "SSC CGL
// MORNING " are four rows that mean one thing, and a uniqueness check catches
// none of them.
//
// So a name has exactly one canonical form — UPPERCASE, letters and digits,
// single-spaced — and input is NORMALISED into it before it is validated. What
// the admin types is tidied; only characters that cannot be tidied (punctuation,
// symbols) are refused, with a message that says so.
//
// Normalising rather than rejecting is deliberate: rejecting "ssc cgl morning"
// teaches the admin to shout, but it does not stop the person who shouts a
// different way. Folding every spelling to one makes the duplicate impossible
// instead of merely reported.
// ============================================================================

/** What a canonical name looks like once normalised. */
export const CANONICAL_NAME_PATTERN = /^[A-Z0-9]+( [A-Z0-9]+)*$/;

/**
 * Uppercase, collapse every run of whitespace to one space, and trim.
 *
 * Exported because the API normalises on the way in and the admin form shows
 * the result as you type — both must agree exactly, or the preview lies.
 */
export function canonicalName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

const CANONICAL_NAME_MESSAGE = 'Use capital letters, numbers and single spaces only';

/**
 * A canonical name schema. `min`/`max` are on the NORMALISED value, so trailing
 * spaces can never smuggle a name past the length rule.
 */
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

/** e.g. AMEERPET, RTC X ROADS, GLOBAL. */
export const branchNameSchema = canonicalNameSchema({ max: BRANCH_NAME_MAX, label: 'branch' });

/** e.g. SSC CGL MORNING, RRB JE 2026 B2. */
export const groupNameSchema = canonicalNameSchema({ max: GROUP_NAME_MAX, label: 'group' });

/**
 * The name of the seeded cross-branch branch.
 *
 * Code identifies it by `Branch.isGlobal`, never by this string — this exists
 * so the seed and its tests spell it one way.
 */
export const GLOBAL_BRANCH_NAME = 'GLOBAL';
