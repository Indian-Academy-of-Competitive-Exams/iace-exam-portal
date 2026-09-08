/**
 * What one sitting adds to the five aggregates, worked out without a database. The incremental
 * fold applies these as deltas; a rebuild sums the same function over every sitting and writes
 * the result outright, so a backfilled table and an accumulated one cannot disagree.
 */
import {
  scoreHistogramSchema,
  type AttemptSectionScore,
  type CohortBand,
  type EvaluationMode,
  type TestScope,
} from '@iace/contracts';
import { bandIndexOf, type ScoreCount } from './performance-analytics';

/** What `ProcessedRollup.rollupType` stores: one row per aggregate a sitting lands in. */
export const ROLLUP_TYPE = {
  STUDENT: 'student',
  STUDENT_SUBJECT: 'student_subject',
  TEST: 'test',
  TEST_SECTION: 'test_section',
  TEST_QUESTION: 'test_question',
} as const;

export type RollupType = (typeof ROLLUP_TYPE)[keyof typeof ROLLUP_TYPE];

/** The cohort's three, folded in one write: a sitting is in the distribution or in none of it. */
export const COHORT_ROLLUP_TYPES = [
  ROLLUP_TYPE.TEST,
  ROLLUP_TYPE.TEST_SECTION,
  ROLLUP_TYPE.TEST_QUESTION,
] as const;

/** The student's two, which a practice sitting feeds and the cohort's three never see. */
export const STUDENT_ROLLUP_TYPES = [ROLLUP_TYPE.STUDENT, ROLLUP_TYPE.STUDENT_SUBJECT] as const;

/** One served question, already scored. `isCorrect` is the scorer's verdict: null means untouched. */
export interface FoldableQuestion {
  paperQuestionId: string | null;
  questionId: string;
  subjectId: string | null;
  isCorrect: boolean | null;
  timeSpentSec: number;
  selectedOptionId: string | null;
}

/** An evaluated sitting with everything the fold reads, and nothing it does not. */
export interface FoldableAttempt {
  id: string;
  testId: string;
  studentId: string;
  attemptNo: number;
  isGraded: boolean;
  score: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  submittedAt: Date | null;
  evaluatedAt: Date | null;
  lastPercentile: number | null;
  scope: TestScope;
  evaluationMode: EvaluationMode;
  sections: AttemptSectionScore[];
  questions: FoldableQuestion[];
}

export interface SubjectTotals {
  subjectId: string;
  scope: TestScope;
  evaluationMode: EvaluationMode;
  attempted: number;
  correct: number;
  wrong: number;
  sumTimeSec: number;
}

export interface StudentTotals {
  testsAttempted: number;
  testsEvaluated: number;
  sumScore: number;
  sumPercentile: number;
  bestPercentile: number | null;
  totalAnswered: number;
  totalCorrect: number;
  totalWrong: number;
  totalUnattempted: number;
  sumTimeSec: number;
  practiceAttempts: number;
  lastAttemptAt: Date | null;
  computedThrough: Date | null;
  subjects: Map<string, SubjectTotals>;
}

export interface SectionTotals {
  baseConfigSectionId: string;
  attempted: number;
  sumScore: number;
  sumTimeSec: number;
}

export interface QuestionTotals {
  paperQuestionId: string;
  questionId: string;
  attemptedCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  sumTimeSec: number;
  optionCounts: Record<string, number>;
}

export interface CohortTotals {
  attempts: number;
  sumScore: number;
  maxScore: number | null;
  minScore: number | null;
  sumTimeSec: number;
  topperAttemptId: string | null;
  scores: Map<number, number>;
  sections: Map<string, SectionTotals>;
  questions: Map<string, QuestionTotals>;
}

export function emptyStudentTotals(): StudentTotals {
  return {
    testsAttempted: 0,
    testsEvaluated: 0,
    sumScore: 0,
    sumPercentile: 0,
    bestPercentile: null,
    totalAnswered: 0,
    totalCorrect: 0,
    totalWrong: 0,
    totalUnattempted: 0,
    sumTimeSec: 0,
    practiceAttempts: 0,
    lastAttemptAt: null,
    computedThrough: null,
    subjects: new Map(),
  };
}

