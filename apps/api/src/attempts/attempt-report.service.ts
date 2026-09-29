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
  type AnswerKey,
  type LanguageCode,
  type LocalizedContent,
  type PerformancePoint,
  type PerformanceTrend,
  type SatSitting,
  type ScoreCardQuestion,
  type SolutionQuestion,
  type SolutionReport,
  round2 as round,
  servedQuestions,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { answeredRows, type ServedAnswer } from './answer-sheet';
import { imageUrlsIn } from './exam-images';
import { htmlOfQuestion, narrowTo, servedQuestion } from './exam-content';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { LeaderboardService, type Standing } from './leaderboard.service';
import { percentageOf } from './attempt-report';
import { optionsIn } from './rollup-fold';

const NOT_YOURS = 'No such sitting';

/** How many sittings a trend line carries. Beyond this a chart is a smear, not a trend. */
const TREND_LENGTH = 20;
const NOT_REVIEWABLE = 'This paper has not been marked yet, so there is nothing to review.';

/** The paper's own terms per row; every sitting of a test was served the whole of it. */
const PRICED_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
} as const satisfies Prisma.PaperQuestionSelect;

type PricedRow = Prisma.PaperQuestionGetPayload<{ select: typeof PRICED_ROW_SELECT }> &
  ServedAnswer;

/** What the GATE needs, and nothing else — this read happens before anybody has been let in. */
const GATE_SELECT = {
  id: true,
  testId: true,
  status: true,
  test: { select: { baseConfig: { select: { durationSec: true } } } },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. Reached only past `solutionsAreOpen`, which is why it is a second read and not a join. */
const SOLUTION_SELECT = {
  id: true,
  testId: true,
  languages: true,
  startedAt: true,
  shuffleSeed: true,
  sheet: { select: { answers: true, verdicts: true } },
  test: {
    select: {
      title: true,
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

const SOLUTION_ROW_SELECT = {
  ...PRICED_ROW_SELECT,
  question: { select: { type: true } },
  questionVersion: { select: { content: true, options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

type SolutionRow = Prisma.PaperQuestionGetPayload<{ select: typeof SOLUTION_ROW_SELECT }> &
  ServedAnswer;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly storage: StorageService,
  ) {}

  /** Every sitting this student has had marked, oldest first; only the chart's newest are stood. */
  async performance(studentId: string): Promise<PerformanceTrend> {
    const rows = await this.prisma.attempt.findMany({
      where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
      orderBy: { submittedAt: { sort: 'asc', nulls: 'first' } },
      select: SITTING_SELECT,
    });
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
  async solutions(studentId: string, attemptId: string): Promise<SolutionReport> {
    const gate = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: GATE_SELECT,
    });
    if (!gate) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (gate.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SOLUTION_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    const config = attempt.test.baseConfig;
    const paper = await this.prisma.paperQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: 'asc' },
      select: SOLUTION_ROW_SELECT,
    });
    // The same sequencer the paper was served through, so the option they remember as "C" is "C" here.
    const questions = servedQuestions(
      answeredRows(paper, attempt).map((row) => toSolutionQuestion(row, attempt.languages)),
      attempt.shuffleSeed,
      config.shuffleQuestions,
      config.shuffleOptions,
    );
    const urls = imageUrlsIn(this.storage, questions.flatMap(htmlOfQuestion));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      languages: attempt.languages,
      sections: attempt.test.baseConfig.sections.map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: questions.map((row) => servedQuestion(row, urls)),
    };
  }
}

function toScoreCardQuestion(row: PricedRow): ScoreCardQuestion {
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
    answerKey: (row.questionVersion.answerKey as AnswerKey | null) ?? null,
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
