/**
 * One test's cohort, read off the three rollup tables. Every query is a `testId`-keyed read of a
 * pre-folded row — no `groupBy`, no attempt scan, no new rollup — plus one indexed count of the
 * sittings those rows should hold, so a fold still catching up reads as settling. Only ranked first
 * sittings ever fold, so what comes back describes the ranked cohort by construction.
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
import { bandsIn } from './performance-analytics';
import { cohortSittingsOf, optionCountsIn, optionsIn } from './rollup-fold';
import { RollupOutbox } from './rollup-outbox';
import {
  itemsOf,
  sectionsOf,
  summaryOf,
  type ItemTotals,
  type SectionTotals,
  type StatTotals,
} from './test-analytics';

const NO_TEST = 'No such test';

const ITEM_SELECT = {
  paperQuestionId: true,
  questionId: true,
  attemptedCount: true,
  correctCount: true,
  wrongCount: true,
  skippedCount: true,
  sumTimeSec: true,
  optionCounts: true,
  pValue: true,
  discrimination: true,
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

@Injectable()
export class TestAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollups: RollupOutbox,
    private readonly access: AccessResolverService,
  ) {}

  async forTest(testId: string): Promise<TestAnalytics> {
    const test = await this.requireTest(testId);

    const [stat, sections, items, liveEvaluatedCount, reachedCount] = await Promise.all([
      this.statOf(testId),
      this.sectionsOf(testId),
      this.itemsOf(testId),
      // The one live read here: a count on [testId, status], so settling costs no attempt scan.
      this.prisma.attempt.count({ where: cohortSittingsOf(testId) }),
      this.access.audienceCount(test.testSeriesId),
    ]);

    return {
      testId: test.id,
      title: test.title,
      summary: summaryOf(
        stat,
        await this.topperOf(stat?.topperAttemptId ?? null),
        liveEvaluatedCount,
        reachedCount,
      ),
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

  private async statOf(
    testId: string,
  ): Promise<(StatTotals & { topperAttemptId: string | null }) | null> {
    const row = await this.prisma.testStat.findUnique({ where: { testId } });
    if (row === null) return null;
    return {
      attemptCount: row.attemptCount,
      evaluatedCount: row.evaluatedCount,
      sumScore: Number(row.sumScore),
      maxScore: numberOrNull(row.maxScore),
      minScore: numberOrNull(row.minScore),
      sumTimeSec: Number(row.sumTimeSec),
      bands: bandsIn(row.scoreHistogram),
      computedAt: row.computedAt,
      topperAttemptId: row.topperAttemptId,
    };
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
  private async topperOf(attemptId: string | null): Promise<TestTopper | null> {
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
    attemptedCount: row.attemptedCount,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    skippedCount: row.skippedCount,
    sumTimeSec: Number(row.sumTimeSec),
    pValue: numberOrNull(row.pValue),
    discrimination: numberOrNull(row.discrimination),
    options,
    optionCounts: optionCountsIn(row.optionCounts),
  };
}
