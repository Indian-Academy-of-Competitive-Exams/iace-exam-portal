/**
 * The five aggregates, written two ways from one arithmetic: a first evaluation is folded in as a
 * delta, and a rebuild replays the durable sittings and writes the answer outright. Reversal is
 * always a rebuild of a bounded scope — one test, or one student — never an undone delta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, EVALUATION_MODE, SAVED_QUESTION_KIND } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { cohortShapeOf } from './performance-analytics';
import { sectionScoresIn } from './score-paper';
import {
  COHORT_ROLLUP_TYPES,
  STUDENT_ROLLUP_TYPES,
  addToCohortTotals,
  addToStudentTotals,
  bandsHolding,
  bandsIn,
  emptyCohortTotals,
  emptyStudentTotals,
  higherOf,
  laterOf,
  mergedQuestion,
  optionCountsIn,
  pValueOf,
  scoreCountsOf,
  type CohortTotals,
  type FoldableAttempt,
  type QuestionTotals,
  type RollupType,
  type StudentTotals,
} from './rollup-fold';

/** Everything the fold reads off a sitting. No answer key: counting is not scoring. */
const FOLD_SELECT = {
  id: true,
  testId: true,
  studentId: true,
  attemptNo: true,
  isGraded: true,
  status: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  unattemptedCount: true,
  submittedAt: true,
  evaluatedAt: true,
  lastPercentile: true,
  sectionScores: true,
  test: { select: { scope: true, evaluationMode: true } },
  questions: {
    select: {
      paperQuestionId: true,
      questionId: true,
      isCorrect: true,
      timeSpentSec: true,
      selectedOptionId: true,
      question: { select: { subjectId: true } },
    },
  },
} as const satisfies Prisma.AttemptSelect;

type FoldRow = Prisma.AttemptGetPayload<{ select: typeof FOLD_SELECT }>;

/** Sittings replayed per round trip, so a rebuild of a 5K cohort never holds it all in memory. */
const REBUILD_PAGE = 200;

