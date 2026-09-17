/**
 * The paper's topper, read for their CLOCK. `TestStat.topperAttemptId` already names them, so this
 * is one read per report rather than one per row. The select reads their answers too, to decode
 * the sheet, but only time and marks ever leave this file — a topper is right often enough that
 * their answers would be a key.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { servedSheet } from './answer-sheet';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { sectionScoresIn } from './score-paper';

/** No `questionVersion`: the sheet is read to decode it, but only time and marks leave here. */
const TOPPER_SELECT = {
  testId: true,
  startedAt: true,
  shuffleSeed: true,
  sectionScores: true,
  sheet: { select: { answers: true, verdicts: true } },
} as const satisfies Prisma.AttemptSelect;

export interface TopperQuestion {
  timeSpentSec: number;
  marksAwarded: number | null;
}

/** What the topper spent, keyed the two ways a report needs it. Empty when no rollup names one. */
export interface TopperTimes {
  byPaperQuestion: ReadonlyMap<string, TopperQuestion>;
  bySection: ReadonlyMap<string, number>;
}

export const NO_TOPPER: TopperTimes = {
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

  const paper = await prisma.paperQuestion.findMany({
    where: { testId: topper.testId },
    orderBy: { order: 'asc' },
    select: SHEET_ROW_SELECT,
  });
  const served = servedSheet(paper, topper, false);

  const byPaperQuestion = new Map<string, TopperQuestion>();
  for (const row of served) {
    byPaperQuestion.set(row.id, { timeSpentSec: row.timeSpentSec, marksAwarded: row.marksAwarded });
  }

  const bySection = new Map<string, number>();
  for (const section of sectionScoresIn(topper.sectionScores) ?? []) {
    bySection.set(section.baseConfigSectionId, section.timeSpentSec);
  }

  return {
    byPaperQuestion,
    bySection: bySection.size > 0 ? bySection : sectionTimesFrom(served),
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
