import { z } from 'zod';

// ============================================================================
// Canonical names for branches and exam codes: UPPERCASE, letters and digits,
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

/** e.g. AMEERPET, RTC X ROADS, ONLINE. */
export const branchNameSchema = canonicalNameSchema({ max: BRANCH_NAME_MAX, label: 'branch' });

// ============================================================================
// Suggested names for tests and series. A name here is NOT a canonical name:
// it is mixed case and carries punctuation, so none of the rules above apply.
// The shape is `Lead words — Kind NN`, and the number is what keeps one course
// of names apart. Offered to the admin only; nothing on the server enforces it.
// ============================================================================

const NAME_PART_SEPARATOR = ' — ';
const NAME_NUMBER_PAD = 2;

const NAME_SEPARATORS = /[^a-z0-9]+/g;
const PATTERN_MARKERS = ['(official pattern)', '— official pattern'] as const;

/** A blueprint is the official pattern; a test drawn from one is not, so a name it leads drops it. */
function withoutMarker(value: string): string {
  const lower = value.toLowerCase();
  const marker = PATTERN_MARKERS.find((candidate) => lower.endsWith(candidate));
  return marker === undefined ? value : value.slice(0, -marker.length).trim();
}

/** Separator-blind, so SSC_CGL and SSC CGL come apart into the same two words. */
function words(value: string): string[] {
  return value.toLowerCase().replace(NAME_SEPARATORS, ' ').trim().split(' ').filter(Boolean);
}

/** Already said if every word of it turns up in the other, whatever that one puts between them. */
function saidWithin(part: string, whole: string): boolean {
  const seen = new Set(words(whole));
  return words(part).every((word) => seen.has(word));
}

/** Everything a name says before its number, saying nothing twice: a config may carry the stage. */
export function nameStem(lead: readonly (string | null | undefined)[], kind: string): string {
  const head = lead.reduce<string>((said, part) => {
    const next = withoutMarker(part?.trim() ?? '');
    if (next === '' || said === '') return said || next;
    // A config named after its own exam and stage swallows them, so its spelling wins a tie.
    if (saidWithin(said, next)) return next;
    if (saidWithin(next, said)) return said;
    return `${said} ${next}`;
  }, '');
  return head === '' ? kind : head + NAME_PART_SEPARATOR + kind;
}

function numbered(stem: string, position: number): string {
  return `${stem} ${String(position).padStart(NAME_NUMBER_PAD, '0')}`;
}

/** The highest number already used under this stem, or 0 when nothing sits under it yet. */
function highestUnder(stem: string, taken: readonly string[]): number {
  let highest = 0;
  for (const name of taken) {
    const rest = name.trim().startsWith(stem) ? name.trim().slice(stem.length).trim() : '';
    const position = /^\d+$/.test(rest) ? Number(rest) : 0;
    if (position > highest) highest = position;
  }
  return highest;
}

/** A test is one of a run, so it is numbered from the very first one. */
export function suggestedTestName(stem: string, taken: readonly string[]): string {
  return numbered(stem, highestUnder(stem, taken) + 1);
}

/** A series is usually alone under its stem, so it takes a number only once it needs one. */
export function suggestedSeriesName(stem: string, taken: readonly string[]): string {
  if (!taken.some((name) => name.trim() === stem)) return stem;
  return numbered(stem, Math.max(highestUnder(stem, taken), 1) + 1);
}