export function emptyCohortTotals(): CohortTotals {
  return {
    attempts: 0,
    sumScore: 0,
    maxScore: null,
    minScore: null,
    sumTimeSec: 0,
    topperAttemptId: null,
    scores: new Map(),
    sections: new Map(),
    questions: new Map(),
  };
}

/** Every evaluated sitting counts here — a practice paper is still practice a student did. */
export function addToStudentTotals(totals: StudentTotals, attempt: FoldableAttempt): StudentTotals {
  totals.testsAttempted += 1;
  totals.totalCorrect += attempt.correctCount;
  totals.totalWrong += attempt.wrongCount;
  totals.totalUnattempted += attempt.unattemptedCount;
  totals.totalAnswered += attempt.correctCount + attempt.wrongCount;
  totals.sumTimeSec += timeSpentOn(attempt);
  totals.lastAttemptAt = laterOf(totals.lastAttemptAt, attempt.submittedAt);
  totals.computedThrough = laterOf(totals.computedThrough, attempt.evaluatedAt);

  if (attempt.isGraded) {
    totals.testsEvaluated += 1;
    totals.sumScore += attempt.score;
    totals.sumPercentile += attempt.lastPercentile ?? 0;
    totals.bestPercentile = higherOf(totals.bestPercentile, attempt.lastPercentile);
  } else {
    totals.practiceAttempts += 1;
  }

  for (const question of attempt.questions) {
    addToSubject(totals.subjects, attempt, question);
  }
  return totals;
}

/** Graded first sittings only: the cohort is one row per student, never per retake. */
export function addToCohortTotals(totals: CohortTotals, attempt: FoldableAttempt): CohortTotals {
  totals.attempts += 1;
  totals.sumScore += attempt.score;
  totals.sumTimeSec += timeSpentOn(attempt);
  totals.minScore =
    totals.minScore === null ? attempt.score : Math.min(totals.minScore, attempt.score);
  if (totals.maxScore === null || attempt.score > totals.maxScore) {
    totals.maxScore = attempt.score;
    totals.topperAttemptId = attempt.id;
  }
  totals.scores.set(attempt.score, (totals.scores.get(attempt.score) ?? 0) + 1);

  for (const section of attempt.sections) {
    const held = totals.sections.get(section.baseConfigSectionId) ?? {
      baseConfigSectionId: section.baseConfigSectionId,
      attempted: 0,
      sumScore: 0,
      sumTimeSec: 0,
    };
    held.attempted += 1;
    held.sumScore += section.score;
    held.sumTimeSec += section.timeSpentSec;
    totals.sections.set(section.baseConfigSectionId, held);
  }

  for (const question of attempt.questions) {
    addToQuestion(totals.questions, question);
  }
  return totals;
}

/** The distinct scores behind the curve, in the shape `cohortShapeOf` bands. */
export function scoreCountsOf(totals: CohortTotals): ScoreCount[] {
  return [...totals.scores].map(([score, count]) => ({ score, count }));
}

/** How often each question was got right, to four places. Nothing measured is not a zero. */
export function pValueOf(correctCount: number, attemptedCount: number): number | null {
  if (attemptedCount === 0) return null;
  return Math.round((correctCount / attemptedCount) * P_VALUE_STEPS) / P_VALUE_STEPS;
}

/** The `Json?` column read back. Anything that is not a curve reads as no curve at all. */
export function bandsIn(stored: unknown): CohortBand[] {
  const parsed = scoreHistogramSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/** Inside the range the bands were cut for, a count moves; outside it, every edge has to move. */
export function bandsHolding(
  bands: readonly CohortBand[],
  minScore: number | null,
  maxScore: number | null,
  score: number,
): CohortBand[] | null {
  if (bands.length === 0 || minScore === null || maxScore === null) return null;
  if (Math.floor(score) < Math.floor(minScore) || Math.ceil(score) > Math.ceil(maxScore)) {
    return null;
  }
  const index = bandIndexOf(bands, score);
  return bands.map((band, at) => (at === index ? { ...band, count: band.count + 1 } : band));
}

/** The `Json?` column read back as counts. Anything that is not a count is not one. */
export function optionCountsIn(stored: unknown): Record<string, number> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const counts: Record<string, number> = {};
  for (const [option, count] of Object.entries(stored)) {
    if (typeof count === 'number' && Number.isFinite(count)) counts[option] = count;
  }
  return counts;
}

