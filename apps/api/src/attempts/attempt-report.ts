/** What a finished sitting is worth to the student who sat it, worked out without a database. */
import { type Prisma } from '@prisma/client';
import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  round2,
  type AttemptSectionScore,
  type AttemptStatus,
  type ScoreCardQuestion,
  type ScoreCardSection,
} from '@iace/contracts';
import { MS_PER_SECOND } from '../common/time/units';

export const NOT_YOURS = 'No such sitting';

/** Why a sitting that is not marked has no result to read: set aside for good, or only not marked yet. */
export function noResultFor(status: AttemptStatus, notMarkedYet: string): AppException {
  return status === ATTEMPT_STATUS.VOIDED
    ? new AppException(ErrorCodes.SITTING_VOIDED)
    : new AppException(ErrorCodes.CONFLICT, notMarkedYet);
}

/** A `Decimal?` column on its way into JSON. Never let the Decimal itself reach a payload. */
export const numberOrNull = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

/** A section as the blueprint describes it, before this student's marks are laid over it. */
export interface SectionShape {
  id: string;
  name: string;
  order: number;
  questionCount: number;
  marksPerQuestion: number;
}

/** What each section of the sat paper was worth, summed off the rows the student was served. */
export function marksBySection(
  questions: readonly { baseConfigSectionId: string; marks: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of questions) {
    totals.set(row.baseConfigSectionId, (totals.get(row.baseConfigSectionId) ?? 0) + row.marks);
  }
  return totals;
}

/** The one piece of clock arithmetic a sitting needs; what an unfinished one means is per caller. */
export function elapsedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_SECOND));
}

/** Marks over what the paper was worth. Negative when negative marking took them under. */
export function percentageOf(score: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0;
  return round2((score / maxMarks) * 100);
}

/** The blueprint's sections with this sitting's marks laid over them, in the paper's own order. */
export function sectionsWithScores(
  shape: readonly SectionShape[],
  scored: readonly AttemptSectionScore[] | null,
  paperMarks: ReadonlyMap<string, number>,
): ScoreCardSection[] {
  const byId = new Map((scored ?? []).map((section) => [section.baseConfigSectionId, section]));

  return [...shape]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      baseConfigSectionId: section.id,
      name: section.name,
      order: section.order,
      questionCount: section.questionCount,
      // The paper's own marks, not the blueprint's: a per-question mark makes the two differ.
      maxMarks: round2(
        paperMarks.get(section.id) ?? section.questionCount * section.marksPerQuestion,
      ),
      score: byId.get(section.id)?.score ?? 0,
      correctCount: byId.get(section.id)?.correctCount ?? 0,
      wrongCount: byId.get(section.id)?.wrongCount ?? 0,
      unattemptedCount: byId.get(section.id)?.unattemptedCount ?? section.questionCount,
      timeSpentSec: byId.get(section.id)?.timeSpentSec ?? 0,
    }));
}

/** Nothing counted is not a zero: an average over no sittings is a dash, never a nought. */
export const perSitting = (total: number, sittings: number): number | null =>
  sittings === 0 ? null : round2(total / sittings);

export function toScoreCardQuestion(
  row: Omit<ScoreCardQuestion, 'marks' | 'negativeMarks' | 'disposition'> & {
    marks: Prisma.Decimal;
    negativeMarks: Prisma.Decimal;
    status: ScoreCardQuestion['disposition'];
  },
): ScoreCardQuestion {
  return {
    questionId: row.questionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    state: row.state,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    isCorrect: row.isCorrect,
    marksAwarded: row.marksAwarded,
    marks: Number(row.marks),
    negativeMarks: Number(row.negativeMarks),
    disposition: row.status,
    timeSpentSec: row.timeSpentSec,
  };
}

/** Which refusal an unreadable sitting is: not theirs, or theirs and not marked. Asked only once the cheap read has failed. */
export async function refuseUnreadable(
  db: Prisma.TransactionClient,
  studentId: string,
  attemptId: string,
  notMarkedYet: string,
): Promise<never> {
  const theirs = await db.attempt.findFirst({
    where: { id: attemptId, studentId },
    select: { status: true },
  });
  if (theirs === null) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
  throw noResultFor(theirs.status, notMarkedYet);
}
