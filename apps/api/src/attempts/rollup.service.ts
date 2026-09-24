/**
 * The five aggregates, written two ways from one arithmetic: a first evaluation is folded in as a
 * delta, and a rebuild replays the durable sittings and writes the answer outright. Reversal is
 * always a rebuild of a bounded scope — one test, or one student — never an undone delta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, SAVED_QUESTION_KIND } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { RELAY_BATCH } from '../queue/queues';
import { servedSheet } from './answer-sheet';
import { numberOrNull } from './attempt-report';
import { bandsIn, cohortShapeOf } from './performance-analytics';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { ROLLUP_REQUEST } from './rollup-outbox';
import { sectionScoresIn } from './score-paper';
import {
  COHORT_ROLLUP_TYPES,
  ROLLUP_TYPE,
  STUDENT_ROLLUP_TYPES,
  addToCohortTotals,
  addToStudentTotals,
  bandsAfterBatch,
  cohortSittingsOf,
  emptyCohortTotals,
  emptyStudentTotals,
  maxOf,
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
  sectionScores: true,
  startedAt: true,
  shuffleSeed: true,
  test: { select: { scope: true } },
  sheet: { select: { answers: true, verdicts: true } },
} as const satisfies Prisma.AttemptSelect;

type FoldRow = Prisma.AttemptGetPayload<{ select: typeof FOLD_SELECT }>;

const FOLD_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  testId: true,
  question: { select: { subjectId: true } },
} as const satisfies Prisma.PaperQuestionSelect;

type FoldPaperRow = Prisma.PaperQuestionGetPayload<{ select: typeof FOLD_ROW_SELECT }>;

/** Each test's paper once for a page of sittings, which a student's rebuild spreads over many tests. */
async function papersOf(
  client: Pick<Prisma.TransactionClient, 'paperQuestion'>,
  testIds: readonly string[],
): Promise<Map<string, FoldPaperRow[]>> {
  const rows = await client.paperQuestion.findMany({
    where: { testId: { in: [...new Set(testIds)] } },
    orderBy: [{ testId: 'asc' }, { order: 'asc' }],
    select: FOLD_ROW_SELECT,
  });
  const papers = new Map<string, FoldPaperRow[]>();
  for (const row of rows) {
    const held = papers.get(row.testId) ?? [];
    held.push(row);
    papers.set(row.testId, held);
  }
  return papers;
}

/** A batch of sittings in one read, and each test's paper once however many of them sat it. */
async function foldablesOf(
  client: Pick<Prisma.TransactionClient, 'attempt' | 'paperQuestion'>,
  attemptIds: readonly string[],
): Promise<FoldableAttempt[]> {
  const rows = await client.attempt.findMany({
    where: { id: { in: [...attemptIds] }, status: ATTEMPT_STATUS.EVALUATED },
    select: FOLD_SELECT,
  });
  const papers = await papersOf(
    client,
    rows.map((row) => row.testId),
  );
  return rows.map((row) => toFoldable(row, papers.get(row.testId) ?? []));
}

/** Sittings replayed per round trip, so a rebuild of a 5K cohort never holds it all in memory. */
const REBUILD_PAGE = 200;

/** A hall of 5K at a page each, and then the pass lets go: no one job may run for ever. */
const FOLD_PAGES_PER_PASS = 25;

/** Enough ids to go looking with, and few enough that one bad page cannot fill the log. */
const WARNED_IDS = 20;

