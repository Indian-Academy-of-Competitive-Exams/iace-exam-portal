import {
  LANGUAGE_MODE,
  TEST_STATUS,
  type LanguageCode,
  type LanguageMode,
  type TestStatus,
} from '@iace/contracts';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

/** The rules that decide whether a sitting may begin — pure, so no database is needed to test them. */

export const TEST_NOT_OFFERED_MESSAGE =
  'This test is not being offered right now. Ask your branch if you think that is wrong.';

export const PAPER_NOT_READY_MESSAGE =
  'This test has not been finalized yet, so it has no paper to sit.';

/** What stops a test being sat at all, whatever the student's access says. */
export function testStartBlocker(test: { status: TestStatus; isLocked: boolean }): string | null {
  if (test.status !== TEST_STATUS.ACTIVE) return TEST_NOT_OFFERED_MESSAGE;
  // The freeze is what wrote the papers, one for a fixed test and one per variant for a generated one.
  if (!test.isLocked) return PAPER_NOT_READY_MESSAGE;
  return null;
}

/** Null `maxRetakes` is unlimited, and the first sitting is never a retake. */
export function retakeBlocker(maxRetakes: number | null, finishedAttempts: number): string | null {
  if (maxRetakes === null || finishedAttempts < maxRetakes) return null;
  const sittings = finishedAttempts === 1 ? 'once' : `${finishedAttempts} times`;
  return `You have already sat this test ${sittings}, which is all it allows.`;
}

/** DUAL sits every language offered; SINGLE the one picked, narrowed to what actually exists. */
export function languagesFor(
  mode: LanguageMode,
  offered: readonly LanguageCode[],
  picked: readonly LanguageCode[] | undefined,
): LanguageCode[] {
  if (mode === LANGUAGE_MODE.DUAL) return [...offered];
  const wanted = (picked ?? []).filter((language) => offered.includes(language));
  return wanted.length > 0 ? [wanted[0]!] : offered.slice(0, 1);
}

/** The order THIS student sees: sections in the config's order, shuffled within each one. */
export function displayOrder<T extends { baseConfigSectionId: string }>(
  paper: readonly T[],
  seed: number,
  shuffleQuestions: boolean,
): T[] {
  if (!shuffleQuestions) return [...paper];

  const random = seededRandom(seed);
  const bySection = new Map<string, T[]>();
  for (const row of paper) {
    const held = bySection.get(row.baseConfigSectionId);
    if (held) held.push(row);
    else bySection.set(row.baseConfigSectionId, [row]);
  }
  return [...bySection.values()].flatMap((rows) => shuffle(rows, random));
}

/** The deadline is the server's, computed once at start and never recomputed. */
export function deadlineFrom(startedAt: Date, durationSec: number): Date {
  return new Date(startedAt.getTime() + durationSec * MILLISECONDS_PER_SECOND);
}

const MILLISECONDS_PER_SECOND = 1000;
