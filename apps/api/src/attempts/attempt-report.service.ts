/**
 * What a student reviews of a sitting they have finished, and the trend across all of them. The
 * review's read is the one place a student's `questionVersion` loads, reachable only past the
 * marked-sitting gate; the score card never loads one (`performance.service.ts`). Keep it that way.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type LanguageCode,
  type LocalizedContent,
  type PerformancePoint,
  type PerformanceTrend,
  type SatSitting,
  type ScoreCardQuestion,
  type SolutionQuestion,
  type SolutionReport,
  type SolutionsQuery,
  round2 as round,
  servedQuestions,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { answeredRows, type ServedAnswer } from './answer-sheet';
import { imageUrlsIn } from './exam-images';
import { htmlOfQuestion, narrowTo, servedQuestion } from './exam-content';
import { PaperSheetService, type SolutionPaperRow } from './paper-sheet.service';
import { LeaderboardService, type Standing } from './leaderboard.service';
import { percentageOf } from './attempt-report';
import { answerKeyIn, optionsIn } from '../common/prisma-json';

const NOT_YOURS = 'No such sitting';

/** How many sittings a trend line carries. Beyond this a chart is a smear, not a trend. */
const TREND_LENGTH = 20;

/** Sittings listed at all. Every tile, picker and retake reads them, so this is a whole history and then some — not a screenful. */
const HISTORY_LENGTH = 500;
const NOT_REVIEWABLE = 'This paper has not been marked yet, so there is nothing to review.';

/** The sitting a review is drawn from. The KEY is not here — it rides the paper, read past the gate. */
const SOLUTION_SELECT = {
  id: true,
  testId: true,
  status: true,
  languages: true,
  startedAt: true,
  shuffleSeed: true,
  sheet: { select: { answers: true, verdicts: true } },
  test: {
    select: {
      title: true,
      paperRevision: true,
      baseConfig: {
        select: {
          shuffleOptions: true,
          shuffleQuestions: true,
          sections: {
            select: {
              id: true,
              name: true,
              order: true,
              questionCount: true,
              durationSec: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
} as const satisfies Prisma.AttemptSelect;

type SolutionRow = SolutionPaperRow & ServedAnswer;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly storage: StorageService,
    private readonly papers: PaperSheetService,
  ) {}

  /** Every sitting this student has had marked, oldest first; only the chart's newest are stood. */
  async performance(studentId: string): Promise<PerformanceTrend> {
    // Read newest first under the bound, then turned round: the history a screen loses is its oldest.
    const newest = await this.prisma.attempt.findMany({
      where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
      orderBy: { submittedAt: { sort: 'desc', nulls: 'last' } },
      take: HISTORY_LENGTH,
      select: SITTING_SELECT,
    });
    const rows = newest.reverse();
    const testIds = [...new Set(rows.map((row) => row.testId))];
    const [marks, standings] = await Promise.all([
      this.paperMarks(testIds),
      this.leaderboard.standingsOf(rows.slice(-TREND_LENGTH).map((row) => row.id)),
    ]);
    const sittings = rows.map((row) => toSatSitting(row, marks.get(row.testId) ?? 0));

    return {
      testsSat: testIds.length,
      points: sittings
        .slice(-TREND_LENGTH)
        .map((sitting) => toPerformancePoint(sitting, standings.get(sitting.attemptId))),
      sittings,
    };
  }

  /** The PAPER's own marks, so one sitting cannot read one percentage here and another on its card. */
  private async paperMarks(testIds: readonly string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.paperQuestion.groupBy({
      by: ['testId'],
      where: { testId: { in: [...testIds] } },
      _sum: { marks: true },
    });
    return new Map(rows.map((row) => [row.testId, round(Number(row._sum.marks ?? 0))]));
  }

  /** The answer key. Only a sitting the student finished and had marked ever reaches it. */
  async solutions(
    studentId: string,
    attemptId: string,
    query: SolutionsQuery,
  ): Promise<SolutionReport> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SOLUTION_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    const config = attempt.test.baseConfig;
    const paper = await this.papers.solutionsOf(attempt.testId, attempt.test.paperRevision);
    // The same sequencer the paper was served through, so the option they remember as "C" is "C" here.
    const served = servedQuestions(
      answeredRows(paper, attempt).map((row) => toSolutionQuestion(row, attempt.languages)),
      attempt.shuffleSeed,
      config.shuffleQuestions,
      config.shuffleOptions,
    );
    // Narrowed AFTER the sequencer: its option generator is spent across the whole paper in display order.
    const sections = config.sections.map((section) => ({
      id: section.id,
      name: section.name,
      order: section.order,
      questionCount: section.questionCount,
      durationSec: section.durationSec,
    }));
    const asked = wantedOf(served, query, sections[0]?.id ?? null);
    const urls = imageUrlsIn(this.storage, asked.questions.flatMap(htmlOfQuestion));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      languages: attempt.languages,
      sections,
      sectionId: asked.sectionId,
      questions: asked.questions.map((row) => servedQuestion(row, urls)),
    };
  }
}

/** One question where a saved row asked for it, one section otherwise — never a whole paper. */
function wantedOf(
  served: readonly SolutionQuestion[],
  query: SolutionsQuery,
  first: string | null,
): { sectionId: string | null; questions: SolutionQuestion[] } {
  if (query.questionId !== undefined) {
    const one = served.filter((row) => row.questionId === query.questionId);
    return { sectionId: one[0]?.baseConfigSectionId ?? null, questions: one };
  }
  const sectionId = query.sectionId ?? first;
  return {
    sectionId,
    questions: served.filter((row) => row.baseConfigSectionId === sectionId),
  };
}

function toScoreCardQuestion(row: SolutionRow): ScoreCardQuestion {
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

function toSolutionQuestion(
  row: SolutionRow,
  languages: readonly LanguageCode[],
): SolutionQuestion {
  const stored = optionsIn(row.questionVersion.options);
  return {
    ...toScoreCardQuestion(row),
    type: row.question.type,
    // Stem AND solution, unlike the exam paper — explaining the answer is the whole point here.
    content: narrowTo(row.questionVersion.content as LocalizedContent | null, languages),
    options: stored.map((option) => ({ ...option, text: narrowTo(option.text, languages) })),
    answerKey: answerKeyIn(row.questionVersion.answerKey),
  };
}

const SITTING_SELECT = {
  id: true,
  attemptNo: true,
  isGraded: true,
  testId: true,
  submittedAt: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  test: { select: { title: true } },
} as const satisfies Prisma.AttemptSelect;

type SittingRow = Prisma.AttemptGetPayload<{ select: typeof SITTING_SELECT }>;

function toSatSitting(row: SittingRow, maxMarks: number): SatSitting {
  const score = Number(row.score ?? 0);
  const attempted = (row.correctCount ?? 0) + (row.wrongCount ?? 0);
  return {
    attemptId: row.id,
    attemptNo: row.attemptNo,
    isGraded: row.isGraded,
    testId: row.testId,
    testTitle: row.test.title,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    score,
    maxMarks,
    percentage: percentageOf(score, maxMarks),
    accuracy: attempted === 0 ? 0 : round(((row.correctCount ?? 0) / attempted) * 100),
  };
}

/** A retake is outside the cohort, so it has no standing and plots no rank or percentile. */
function toPerformancePoint(sitting: SatSitting, standing: Standing | undefined): PerformancePoint {
  return { ...sitting, rank: standing?.rank ?? null, percentile: standing?.percentile ?? null };
}
