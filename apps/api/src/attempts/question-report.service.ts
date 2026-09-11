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
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  type AnswerKey,
  type QuestionReport,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
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
const NO_STUDENT = 'No such student';

/** No `questionVersion` anywhere in here. That absence is the feature. */
const REPORT_SELECT = {
  id: true,
  testId: true,
  status: true,
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
          durationSec: true,
          sections: {
            select: { id: true, name: true, order: true, questionCount: true, durationSec: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
  questions: {
    select: {
      questionId: true,
      paperQuestionId: true,
      order: true,
      baseConfigSectionId: true,
      state: true,
      selectedOptionId: true,
      typedAnswer: true,
      isCorrect: true,
      marksAwarded: true,
      timeSpentSec: true,
      answeredAt: true,
      firstActionAt: true,
      paperItem: { select: { marks: true, negativeMarks: true, status: true } },
      question: { select: { difficulty: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. A second read, reached only past the gate — never a join onto the one above. */
const KEY_SELECT = {
  questions: {
    select: {
      questionId: true,
      question: { select: { type: true } },
      questionVersion: { select: { options: true, answerKey: true } },
    },
  },
} as const satisfies Prisma.AttemptSelect;

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

    const [cohort, paper, topper, keyed] = await Promise.all([
      this.cohortItems(attempt.testId),
      this.paperTotals(attempt.testId),
      topperOf(this.prisma, attempt.testId),
      this.keyOf(attempt.id),
    ]);

    return this.assemble(attempt, { cohort, paper, topper, keyed });
  }

  /** The same payload the student reads, for any student the admin's branches reach. */
  async forStudent(studentId: string, attemptId: string): Promise<QuestionReport> {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
    return this.forAttempt(studentId, attemptId);
  }

  private assemble(
    attempt: ReportRow,
    held: {
      cohort: ReadonlyMap<string, CohortItem>;
      paper: { evaluatedCount: number; sumTimeSec: number };
      topper: TopperTimes;
      keyed: ReadonlyMap<string, KeyedQuestion>;
    },
  ): QuestionReport {
    const questions = attempt.questions.map((row) =>
      questionReportRow(
        toSat(row),
        row.paperQuestionId === null ? null : (held.cohort.get(row.paperQuestionId) ?? null),
        row.paperQuestionId === null
          ? null
          : (held.topper.byPaperQuestion.get(row.paperQuestionId) ?? null),
        held.keyed.get(row.questionId) ?? null,
      ),
    );
    const yourTimeSec = attempt.questions.reduce((total, row) => total + row.timeSpentSec, 0);

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      cohortSize: held.paper.evaluatedCount,
      paceIndex: paceIndexOf(yourTimeSec, held.paper.sumTimeSec, held.paper.evaluatedCount),
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
          pValue: row.pValue === null ? null : Number(row.pValue),
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

  private async keyOf(attemptId: string): Promise<Map<string, KeyedQuestion>> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: KEY_SELECT,
    });
    const keyed = new Map<string, KeyedQuestion>();
    for (const row of attempt?.questions ?? []) {
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

function toSat(row: ReportRow['questions'][number]): SatQuestion {
  return {
    questionId: row.questionId,
    paperQuestionId: row.paperQuestionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    state: row.state,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    isCorrect: row.isCorrect,
    marksAwarded: row.marksAwarded === null ? null : Number(row.marksAwarded),
    marks: Number(row.paperItem?.marks ?? 0),
    negativeMarks: Number(row.paperItem?.negativeMarks ?? 0),
    disposition: row.paperItem?.status ?? PAPER_QUESTION_STATUS.ACTIVE,
    timeSpentSec: row.timeSpentSec,
    timeToRespondSec: secondsBetween(row.firstActionAt, row.answeredAt),
    predefinedDifficulty: row.question.difficulty,
  };
}

/** Null unless BOTH instants exist: a sitting from before this was measured has neither. */
function secondsBetween(from?: Date | null, to?: Date | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

/** The first answer the key accepts. A typed question has no option to point at instead. */
function acceptedAnswerIn(stored: Prisma.JsonValue): string | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
  const key = stored as unknown as AnswerKey;
  return Object.values(key.answers ?? {}).find((value) => typeof value === 'string') ?? null;
}
