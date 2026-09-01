/**
 * The paper's topper, read for their CLOCK. `TestStat.topperAttemptId` already names them, so this
 * is one read per report rather than one per row — and its select carries time, marks and sections
 * and nothing else. A topper is right more often than not, so their answers would be a key.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sectionScoresIn } from './score-paper';

/** No `questionVersion`, no `selectedOptionId`: nothing here says what the right answer was. */
const TOPPER_SELECT = {
  id: true,
  score: true,
  sectionScores: true,
  questions: {
    select: {
      paperQuestionId: true,
      questionId: true,
      baseConfigSectionId: true,
      marksAwarded: true,
      timeSpentSec: true,
    },
  },
} as const satisfies Prisma.AttemptSelect;

export interface TopperQuestion {
  timeSpentSec: number;
  marksAwarded: number | null;
}

/** What the topper spent, keyed the two ways a report needs it. Empty when no rollup names one. */
export interface TopperTimes {
  attemptId: string | null;
  score: number | null;
  byPaperQuestion: ReadonlyMap<string, TopperQuestion>;
  bySection: ReadonlyMap<string, number>;
}

export const NO_TOPPER: TopperTimes = {
  attemptId: null,
  score: null,
  byPaperQuestion: new Map(),
  bySection: new Map(),
};

/** Null until the rollup has folded a sitting in, which is the same moment a curve appears. */
export async function topperOf(prisma: PrismaService, testId: string): Promise<TopperTimes> {
  const stat = await prisma.testStat.findUnique({
    where: { testId },
    select: { topperAttemptId: true },
  });
  if (stat?.topperAttemptId == null) return NO_TOPPER;

  const topper = await prisma.attempt.findUnique({
    where: { id: stat.topperAttemptId },
    select: TOPPER_SELECT,
  });
  if (topper === null) return NO_TOPPER;

  const byPaperQuestion = new Map<string, TopperQuestion>();
  for (const row of topper.questions) {
    if (row.paperQuestionId === null) continue;
    byPaperQuestion.set(row.paperQuestionId, {
      timeSpentSec: row.timeSpentSec,
      marksAwarded: row.marksAwarded === null ? null : Number(row.marksAwarded),
    });
  }

  const bySection = new Map<string, number>();
  for (const section of sectionScoresIn(topper.sectionScores) ?? []) {
    bySection.set(section.baseConfigSectionId, section.timeSpentSec);
  }

  return {
    attemptId: topper.id,
    score: topper.score === null ? null : Number(topper.score),
    byPaperQuestion,
    bySection: bySection.size > 0 ? bySection : sectionTimesFrom(topper.questions),
  };
}

/** A sitting scored before sections were stamped still has its questions' clocks to add up. */
function sectionTimesFrom(
  questions: readonly { baseConfigSectionId: string; timeSpentSec: number }[],
): Map<string, number> {
  const spent = new Map<string, number>();
  for (const row of questions) {
    spent.set(
      row.baseConfigSectionId,
      (spent.get(row.baseConfigSectionId) ?? 0) + row.timeSpentSec,
    );
  }
  return spent;
}
