/**
 * The per-question table for one sitting. TWO reads again, and for the same reason the score card
 * and the review are two: the first never loads a `questionVersion`, so no key can reach it; the
 * second does, and runs only past `solutionsAreOpen`. The cohort's own columns come off the rollup
 * tables and nowhere else — a question no job has counted yet reads as a dash, never as a scan.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  COHORT_COMPARISON_FLOOR,
  ErrorCodes,
  QUESTION_TYPE,
  type AnswerKey,
  type QuestionReport,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { servedSheet, type ServedAnswer } from './answer-sheet';
import { elapsedSeconds, numberOrNull } from './attempt-report';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { requireStudent } from './require-student';
import { optionCountsIn, optionsIn } from './rollup-fold';
import { topperOf, type TopperTimes } from './topper';
import {
  paceIndexOf,
  questionReportRow,
  type CohortItem,
  type KeyedQuestion,
  type SatQuestion,
} from './question-report';

const NOT_YOURS = 'No such sitting';
const NOT_MARKED = 'This paper has not been marked yet, so there is nothing to compare.';

/** No `questionVersion` anywhere in here. That absence is the feature. */
const REPORT_SELECT = {
  id: true,
  testId: true,
  status: true,
  startedAt: true,
  shuffleSeed: true,
  sheet: { select: { answers: true, verdicts: true } },
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
          durationSec: true,
          shuffleQuestions: true,
          sections: {
            select: { id: true, name: true, order: true, questionCount: true, durationSec: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. A second read, reached only past the gate — never a join onto the one above. */
const KEY_ROW_SELECT = {
  questionId: true,
  question: { select: { type: true } },
  questionVersion: { select: { options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

const REPORT_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
} as const satisfies Prisma.PaperQuestionSelect;

type ReportPaperRow = Prisma.PaperQuestionGetPayload<{ select: typeof REPORT_ROW_SELECT }> &
  ServedAnswer;

type ReportRow = Prisma.AttemptGetPayload<{ select: typeof REPORT_SELECT }>;

@Injectable()
export class QuestionReportService {
  constructor(private readonly prisma: PrismaService) {}

  async forAttempt(studentId: string, attemptId: string): Promise<QuestionReport> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: REPORT_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const [cohort, paper, topper, keyed, rows] = await Promise.all([
      this.cohortItems(attempt.testId),
      this.paperTotals(attempt.testId),
      topperOf(this.prisma, attempt.testId),
      this.keyOf(attempt.testId),
      this.prisma.paperQuestion.findMany({
        where: { testId: attempt.testId },
        orderBy: { order: 'asc' },
        select: REPORT_ROW_SELECT,
      }),
    ]);
    const served = servedSheet(rows, attempt, attempt.test.baseConfig.shuffleQuestions);

    return this.assemble(attempt, served, { cohort, paper, topper, keyed });
  }

  /** The same payload the student reads, for any student the admin's branches reach. */
  async forStudent(studentId: string, attemptId: string): Promise<QuestionReport> {
    await requireStudent(this.prisma, studentId);
    return this.forAttempt(studentId, attemptId);
  }

  private assemble(
    attempt: ReportRow,
    served: readonly ReportPaperRow[],
    held: {
      cohort: ReadonlyMap<string, CohortItem>;
      paper: { evaluatedCount: number; sumTimeSec: number };
      topper: TopperTimes;
      keyed: ReadonlyMap<string, KeyedQuestion>;
    },
  ): QuestionReport {
    // The first sitter is their own cohort, and a pace index of exactly 1.00 against themselves.
    const compared = held.paper.evaluatedCount >= COHORT_COMPARISON_FLOOR;
    const questions = served.map((row) =>
      questionReportRow(
        toSat(row),
        compared ? (held.cohort.get(row.id) ?? null) : null,
        compared ? (held.topper.byPaperQuestion.get(row.id) ?? null) : null,
        held.keyed.get(row.questionId) ?? null,
      ),
    );
    const yourTimeSec = served.reduce((total, row) => total + row.timeSpentSec, 0);

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      cohortSize: held.paper.evaluatedCount,
      paceIndex: compared
        ? paceIndexOf(yourTimeSec, held.paper.sumTimeSec, held.paper.evaluatedCount)
        : null,
      sections: attempt.test.baseConfig.sections,
      questions,
    };
  }

  /** The rollup's item analysis, keyed by the paper row a sitting was served. */
  private async cohortItems(testId: string): Promise<Map<string, CohortItem>> {
    const rows = await this.prisma.testQuestionStat.findMany({
      where: { testId },
      select: {
        paperQuestionId: true,
        attemptedCount: true,
        skippedCount: true,
        correctCount: true,
        sumTimeSec: true,
        pValue: true,
        optionCounts: true,
      },
    });
    return new Map(
      rows.map((row) => [
        row.paperQuestionId,
        {
          attemptedCount: row.attemptedCount,
          skippedCount: row.skippedCount,
          correctCount: row.correctCount,
          sumTimeSec: Number(row.sumTimeSec),
          pValue: numberOrNull(row.pValue),
          optionCounts: optionCountsIn(row.optionCounts),
        },
      ]),
    );
  }

  /** What the whole paper cost the cohort, for the pace index. Zeroes where no rollup has run. */
  private async paperTotals(
    testId: string,
  ): Promise<{ evaluatedCount: number; sumTimeSec: number }> {
    const stat = await this.prisma.testStat.findUnique({
      where: { testId },
      select: { evaluatedCount: true, sumTimeSec: true },
    });
    return {
      evaluatedCount: stat?.evaluatedCount ?? 0,
      sumTimeSec: stat === null ? 0 : Number(stat.sumTimeSec),
    };
  }

  private async keyOf(testId: string): Promise<Map<string, KeyedQuestion>> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      select: KEY_ROW_SELECT,
    });
    const keyed = new Map<string, KeyedQuestion>();
    for (const row of rows) {
      const options = optionsIn(row.questionVersion.options);
      keyed.set(row.questionId, {
        options,
        correctAnswer:
          row.question.type === QUESTION_TYPE.TEXT_FIELD
            ? acceptedAnswerIn(row.questionVersion.answerKey)
            : null,
      });
    }
    return keyed;
  }
}

function toSat(row: ReportPaperRow): SatQuestion {
  return {
    questionId: row.questionId,
    paperQuestionId: row.id,
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
    // Null unless BOTH instants exist: a sitting from before this was measured has neither.
    timeToRespondSec:
      row.firstActionAt && row.answeredAt
        ? elapsedSeconds(row.firstActionAt, row.answeredAt)
        : null,
  };
}

/** The first answer the key accepts. A typed question has no option to point at instead. */
function acceptedAnswerIn(stored: Prisma.JsonValue): string | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
  const key = stored as unknown as AnswerKey;
  return Object.values(key.answers ?? {}).find((value) => typeof value === 'string') ?? null;
}
