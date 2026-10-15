import { z } from 'zod';
import { examSectionSchema, scoreCardQuestionSchema } from './attempts';
import { round2 } from './stats';

// ============================================================================
// The Question Report — one row per served question, the student's own beside
// the cohort's. Two halves with different rules: the cohort's item-stats read
// as null until a rollup has counted the question, while the key is on every
// marked read — nothing gates it by time.
// ============================================================================

/** How hard the cohort ACTUALLY found a question, as opposed to how hard it was authored. */
export const optionShareSchema = z.object({
  optionId: z.string(),
  /** Its place on the paper, so a screen can say "C" without loading the question. */
  position: z.number().int(),
  count: z.number().int(),
  isCorrect: z.boolean(),
});
export type OptionShare = z.infer<typeof optionShareSchema>;

/** One served question: what this student did with it, and what the cohort did with it. */
const questionReportRowSchema = scoreCardQuestionSchema.extend({
  paperQuestionId: z.string().nullable(),
  /** Seconds from first seeing it to answering it. Null where it was never answered, or never measured. */
  timeToRespondSec: z.number().int().nullable(),
  // -------------------------------------------------------------------------
  // The cohort's, straight off the rollup. Every one of these is null until a
  // `TestQuestionStat` row exists — a dash on the screen, never a live count.
  // -------------------------------------------------------------------------
  /** Of the sittings served this question, the fraction that answered it. */
  attemptRate: z.number().nullable(),
  /** Of those who answered it, the fraction that got it right. */
  accuracy: z.number().nullable(),
  cohortAverageTimeSec: z.number().nullable(),
  topperTimeSec: z.number().int().nullable(),
  topperMarksAwarded: z.number().nullable(),
  // -------------------------------------------------------------------------
  // The key, read with the sheet's rows in one query and present on every
  // marked read; only the option COUNTS wait on a rollup.
  // -------------------------------------------------------------------------
  optionCounts: z.array(optionShareSchema),
  correctOptionId: z.string().nullable(),
  /** What a typed answer was compared against. Null for anything with options. */
  correctAnswer: z.string().nullable(),
});
export type QuestionReportRow = z.infer<typeof questionReportRowSchema>;

/** Above this share of the field answering it, a question the reader left blank was answerable. */
const MOST_OF_THE_FIELD = 0.5;

/** What one paper says about how it was WORKED, as opposed to how much of it was known. */
interface QuestionReportInsights {
  /** Left blank while most of the field answered — the questions nerve or the clock cost. */
  blankButAnswerable: number;
  timeOnCorrectSec: number;
  timeOnWrongSec: number;
  timeOnBlankSec: number;
  /** Of the whole clock, the share that bought no marks at all. */
  wastedShare: number | null;
}

export function questionReportInsights(rows: readonly QuestionReportRow[]): QuestionReportInsights {
  let blankButAnswerable = 0;
  let timeOnCorrectSec = 0;
  let timeOnWrongSec = 0;
  let timeOnBlankSec = 0;

  for (const row of rows) {
    if (row.isCorrect === true) timeOnCorrectSec += row.timeSpentSec;
    else if (row.isCorrect === false) timeOnWrongSec += row.timeSpentSec;
    else {
      timeOnBlankSec += row.timeSpentSec;
      if (row.attemptRate !== null && row.attemptRate >= MOST_OF_THE_FIELD) blankButAnswerable += 1;
    }
  }

  const total = timeOnCorrectSec + timeOnWrongSec + timeOnBlankSec;
  return {
    blankButAnswerable,
    timeOnCorrectSec,
    timeOnWrongSec,
    timeOnBlankSec,
    wastedShare: total === 0 ? null : round2(((timeOnWrongSec + timeOnBlankSec) / total) * 100),
  };
}

type CountedOption = QuestionReportRow['optionCounts'][number];

/** The option most of the field chose. Null where nothing was counted at all. */
export function distractorThatWon(
  row: Pick<QuestionReportRow, 'optionCounts'>,
): CountedOption | null {
  const top = row.optionCounts.reduce<CountedOption | null>(
    (best, option) => (best === null || option.count > best.count ? option : best),
    null,
  );
  return top === null || top.count === 0 ? null : top;
}

/** Below this the cohort IS the reader: "100% got it right" beside their own right answer. */
export const COHORT_COMPARISON_FLOOR = 10;

/** How often the per-question cohort columns are counted. Read by the pass AND by what it tells them. */
export const COHORT_COUNT_EVERY_MIN = 15;

export const questionReportSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  /** Ranked sittings on the paper, whether or not they are enough to compare against. */
  cohortSize: z.number().int(),
  /** This paper's time against the cohort's average: above 1 is slower, below 1 is faster. */
  paceIndex: z.number().nullable(),
  sections: z.array(examSectionSchema),
  questions: z.array(questionReportRowSchema),
});
export type QuestionReport = z.infer<typeof questionReportSchema>;

/** What the client filters the table by. The rows are all there; this only hides some. */
export const QUESTION_FILTERS = {
  ALL: 'all',
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  UNATTEMPTED: 'unattempted',
} as const;
export const questionFilterSchema = z.enum(QUESTION_FILTERS);
export type QuestionFilter = z.infer<typeof questionFilterSchema>;
