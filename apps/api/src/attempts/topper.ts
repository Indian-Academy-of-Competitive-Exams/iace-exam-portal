/**
 * The paper's topper — the board's rank 1 — read for their CLOCK, once per report rather than once
 * per row. The select reads their answers too, to decode the sheet, but only time and marks ever
 * leave this file — a topper is right often enough that their answers would be a key.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { servedSheet } from './answer-sheet';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { rankOneSql } from './ranking-sql';
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

/** What the topper spent, keyed the two ways a report needs it. Empty while nobody is ranked. */
export interface TopperTimes {
  byPaperQuestion: ReadonlyMap<string, TopperQuestion>;
  bySection: ReadonlyMap<string, number>;
}

export const NO_TOPPER: TopperTimes = {
  byPaperQuestion: new Map(),
  bySection: new Map(),
};

/** Counted live like every rank, so the topper a report names is the one the board seats first. */
export async function topperIdOf(prisma: PrismaService, testId: string): Promise<string | null> {
  const [top] = await prisma.$queryRaw<{ id: string }[]>(rankOneSql(testId));
  return top?.id ?? null;
}

export async function topperOf(prisma: PrismaService, testId: string): Promise<TopperTimes> {
  const topperId = await topperIdOf(prisma, testId);
  if (topperId === null) return NO_TOPPER;

  const topper = await prisma.attempt.findUnique({
    where: { id: topperId },
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
