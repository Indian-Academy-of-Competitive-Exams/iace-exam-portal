/**
 * What one sitting adds to the five aggregates, worked out without a database. The scorer applies
 * the student's two as a delta with the marks; the cohort's three are summed over every sitting by
 * the pass that recounts them, so an accumulated table and a recounted one cannot disagree.
 */
import { type Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, type TestScope } from '@iace/contracts';

/** The sittings a test's cohort rollups describe: `Attempt_graded_per_test_key` makes these one per student. */
export const cohortSittingsOf = (testId: string) =>
  ({ testId, status: ATTEMPT_STATUS.EVALUATED, isGraded: true }) satisfies Prisma.AttemptWhereInput;

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
  studentId: string;
  isGraded: boolean;
  score: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  submittedAt: Date | null;
  scope: TestScope;
  questions: FoldableQuestion[];
}

export interface SubjectTotals {
  subjectId: string;
  scope: TestScope;
  attempted: number;
  correct: number;
  sumTimeSec: number;
}

export interface StudentTotals {
  testsEvaluated: number;
  sumScore: number;
  totalCorrect: number;
  totalWrong: number;
  totalUnattempted: number;
  sumTimeSec: number;
  retakeCount: number;
  lastAttemptAt: Date | null;
  subjects: Map<string, SubjectTotals>;
}

export interface QuestionTotals {
  paperQuestionId: string;
  questionId: string;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  sumTimeSec: number;
  optionCounts: Record<string, number>;
}

export function emptyStudentTotals(): StudentTotals {
  return {
    testsEvaluated: 0,
    sumScore: 0,
    totalCorrect: 0,
    totalWrong: 0,
    totalUnattempted: 0,
    sumTimeSec: 0,
    retakeCount: 0,
    lastAttemptAt: null,
    subjects: new Map(),
  };
}

/** Every evaluated sitting counts here — a retake is still work a student did. */
export function addToStudentTotals(totals: StudentTotals, attempt: FoldableAttempt): StudentTotals {
  totals.totalCorrect += attempt.correctCount;
  totals.totalWrong += attempt.wrongCount;
  totals.totalUnattempted += attempt.unattemptedCount;
  totals.sumTimeSec += timeSpentOn(attempt);
  totals.lastAttemptAt = maxOf(totals.lastAttemptAt, attempt.submittedAt);

  if (attempt.isGraded) {
    totals.testsEvaluated += 1;
    totals.sumScore += attempt.score;
  } else {
    totals.retakeCount += 1;
  }

  for (const question of attempt.questions) {
    addToSubject(totals.subjects, attempt, question);
  }
  return totals;
}

/** Right over answered, to four places. Nothing measured is not a zero. */
export function pValueOf(correctCount: number, wrongCount: number): number | null {
  const answered = correctCount + wrongCount;
  if (answered === 0) return null;
  return Math.round((correctCount / answered) * P_VALUE_STEPS) / P_VALUE_STEPS;
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

/** Whatever `StudentSubjectStat` is keyed by, minus the student a whole totals map already is. */
const subjectKey = (subjectId: string, scope: TestScope) => [subjectId, scope].join('\u0000');

function addToSubject(
  subjects: Map<string, SubjectTotals>,
  attempt: FoldableAttempt,
  question: FoldableQuestion,
): void {
  if (question.subjectId === null) return;
  const key = subjectKey(question.subjectId, attempt.scope);
  const held = subjects.get(key) ?? {
    subjectId: question.subjectId,
    scope: attempt.scope,
    attempted: 0,
    correct: 0,
    sumTimeSec: 0,
  };
  held.sumTimeSec += question.timeSpentSec;
  if (question.isCorrect !== null) held.attempted += 1;
  if (question.isCorrect === true) held.correct += 1;
  subjects.set(key, held);
}

/** A question nobody pinned to a paper row cannot be item-analysed: two papers are not one. */
export function addToQuestion(
  questions: Map<string, QuestionTotals>,
  question: FoldableQuestion,
): void {
  if (question.paperQuestionId === null) return;
  const held = questions.get(question.paperQuestionId) ?? {
    paperQuestionId: question.paperQuestionId,
    questionId: question.questionId,
    correctCount: 0,
    wrongCount: 0,
    skippedCount: 0,
    sumTimeSec: 0,
    optionCounts: {},
  };
  held.sumTimeSec += question.timeSpentSec;
  if (question.isCorrect === null) held.skippedCount += 1;
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

/** The later instant or the higher number of two, either of which may be missing. */
export function maxOf<T extends number | Date>(held: T | null, found: T | null): T | null {
  if (found === null) return held;
  return held === null || found > held ? found : held;
}

const P_VALUE_STEPS = 10_000;