/** The stored row plus this sitting's delta, written whole under the test's row lock. */
export function mergedQuestion(held: QuestionTotals | null, delta: QuestionTotals): QuestionTotals {
  if (held === null) return delta;
  const optionCounts = { ...held.optionCounts };
  for (const [option, count] of Object.entries(delta.optionCounts)) {
    optionCounts[option] = (optionCounts[option] ?? 0) + count;
  }
  return {
    paperQuestionId: delta.paperQuestionId,
    questionId: delta.questionId,
    attemptedCount: held.attemptedCount + delta.attemptedCount,
    correctCount: held.correctCount + delta.correctCount,
    wrongCount: held.wrongCount + delta.wrongCount,
    skippedCount: held.skippedCount + delta.skippedCount,
    sumTimeSec: held.sumTimeSec + delta.sumTimeSec,
    optionCounts,
  };
}

/** Whatever `StudentSubjectStat` is keyed by, minus the student a whole totals map already is. */
const subjectKey = (subjectId: string, scope: TestScope, mode: EvaluationMode) =>
  [subjectId, scope, mode].join('\u0000');

function addToSubject(
  subjects: Map<string, SubjectTotals>,
  attempt: FoldableAttempt,
  question: FoldableQuestion,
): void {
  if (question.subjectId === null) return;
  const key = subjectKey(question.subjectId, attempt.scope, attempt.evaluationMode);
  const held = subjects.get(key) ?? {
    subjectId: question.subjectId,
    scope: attempt.scope,
    evaluationMode: attempt.evaluationMode,
    attempted: 0,
    correct: 0,
    wrong: 0,
    sumTimeSec: 0,
  };
  held.sumTimeSec += question.timeSpentSec;
  if (question.isCorrect !== null) held.attempted += 1;
  if (question.isCorrect === true) held.correct += 1;
  if (question.isCorrect === false) held.wrong += 1;
  subjects.set(key, held);
}

/** A question nobody pinned to a paper row cannot be item-analysed: two papers are not one. */
function addToQuestion(questions: Map<string, QuestionTotals>, question: FoldableQuestion): void {
  if (question.paperQuestionId === null) return;
  const held = questions.get(question.paperQuestionId) ?? {
    paperQuestionId: question.paperQuestionId,
    questionId: question.questionId,
    attemptedCount: 0,
    correctCount: 0,
    wrongCount: 0,
    skippedCount: 0,
    sumTimeSec: 0,
    optionCounts: {},
  };
  held.sumTimeSec += question.timeSpentSec;
  if (question.isCorrect === null) held.skippedCount += 1;
  else held.attemptedCount += 1;
  if (question.isCorrect === true) held.correctCount += 1;
  if (question.isCorrect === false) held.wrongCount += 1;
  if (question.selectedOptionId !== null) {
    held.optionCounts[question.selectedOptionId] =
      (held.optionCounts[question.selectedOptionId] ?? 0) + 1;
  }
  questions.set(question.paperQuestionId, held);
}

/** The sitting's own clock, summed over what it served — sections may not cover every question. */
function timeSpentOn(attempt: FoldableAttempt): number {
  return attempt.questions.reduce((total, question) => total + question.timeSpentSec, 0);
}

/** The later of two instants, either of which may be missing. */
export function laterOf(held: Date | null, found: Date | null): Date | null {
  if (found === null) return held;
  return held === null || found > held ? found : held;
}

/** The higher of two numbers, either of which may be missing. */
export function higherOf(held: number | null, found: number | null): number | null {
  if (found === null) return held;
  return held === null || found > held ? found : held;
}

/** `Decimal(5,4)`, so a p-value is stored to the place the column keeps. */
const P_VALUE_STEPS = 10_000;
