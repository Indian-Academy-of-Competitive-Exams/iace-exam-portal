/**
 * One test's cohort: the spread counted live off the sittings in one grouped read, and the time,
 * section and item figures read off the rollup rows the sweep recounts. Only ranked sittings are in
 * either, so what comes back describes the ranked cohort by construction.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type LocalizedContent,
  type QuestionOption,
  type TestAnalytics,
  type TestTopper,
} from '@iace/contracts';
import { AccessResolverService } from '../access';
import { PrismaService } from '../prisma/prisma.service';
import { stemPreviewOf } from '../questions';
import { timeSpentIn } from './answer-sheet';
import { numberOrNull } from './attempt-report';
import { boardName } from './leaderboard-board';
import { cohortCurveOf } from './cohort-curve';
import { optionCountsIn, optionsIn, pValueOf } from './rollup-fold';
import { RollupQueue } from './rollup-queue';
import { topperIdOf } from './topper';
import {
  itemsOf,
  sectionsOf,
  summaryOf,
  type ItemTotals,
  type SectionTotals,
} from './test-analytics';

const NO_TEST = 'No such test';

const ITEM_SELECT = {
  paperQuestionId: true,
  questionId: true,
  correctCount: true,
  wrongCount: true,
  skippedCount: true,
  sumTimeSec: true,
  optionCounts: true,
  paperQuestion: {
    select: {
      order: true,
      baseConfigSectionId: true,
      question: { select: { questionCode: true } },
      questionVersion: { select: { content: true, options: true } },
    },
  },
} as const satisfies Prisma.TestQuestionStatSelect;

type ItemRow = Prisma.TestQuestionStatGetPayload<{ select: typeof ITEM_SELECT }>;

const STAT_SELECT = {
  evaluatedCount: true,
  sumTimeSec: true,
  computedAt: true,
} as const satisfies Prisma.TestStatSelect;

@Injectable()
export class TestAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollups: RollupQueue,
    private readonly access: AccessResolverService,
  ) {}

  async forTest(testId: string): Promise<TestAnalytics> {
    const test = await this.requireTest(testId);

    const [stat, live, topper, sections, items, attemptCount, reachedCount] = await Promise.all([
      this.prisma.testStat.findUnique({ where: { testId }, select: STAT_SELECT }),
      cohortCurveOf(this.prisma, testId),
      this.topperOf(testId),
      this.sectionsOf(testId),
      this.itemsOf(testId),
      // Every sitting, ranked or not, on [testId, status]: the rollup holds only the ranked cohort.
      this.prisma.attempt.count({ where: { testId } }),
      this.access.audienceCount(test.testSeriesId),
    ]);

    return {
      testId: test.id,
      title: test.title,
      summary: summaryOf(stat && { ...stat, sumTimeSec: Number(stat.sumTimeSec) }, live, topper, {
        attemptCount,
        reachedCount,
      }),
      sections: sectionsOf(sections),
      items: itemsOf(items),
    };
  }

  /** An admin's re-sync: the rebuild is queued, never run on the request. */
  async resync(testId: string): Promise<void> {
    await this.requireTest(testId);
    await this.rollups.rebuildNow(testId);
  }

  private async requireTest(
    testId: string,
  ): Promise<{ id: string; title: string | null; testSeriesId: string }> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: { id: true, title: true, testSeriesId: true },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, NO_TEST);
    return test;
  }

  private async sectionsOf(testId: string): Promise<SectionTotals[]> {
    const rows = await this.prisma.testSectionStat.findMany({
      where: { testId },
      select: {
        baseConfigSectionId: true,
        attempted: true,
        sumScore: true,
        sumTimeSec: true,
        baseConfigSection: {
          select: { name: true, order: true, questionCount: true, marksPerQuestion: true },
        },
      },
    });
    return rows.map((row) => ({
      baseConfigSectionId: row.baseConfigSectionId,
      name: row.baseConfigSection.name,
      order: row.baseConfigSection.order,
      maxMarks:
        row.baseConfigSection.questionCount * Number(row.baseConfigSection.marksPerQuestion),
      attempted: row.attempted,
      sumScore: Number(row.sumScore),
      sumTimeSec: Number(row.sumTimeSec),
    }));
  }

  private async itemsOf(testId: string): Promise<ItemTotals[]> {
    const rows = await this.prisma.testQuestionStat.findMany({
      where: { testId },
      select: ITEM_SELECT,
    });
    return rows.map((row) => toItemTotals(row));
  }

  /** The topper by name, which an admin may see where the student board shows only a board name. */
  private async topperOf(testId: string): Promise<TestTopper | null> {
    const attemptId = await topperIdOf(this.prisma, testId);
    if (attemptId === null) return null;
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        studentId: true,
        score: true,
        student: { select: { fullName: true } },
        sheet: { select: { answers: true } },
      },
    });
    if (attempt === null) return null;
    return {
      attemptId: attempt.id,
      studentId: attempt.studentId,
      name: boardName(attempt.student.fullName),
      score: numberOrNull(attempt.score),
      timeSpentSec: timeSpentIn(attempt.sheet?.answers),
    };
  }
}

function toItemTotals(row: ItemRow): ItemTotals {
  const paper = row.paperQuestion;
  const options: QuestionOption[] = optionsIn(paper.questionVersion.options);
  return {
    paperQuestionId: row.paperQuestionId,
    questionId: row.questionId,
    order: paper.order,
    baseConfigSectionId: paper.baseConfigSectionId,
    questionCode: paper.question.questionCode,
    stemPreview: stemPreviewOf((paper.questionVersion.content as LocalizedContent | null) ?? {}),
    attemptedCount: row.correctCount + row.wrongCount,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    skippedCount: row.skippedCount,
    sumTimeSec: Number(row.sumTimeSec),
    pValue: pValueOf(row.correctCount, row.wrongCount),
    options,
    optionCounts: optionCountsIn(row.optionCounts),
  };
}