/** A fold is a handful of statements; a rebuild is a page at a time and may take a while. */
const FOLD_TIMEOUT_MS = 15_000;
const REBUILD_TIMEOUT_MS = 120_000;

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** One evaluated sitting into the aggregates it belongs to. Folding twice counts it once. */
  async fold(attemptId: string): Promise<void> {
    const attempt = await this.foldable(attemptId);
    if (attempt === null) {
      this.logger.warn(`Rollup asked for attempt ${attemptId}, which is not evaluated`);
      return;
    }
    await this.foldStudent(attempt);
    if (attempt.isGraded && (await this.isFirstSitting(attempt))) {
      await this.foldCohort(attempt);
    }
  }

  /** A drop or a bonus moved marks already counted: the test's curve and every sitter go again. */
  async rebuildForTest(testId: string): Promise<void> {
    await this.rebuildTest(testId);
    for (const studentId of await this.sitters(testId)) {
      await this.rebuildStudent(studentId);
    }
  }

  /** The test's three cohort tables, worked out again from the sittings themselves. */
  async rebuildTest(testId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // The lock first: a concurrent fold of this test queues behind the row it has to update.
        await tx.testStat.upsert({
          where: { testId },
          create: { testId, computedAt: now },
          update: { computedAt: now },
        });

        const ids = (await this.firstSittings(tx, testId)).map((row) => row.id);
        const totals = emptyCohortTotals();
        await this.replay(tx, ids, (attempt) => addToCohortTotals(totals, attempt));
        await this.writeCohort(tx, testId, totals, now);
        await this.reguard(tx, ids, COHORT_ROLLUP_TYPES, { attempt: { testId } });
      },
      { timeout: REBUILD_TIMEOUT_MS },
    );
  }

  /** One student's two tables, over every evaluated sitting of theirs — practice included. */
  async rebuildStudent(studentId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.studentStat.upsert({
          where: { studentId },
          create: { studentId, computedAt: now },
          update: { computedAt: now },
        });

        const ids = await this.evaluatedIds(tx, studentId);
        const totals = emptyStudentTotals();
        await this.replay(tx, ids, (attempt) => addToStudentTotals(totals, attempt));
        await this.writeStudent(tx, studentId, totals, now);
        await this.reguard(tx, ids, STUDENT_ROLLUP_TYPES, { attempt: { studentId } });
      },
      { timeout: REBUILD_TIMEOUT_MS },
    );
  }

  /** Every table from scratch, which is also how sittings scored before this worker are counted. */
  async rebuildAll(): Promise<void> {
    await this.honestGrading();

    const tests = await this.prisma.attempt.findMany({
      where: { status: ATTEMPT_STATUS.EVALUATED, isGraded: true },
      distinct: ['testId'],
      select: { testId: true },
    });
    for (const row of tests) await this.rebuildTest(row.testId);

    const students = await this.prisma.attempt.findMany({
      where: { status: ATTEMPT_STATUS.EVALUATED },
      distinct: ['studentId'],
      select: { studentId: true },
    });
    for (const row of students) await this.rebuildStudent(row.studentId);

    this.logger.log(`Rebuilt ${tests.length} tests and ${students.length} students`);
  }

  /** `isGraded` gates every cohort, so rows written before it knew about PRACTICE are fixed first. */
  private async honestGrading(): Promise<void> {
    const corrected = await this.prisma.attempt.updateMany({
      where: {
        isGraded: true,
        OR: [{ attemptNo: { gt: 1 } }, { test: { evaluationMode: EVALUATION_MODE.PRACTICE } }],
      },
      data: { isGraded: false },
    });
    if (corrected.count > 0) {
      this.logger.warn(`Corrected ${corrected.count} sittings that were graded but should not be`);
    }
  }

  private async foldable(attemptId: string): Promise<FoldableAttempt | null> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: FOLD_SELECT,
    });
    if (row === null || row.status !== ATTEMPT_STATUS.EVALUATED) return null;
    return toFoldable(row);
  }

  /** The cohort is one row per student: the earliest evaluated graded sitting, and no other. */
  private async isFirstSitting(attempt: FoldableAttempt): Promise<boolean> {
    if (attempt.evaluatedAt === null) return false;
    const earlier = await this.prisma.attempt.count({
      where: {
        testId: attempt.testId,
        studentId: attempt.studentId,
        isGraded: true,
        status: ATTEMPT_STATUS.EVALUATED,
        OR: [
          { evaluatedAt: { lt: attempt.evaluatedAt } },
          { evaluatedAt: attempt.evaluatedAt, attemptNo: { lt: attempt.attemptNo } },
        ],
      },
    });
    return earlier === 0;
  }

  private async foldStudent(attempt: FoldableAttempt): Promise<void> {
    const totals = studentDeltaOf(attempt);
    await this.guarded(attempt.id, STUDENT_ROLLUP_TYPES, async (tx) => {
      const now = new Date();
      // The increment goes first ON PURPOSE: it locks the row, so the read below is not overtaken.
      await tx.studentStat.upsert({
        where: { studentId: attempt.studentId },
        create: {
          studentId: attempt.studentId,
          testsAttempted: totals.testsAttempted,
          testsEvaluated: totals.testsEvaluated,
          sumScore: totals.sumScore,
          sumPercentile: totals.sumPercentile,
          totalAnswered: totals.totalAnswered,
          totalCorrect: totals.totalCorrect,
          totalWrong: totals.totalWrong,
          totalUnattempted: totals.totalUnattempted,
          sumTimeSec: BigInt(totals.sumTimeSec),
          practiceAttempts: totals.practiceAttempts,
          computedAt: now,
        },
        update: {
          testsAttempted: { increment: totals.testsAttempted },
          testsEvaluated: { increment: totals.testsEvaluated },
          sumScore: { increment: totals.sumScore },
          sumPercentile: { increment: totals.sumPercentile },
          totalAnswered: { increment: totals.totalAnswered },
          totalCorrect: { increment: totals.totalCorrect },
          totalWrong: { increment: totals.totalWrong },
          totalUnattempted: { increment: totals.totalUnattempted },
          sumTimeSec: { increment: BigInt(totals.sumTimeSec) },
          practiceAttempts: { increment: totals.practiceAttempts },
          computedAt: now,
        },
      });

      const held = await tx.studentStat.findUniqueOrThrow({
        where: { studentId: attempt.studentId },
        select: { bestPercentile: true, lastAttemptAt: true, computedThrough: true },
      });
      await tx.studentStat.update({
        where: { studentId: attempt.studentId },
        data: {
          bestPercentile: higherOf(numberOrNull(held.bestPercentile), totals.bestPercentile),
          lastAttemptAt: laterOf(held.lastAttemptAt, totals.lastAttemptAt),
          computedThrough: laterOf(held.computedThrough, totals.computedThrough),
        },
      });

      await this.foldMistakes(tx, attempt);

      for (const subject of totals.subjects.values()) {
        await tx.studentSubjectStat.upsert({
          where: {
            studentId_subjectId_scope_evaluationMode: {
              studentId: attempt.studentId,
              subjectId: subject.subjectId,
              scope: subject.scope,
              evaluationMode: subject.evaluationMode,
            },
          },
          create: {
            studentId: attempt.studentId,
            subjectId: subject.subjectId,
            scope: subject.scope,
            evaluationMode: subject.evaluationMode,
            attempted: subject.attempted,
            correct: subject.correct,
            wrong: subject.wrong,
            sumTimeSec: BigInt(subject.sumTimeSec),
            computedAt: now,
          },
          update: {
            attempted: { increment: subject.attempted },
            correct: { increment: subject.correct },
            wrong: { increment: subject.wrong },
            sumTimeSec: { increment: BigInt(subject.sumTimeSec) },
            computedAt: now,
          },
        });
      }
    });
  }

  /** `isCorrect` is false only for a CHOSEN wrong answer; `skipDuplicates` makes a re-fold write once. */
  private async foldMistakes(
    tx: Prisma.TransactionClient,
    attempt: FoldableAttempt,
  ): Promise<void> {
    const wrong = attempt.questions.filter((question) => question.isCorrect === false);
    if (wrong.length === 0) return;

    await tx.savedQuestion.createMany({
      data: wrong.map((question) => ({
        studentId: attempt.studentId,
        questionId: question.questionId,
        kind: SAVED_QUESTION_KIND.MISTAKE,
        attemptId: attempt.id,
        paperQuestionId: question.paperQuestionId,
      })),
      skipDuplicates: true,
    });
  }

  private async foldCohort(attempt: FoldableAttempt): Promise<void> {
    const totals = cohortDeltaOf(attempt);
    await this.guarded(attempt.id, COHORT_ROLLUP_TYPES, async (tx) => {
      const now = new Date();
      await this.foldTestStat(tx, attempt, totals, now);

      for (const section of totals.sections.values()) {
        await tx.testSectionStat.upsert({
          where: {
            testId_baseConfigSectionId: {
              testId: attempt.testId,
              baseConfigSectionId: section.baseConfigSectionId,
            },
          },
          create: {
            testId: attempt.testId,
            baseConfigSectionId: section.baseConfigSectionId,
            attempted: section.attempted,
            sumScore: section.sumScore,
            sumTimeSec: BigInt(section.sumTimeSec),
            computedAt: now,
          },
          update: {
            attempted: { increment: section.attempted },
            sumScore: { increment: section.sumScore },
            sumTimeSec: { increment: BigInt(section.sumTimeSec) },
            computedAt: now,
          },
        });
      }

      await this.foldQuestionStats(tx, attempt.testId, totals, now);
    });
  }

  /** Counts move by increment; the curve, the extremes and the topper are read back and set. */
  private async foldTestStat(
    tx: Prisma.TransactionClient,
    attempt: FoldableAttempt,
    totals: CohortTotals,
    now: Date,
  ): Promise<void> {
    await tx.testStat.upsert({
      where: { testId: attempt.testId },
      create: {
        testId: attempt.testId,
        attemptCount: totals.attempts,
        evaluatedCount: totals.attempts,
        sumScore: totals.sumScore,
        sumTimeSec: BigInt(totals.sumTimeSec),
        attemptsIncluded: totals.attempts,
        computedAt: now,
      },
      update: {
        attemptCount: { increment: totals.attempts },
        evaluatedCount: { increment: totals.attempts },
        sumScore: { increment: totals.sumScore },
        sumTimeSec: { increment: BigInt(totals.sumTimeSec) },
        attemptsIncluded: { increment: totals.attempts },
        computedAt: now,
      },
    });

    const held = await tx.testStat.findUniqueOrThrow({
      where: { testId: attempt.testId },
      select: { maxScore: true, minScore: true, scoreHistogram: true, topperAttemptId: true },
    });
    const maxScore = numberOrNull(held.maxScore);
    const minScore = numberOrNull(held.minScore);
    const moved = bandsHolding(bandsIn(held.scoreHistogram), minScore, maxScore, attempt.score);

    await tx.testStat.update({
      where: { testId: attempt.testId },
      data: {
        maxScore: higherOf(maxScore, attempt.score),
        minScore: minScore === null ? attempt.score : Math.min(minScore, attempt.score),
        topperAttemptId:
          maxScore === null || attempt.score > maxScore ? attempt.id : held.topperAttemptId,
        scoreHistogram: asJson(moved ?? (await this.rebandOf(tx, attempt.testId))),
      },
    });
  }

  /** The edges moved, so the curve is cut again over the cohort's SCORES — no paper is re-read. */
  private async rebandOf(tx: Prisma.TransactionClient, testId: string) {
    const counted = new Map<number, number>();
    for (const row of await this.firstSittings(tx, testId)) {
      counted.set(row.score, (counted.get(row.score) ?? 0) + 1);
    }
    return cohortShapeOf([...counted].map(([score, count]) => ({ score, count }))).bands;
  }

  /** Read then written whole: the test's own row is locked above, so no fold can interleave. */
  private async foldQuestionStats(
    tx: Prisma.TransactionClient,
    testId: string,
    totals: CohortTotals,
    now: Date,
  ): Promise<void> {
    const deltas = [...totals.questions.values()];
    if (deltas.length === 0) return;

    const held = await tx.testQuestionStat.findMany({
      where: { testId, paperQuestionId: { in: deltas.map((row) => row.paperQuestionId) } },
      select: {
        paperQuestionId: true,
        questionId: true,
        attemptedCount: true,
        correctCount: true,
        wrongCount: true,
        skippedCount: true,
        sumTimeSec: true,
        optionCounts: true,
      },
    });
    const stored = new Map(held.map((row) => [row.paperQuestionId, toQuestionTotals(row)]));

    for (const delta of deltas) {
      const merged = mergedQuestion(stored.get(delta.paperQuestionId) ?? null, delta);
      await tx.testQuestionStat.upsert({
        where: {
          testId_paperQuestionId: { testId, paperQuestionId: delta.paperQuestionId },
        },
        create: { testId, ...questionColumns(merged, now) },
        update: questionColumns(merged, now),
      });
    }
  }

  /** The guard insert IS the fold: a redelivery collides on the PK and skips the write, as it should. */
  private async guarded(
    attemptId: string,
    types: readonly RollupType[],
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.processedRollup.createMany({
            data: types.map((rollupType) => ({ attemptId, rollupType })),
          });
          await work(tx);
        },
        { timeout: FOLD_TIMEOUT_MS },
      );
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  private async writeCohort(
    tx: Prisma.TransactionClient,
    testId: string,
    totals: CohortTotals,
    now: Date,
  ): Promise<void> {
    await tx.testStat.update({
      where: { testId },
      data: {
        attemptCount: totals.attempts,
        evaluatedCount: totals.attempts,
        sumScore: totals.sumScore,
        maxScore: totals.maxScore,
        minScore: totals.minScore,
        sumTimeSec: BigInt(totals.sumTimeSec),
        scoreHistogram: asJson(cohortShapeOf(scoreCountsOf(totals)).bands),
        topperAttemptId: totals.topperAttemptId,
        attemptsIncluded: totals.attempts,
        computedAt: now,
      },
    });

    await tx.testSectionStat.deleteMany({ where: { testId } });
    await tx.testSectionStat.createMany({
      data: [...totals.sections.values()].map((section) => ({
        testId,
        baseConfigSectionId: section.baseConfigSectionId,
        attempted: section.attempted,
        sumScore: section.sumScore,
        sumTimeSec: BigInt(section.sumTimeSec),
        computedAt: now,
      })),
    });

    await tx.testQuestionStat.deleteMany({ where: { testId } });
    await tx.testQuestionStat.createMany({
      data: [...totals.questions.values()].map((question) => ({
        testId,
        ...questionColumns(question, now),
      })),
    });
  }

  private async writeStudent(
    tx: Prisma.TransactionClient,
    studentId: string,
    totals: StudentTotals,
    now: Date,
  ): Promise<void> {
    await tx.studentStat.update({
      where: { studentId },
      data: {
        testsAttempted: totals.testsAttempted,
        testsEvaluated: totals.testsEvaluated,
        sumScore: totals.sumScore,
        sumPercentile: totals.sumPercentile,
        bestPercentile: totals.bestPercentile,
        totalAnswered: totals.totalAnswered,
        totalCorrect: totals.totalCorrect,
        totalWrong: totals.totalWrong,
        totalUnattempted: totals.totalUnattempted,
        sumTimeSec: BigInt(totals.sumTimeSec),
        practiceAttempts: totals.practiceAttempts,
        lastAttemptAt: totals.lastAttemptAt,
        computedThrough: totals.computedThrough,
        computedAt: now,
      },
    });

    await tx.studentSubjectStat.deleteMany({ where: { studentId } });
    await tx.studentSubjectStat.createMany({
      data: [...totals.subjects.values()].map((subject) => ({
        studentId,
        subjectId: subject.subjectId,
        scope: subject.scope,
        evaluationMode: subject.evaluationMode,
        attempted: subject.attempted,
        correct: subject.correct,
        wrong: subject.wrong,
        sumTimeSec: BigInt(subject.sumTimeSec),
        computedAt: now,
      })),
    });
  }

  /** What a rebuild just counted is marked folded, so a job still in flight adds nothing twice. */
  private async reguard(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    types: readonly RollupType[],
    scope: Prisma.ProcessedRollupWhereInput,
  ): Promise<void> {
    await tx.processedRollup.deleteMany({ where: { rollupType: { in: [...types] }, ...scope } });
    await tx.processedRollup.createMany({
      data: ids.flatMap((attemptId) => types.map((rollupType) => ({ attemptId, rollupType }))),
      skipDuplicates: true,
    });
  }

  /** Ordered as the fold's own first-sitting test orders them, so the two pick the same sitting. */
  private async firstSittings(
    tx: Prisma.TransactionClient,
    testId: string,
  ): Promise<{ id: string; score: number }[]> {
    const rows = await tx.attempt.findMany({
      where: { testId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED },
      orderBy: [{ evaluatedAt: 'asc' }, { attemptNo: 'asc' }],
      select: { id: true, studentId: true, score: true },
    });
    const seen = new Set<string>();
    const first: { id: string; score: number }[] = [];
    for (const row of rows) {
      if (seen.has(row.studentId)) continue;
      seen.add(row.studentId);
      first.push({ id: row.id, score: Number(row.score ?? 0) });
    }
    return first;
  }

  private async evaluatedIds(tx: Prisma.TransactionClient, studentId: string): Promise<string[]> {
    const rows = await tx.attempt.findMany({
      where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
      orderBy: [{ evaluatedAt: 'asc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async sitters(testId: string): Promise<string[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { testId, status: ATTEMPT_STATUS.EVALUATED },
      distinct: ['studentId'],
      select: { studentId: true },
    });
    return rows.map((row) => row.studentId);
  }

  private async replay(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    fold: (attempt: FoldableAttempt) => void,
  ): Promise<void> {
    for (let at = 0; at < ids.length; at += REBUILD_PAGE) {
      const rows = await tx.attempt.findMany({
        where: { id: { in: ids.slice(at, at + REBUILD_PAGE) } },
        select: FOLD_SELECT,
      });
      for (const row of rows) fold(toFoldable(row));
    }
  }
}

function studentDeltaOf(attempt: FoldableAttempt): StudentTotals {
  return addToStudentTotals(emptyStudentTotals(), attempt);
}

function cohortDeltaOf(attempt: FoldableAttempt): CohortTotals {
  return addToCohortTotals(emptyCohortTotals(), attempt);
}

function toFoldable(row: FoldRow): FoldableAttempt {
  return {
    id: row.id,
    testId: row.testId,
    studentId: row.studentId,
    attemptNo: row.attemptNo,
    isGraded: row.isGraded,
    score: Number(row.score ?? 0),
    correctCount: row.correctCount ?? 0,
    wrongCount: row.wrongCount ?? 0,
    unattemptedCount: row.unattemptedCount ?? 0,
    submittedAt: row.submittedAt,
    evaluatedAt: row.evaluatedAt,
    lastPercentile: numberOrNull(row.lastPercentile),
    scope: row.test.scope,
    evaluationMode: row.test.evaluationMode,
    sections: sectionScoresIn(row.sectionScores) ?? [],
    questions: row.questions.map((question) => ({
      paperQuestionId: question.paperQuestionId,
      questionId: question.questionId,
      subjectId: question.question.subjectId,
      isCorrect: question.isCorrect,
      timeSpentSec: question.timeSpentSec,
      selectedOptionId: question.selectedOptionId,
    })),
  };
}

function toQuestionTotals(row: {
  paperQuestionId: string;
  questionId: string;
  attemptedCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  sumTimeSec: bigint;
  optionCounts: Prisma.JsonValue;
}): QuestionTotals {
  return {
    paperQuestionId: row.paperQuestionId,
    questionId: row.questionId,
    attemptedCount: row.attemptedCount,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    skippedCount: row.skippedCount,
    sumTimeSec: Number(row.sumTimeSec),
    optionCounts: optionCountsIn(row.optionCounts),
  };
}

function questionColumns(question: QuestionTotals, now: Date) {
  return {
    paperQuestionId: question.paperQuestionId,
    questionId: question.questionId,
    attemptedCount: question.attemptedCount,
    correctCount: question.correctCount,
    wrongCount: question.wrongCount,
    skippedCount: question.skippedCount,
    sumTimeSec: BigInt(question.sumTimeSec),
    optionCounts: asJson(question.optionCounts),
    pValue: pValueOf(question.correctCount, question.attemptedCount),
    computedAt: now,
  };
}

function numberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