/** A fold is a handful of statements; a rebuild is a page at a time and may take a while. */
const FOLD_TIMEOUT_MS = 15_000;
const REBUILD_TIMEOUT_MS = 120_000;

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A full page means more is waiting, and this job holds the id a re-ask would collapse onto. */
  async foldPending(): Promise<number> {
    let counted = 0;
    for (let page = 0; page < FOLD_PAGES_PER_PASS; page += 1) {
      const claimed = await this.foldPage();
      counted += claimed;
      if (claimed < RELAY_BATCH) break;
    }
    return counted;
  }

  /** One page: claim a page of counting requests, fold them, and mark them only once counted. */
  private async foldPage(): Promise<number> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { eventType: ROLLUP_REQUEST.EVENT_TYPE, processedAt: null },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, aggregateId: true },
    });
    if (rows.length === 0) return 0;

    // Deduped: two requests for one sitting are one fold, which `guarded` would have made of them anyway.
    const requested = [...new Set(rows.map((row) => row.aggregateId))];
    const attempts = await foldablesOf(this.prisma, requested);
    const folded = new Set(attempts.map((attempt) => attempt.id));
    const retired = requested.filter((id) => !folded.has(id));
    // Marked all the same below: a request for a sitting nobody evaluated must not jam the page.
    if (retired.length > 0) {
      this.logger.warn(
        `${retired.length} of ${requested.length} folds are not evaluated, and are retired: ${named(retired)}`,
      );
    }

    for (const attempt of attempts) await this.foldStudent(attempt);
    await this.foldCohorts(attempts);

    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { processedAt: new Date() },
    });
    return rows.length;
  }

  /** The cohort's side of a page: one transaction per test, whatever the page's sittings sat. */
  private async foldCohorts(attempts: readonly FoldableAttempt[]): Promise<void> {
    const byTest = new Map<string, FoldableAttempt[]>();
    for (const attempt of attempts) {
      if (!attempt.isGraded || !(await this.isFirstSitting(attempt))) continue;
      const sittings = byTest.get(attempt.testId) ?? [];
      sittings.push(attempt);
      byTest.set(attempt.testId, sittings);
    }
    for (const [testId, sittings] of byTest) await this.foldCohortBatch(testId, sittings);
  }

  /** Every fresh sitting as ONE delta, so a 5K cohort takes the test's row lock once, not 5K times. */
  private async foldCohortBatch(
    testId: string,
    sittings: readonly FoldableAttempt[],
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // A REAL update: Prisma's empty-update findOrCreate cannot be relied on to lock the row.
        await tx.testStat.upsert({
          where: { testId },
          create: { testId, computedAt: now },
          update: { computedAt: now },
        });

        // Guards only under the lock above; every cohort-guard writer must take it first.
        const fresh = await this.uncounted(tx, sittings);
        if (fresh.length === 0) return;

        const totals = emptyCohortTotals();
        for (const attempt of fresh) addToCohortTotals(totals, attempt);
        await tx.processedRollup.createMany({
          data: fresh.flatMap((attempt) =>
            COHORT_ROLLUP_TYPES.map((rollupType) => ({ attemptId: attempt.id, rollupType })),
          ),
          skipDuplicates: true,
        });
        await this.writeCohortDelta(tx, testId, totals, now);
      },
      { timeout: FOLD_TIMEOUT_MS },
    );
  }

  /** The cohort's three guard rows are written and dropped together, so the test's one answers for all. */
  private async uncounted(
    tx: Prisma.TransactionClient,
    sittings: readonly FoldableAttempt[],
  ): Promise<FoldableAttempt[]> {
    // READ COMMITTED only: a REPEATABLE READ snapshot predates the lock, and would count twice.
    const held = await tx.processedRollup.findMany({
      where: {
        rollupType: ROLLUP_TYPE.TEST,
        attemptId: { in: sittings.map((attempt) => attempt.id) },
      },
      select: { attemptId: true },
    });
    const counted = new Set(held.map((row) => row.attemptId));
    return sittings.filter((attempt) => !counted.has(attempt.id));
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

  /** One student's two tables, over every evaluated sitting of theirs — retakes included. */
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
    const totals = addToStudentTotals(emptyStudentTotals(), attempt);
    await this.guarded(attempt.id, STUDENT_ROLLUP_TYPES, async (tx) => {
      const now = new Date();
      // The increment goes first ON PURPOSE: it locks the row, so the read below is not overtaken.
      const counts = studentCounts(totals);
      await tx.studentStat.upsert({
        where: { studentId: attempt.studentId },
        create: { studentId: attempt.studentId, ...counts, computedAt: now },
        update: { ...increments(counts), computedAt: now },
      });

      const held = await tx.studentStat.findUniqueOrThrow({
        where: { studentId: attempt.studentId },
        select: { lastAttemptAt: true, computedThrough: true },
      });
      await tx.studentStat.update({
        where: { studentId: attempt.studentId },
        data: {
          lastAttemptAt: maxOf(held.lastAttemptAt, totals.lastAttemptAt),
          computedThrough: maxOf(held.computedThrough, totals.computedThrough),
        },
      });

      await this.foldMistakes(tx, attempt);

      for (const subject of totals.subjects.values()) {
        const key = {
          studentId: attempt.studentId,
          subjectId: subject.subjectId,
          scope: subject.scope,
        };
        const subjectTotals = subjectCounts(subject);
        await tx.studentSubjectStat.upsert({
          where: { studentId_subjectId_scope: key },
          create: { ...key, ...subjectTotals, computedAt: now },
          update: { ...increments(subjectTotals), computedAt: now },
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

  /** Counts move by increment; the curve, the extremes and the topper are read back and set. */
  private async writeCohortDelta(
    tx: Prisma.TransactionClient,
    testId: string,
    totals: CohortTotals,
    now: Date,
  ): Promise<void> {
    const counts = cohortCounts(totals);
    await tx.testStat.upsert({
      where: { testId },
      create: { testId, ...counts, computedAt: now },
      update: { ...increments(counts), computedAt: now },
    });

    const held = await tx.testStat.findUniqueOrThrow({
      where: { testId },
      select: { maxScore: true, minScore: true, scoreHistogram: true, topperAttemptId: true },
    });
    const maxScore = numberOrNull(held.maxScore);
    const minScore = numberOrNull(held.minScore);
    const scores = scoreCountsOf(totals).flatMap((row) =>
      new Array<number>(row.count).fill(row.score),
    );
    const moved = bandsAfterBatch(bandsIn(held.scoreHistogram), minScore, maxScore, scores);
    const raised = totals.maxScore !== null && (maxScore === null || totals.maxScore > maxScore);

    await tx.testStat.update({
      where: { testId },
      data: {
        maxScore: maxOf(maxScore, totals.maxScore),
        minScore: lowerOf(minScore, totals.minScore),
        topperAttemptId: raised ? totals.topperAttemptId : held.topperAttemptId,
        scoreHistogram: asJson(moved ?? (await this.rebandOf(tx, testId))),
      },
    });

    for (const section of totals.sections.values()) {
      const key = { testId, baseConfigSectionId: section.baseConfigSectionId };
      const sectionTotals = sectionCounts(section);
      await tx.testSectionStat.upsert({
        where: { testId_baseConfigSectionId: key },
        create: { ...key, ...sectionTotals, computedAt: now },
        update: { ...increments(sectionTotals), computedAt: now },
      });
    }

    await this.foldQuestionStats(tx, testId, totals, now);
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
        ...cohortCounts(totals),
        maxScore: totals.maxScore,
        minScore: totals.minScore,
        scoreHistogram: asJson(cohortShapeOf(scoreCountsOf(totals)).bands),
        topperAttemptId: totals.topperAttemptId,
        computedAt: now,
      },
    });

    await tx.testSectionStat.deleteMany({ where: { testId } });
    await tx.testSectionStat.createMany({
      data: [...totals.sections.values()].map((section) => ({
        testId,
        baseConfigSectionId: section.baseConfigSectionId,
        ...sectionCounts(section),
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
        ...studentCounts(totals),
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
        ...subjectCounts(subject),
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
      where: cohortSittingsOf(testId),
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
      for (const attempt of await foldablesOf(tx, ids.slice(at, at + REBUILD_PAGE))) fold(attempt);
    }
  }
}

/** Each count as an increment, so a folded delta and a rebuild write one column list. */
function increments<T extends Record<string, number | bigint>>(counts: T) {
  return Object.fromEntries(
    Object.entries(counts).map(([column, value]) => [column, { increment: value }]),
  ) as { [K in keyof T]: { increment: T[K] } };
}

function studentCounts(totals: StudentTotals) {
  return {
    testsAttempted: totals.testsAttempted,
    testsEvaluated: totals.testsEvaluated,
    sumScore: totals.sumScore,
    totalAnswered: totals.totalAnswered,
    totalCorrect: totals.totalCorrect,
    totalWrong: totals.totalWrong,
    totalUnattempted: totals.totalUnattempted,
    sumTimeSec: BigInt(totals.sumTimeSec),
    retakeCount: totals.retakeCount,
  };
}

function subjectCounts(subject: {
  attempted: number;
  correct: number;
  wrong: number;
  sumTimeSec: number;
}) {
  return {
    attempted: subject.attempted,
    correct: subject.correct,
    wrong: subject.wrong,
    sumTimeSec: BigInt(subject.sumTimeSec),
  };
}

function sectionCounts(section: { attempted: number; sumScore: number; sumTimeSec: number }) {
  return {
    attempted: section.attempted,
    sumScore: section.sumScore,
    sumTimeSec: BigInt(section.sumTimeSec),
  };
}

function cohortCounts(totals: CohortTotals) {
  return {
    attemptCount: totals.attempts,
    evaluatedCount: totals.attempts,
    sumScore: totals.sumScore,
    sumTimeSec: BigInt(totals.sumTimeSec),
    attemptsIncluded: totals.attempts,
  };
}

function toFoldable(row: FoldRow, paper: readonly FoldPaperRow[]): FoldableAttempt {
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
    scope: row.test.scope,
    sections: sectionScoresIn(row.sectionScores) ?? [],
    questions: servedSheet(paper, row, false).map((question) => ({
      paperQuestionId: question.id,
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
    ...row,
    sumTimeSec: Number(row.sumTimeSec),
    optionCounts: optionCountsIn(row.optionCounts),
  };
}

function questionColumns(question: QuestionTotals, now: Date) {
  return {
    ...question,
    sumTimeSec: BigInt(question.sumTimeSec),
    optionCounts: asJson(question.optionCounts),
    pValue: pValueOf(question.correctCount, question.attemptedCount),
    computedAt: now,
  };
}

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, WARNED_IDS).join(', ');
  return ids.length > WARNED_IDS ? `${shown}, and ${ids.length - WARNED_IDS} more` : shown;
}

function lowerOf(held: number | null, found: number | null): number | null {
  if (held === null) return found;
  return found === null ? held : Math.min(held, found);
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
