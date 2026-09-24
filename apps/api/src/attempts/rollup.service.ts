/**
 * The five aggregates, written two ways from one arithmetic: a first evaluation is folded in as a
 * delta, and a rebuild replays the durable sittings and writes the answer outright. Reversal is
 * always a rebuild of a bounded scope — one test, or one student — never an undone delta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, SAVED_QUESTION_KIND } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { servedSheet } from './answer-sheet';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { sectionScoresIn } from './score-paper';
import {
  addToCohortTotals,
  addToStudentTotals,
  cohortSittingsOf,
  emptyCohortTotals,
  emptyStudentTotals,
  pValueOf,
  type CohortTotals,
  type FoldableAttempt,
  type QuestionTotals,
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

/** The cheap pair is four statements; the item pass is a page at a time and may take a while. */
const RECOUNT_TIMEOUT_MS = 15_000;
const REBUILD_TIMEOUT_MS = 120_000;

/** How far back a pass looks past its own watermark, for a sitting that committed after it read. */
const SWEEP_LAG = '2 minutes';

/** Bounded so one pass cannot run for ever; the next sweep takes whatever is left. */
const SWEEP_TESTS_PER_PASS = 50;

/** Item analysis is admin-only and reads every sheet, so it runs on its own slower clock. */
const ITEM_SWEEP_EVERY_MS = 15 * 60 * 1000;

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Every test something has landed on since it was last counted. One job id, so one pass runs. */
  async sweepCohorts(): Promise<number> {
    const tests = await this.changedTests();
    let counted = 0;
    for (const testId of tests) {
      if (await this.tried(testId, () => this.recountTest(testId))) counted += 1;
    }
    // Its own selection, not this pass's tests: a test goes quiet long before its items are due.
    for (const testId of await this.staleItems()) {
      await this.tried(testId, () => this.recountTestItems(testId));
    }
    return counted;
  }

  /** One test that will not count must not hold up the rest of the pass; the next one takes it again. */
  private async tried(testId: string, work: () => Promise<void>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch (error: unknown) {
      this.logger.error(`Counting the cohort of test ${testId} failed`, error);
      return false;
    }
  }

  /** The lag is the whole guard: a sitting committed after a pass read must be swept again. */
  private async changedTests(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id"
      FROM "Test" t
      LEFT JOIN "TestStat" s ON s."testId" = t."id"
      WHERE EXISTS (
        SELECT 1 FROM "Attempt" a
        WHERE a."testId" = t."id"
          AND a."updatedAt" > COALESCE(s."computedAt" - ${SWEEP_LAG}::interval, '-infinity'::timestamptz))
      LIMIT ${SWEEP_TESTS_PER_PASS}`;
    return rows.map((row) => row.id);
  }

  /** Item analysis reads every sheet, so it waits for BOTH: newer totals to describe, and its own clock. */
  private async staleItems(): Promise<string[]> {
    const fresh = new Date(Date.now() - ITEM_SWEEP_EVERY_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s."testId" AS id
      FROM "TestStat" s
      WHERE s."evaluatedCount" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "TestQuestionStat" q
          WHERE q."testId" = s."testId" AND q."computedAt" >= s."computedAt")
        AND NOT EXISTS (
          SELECT 1 FROM "TestQuestionStat" q
          WHERE q."testId" = s."testId" AND q."computedAt" >= ${fresh})
      LIMIT ${SWEEP_TESTS_PER_PASS}`;
    return rows.map((row) => row.id);
  }

  /** The cheap pair, off `Attempt` alone: the marks and the packed sections carry all of it. */
  async recountTest(testId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await this.writeTestTotals(tx, testId, now);
        await this.writeSectionTotals(tx, testId, now);
      },
      { timeout: RECOUNT_TIMEOUT_MS },
    );
  }

  /** One statement, so the counts and the topper describe one snapshot of the cohort. */
  private async writeTestTotals(
    tx: Prisma.TransactionClient,
    testId: string,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      WITH sat AS (
        SELECT a."id", a."score", a."evaluatedAt", a."attemptNo",
               COALESCE((
                 SELECT sum((part->>5)::bigint)
                 FROM jsonb_array_elements(COALESCE(a."sectionScores", '[]'::jsonb)) part
               ), 0) AS "timeSec"
        FROM "Attempt" a
        WHERE a."testId" = ${testId}::uuid
          AND a."status" = ${ATTEMPT_STATUS.EVALUATED}::"AttemptStatus"
          AND a."isGraded"
      )
      INSERT INTO "TestStat" (
        "testId", "evaluatedCount", "sumScore", "maxScore", "minScore",
        "sumTimeSec", "topperAttemptId", "computedAt")
      SELECT ${testId}::uuid, count(*)::int, COALESCE(sum("score"), 0),
             max("score"), min("score"), COALESCE(sum("timeSec"), 0)::bigint,
             -- The fold kept the first sitting to reach the maximum, and a replay has to agree.
             (SELECT "id" FROM sat ORDER BY "score" DESC, "evaluatedAt", "attemptNo" LIMIT 1),
             ${now}
      FROM sat
      ON CONFLICT ("testId") DO UPDATE SET
        "evaluatedCount" = EXCLUDED."evaluatedCount",
        "sumScore" = EXCLUDED."sumScore",
        "maxScore" = EXCLUDED."maxScore",
        "minScore" = EXCLUDED."minScore",
        "sumTimeSec" = EXCLUDED."sumTimeSec",
        "topperAttemptId" = EXCLUDED."topperAttemptId",
        "computedAt" = EXCLUDED."computedAt"`;
  }

  /** `sectionScores` is `[sectionId, score, correct, wrong, unattempted, timeSpentSec]` per section. */
  private async writeSectionTotals(
    tx: Prisma.TransactionClient,
    testId: string,
    now: Date,
  ): Promise<void> {
    await tx.testSectionStat.deleteMany({ where: { testId } });
    await tx.$executeRaw`
      INSERT INTO "TestSectionStat" (
        "testId", "baseConfigSectionId", "attempted", "sumScore", "sumTimeSec", "computedAt")
      SELECT ${testId}::uuid, (part->>0)::uuid, count(*)::int,
             sum((part->>1)::numeric), sum((part->>5)::bigint), ${now}
      FROM "Attempt" a, jsonb_array_elements(COALESCE(a."sectionScores", '[]'::jsonb)) part
      WHERE a."testId" = ${testId}::uuid
        AND a."status" = ${ATTEMPT_STATUS.EVALUATED}::"AttemptStatus"
        AND a."isGraded"
      GROUP BY (part->>0)`;
  }

  /** The expensive one: every sheet of the cohort, against the paper it was served from. */
  async recountTestItems(testId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const ids = (await this.firstSittings(tx, testId)).map((row) => row.id);
        const totals = emptyCohortTotals();
        await this.replay(tx, ids, (attempt) => addToCohortTotals(totals, attempt));
        await this.writeItemTotals(tx, testId, totals, now);
      },
      { timeout: REBUILD_TIMEOUT_MS },
    );
  }

  private async writeItemTotals(
    tx: Prisma.TransactionClient,
    testId: string,
    totals: CohortTotals,
    now: Date,
  ): Promise<void> {
    await tx.testQuestionStat.deleteMany({ where: { testId } });
    await tx.testQuestionStat.createMany({
      data: [...totals.questions.values()].map((question) => ({
        testId,
        ...questionColumns(question, now),
      })),
    });
  }

  /** A drop or a bonus moved marks already counted: the test's curve and every sitter go again. */
  async rebuildForTest(testId: string): Promise<void> {
    await this.rebuildTest(testId);
    for (const studentId of await this.sitters(testId)) {
      await this.rebuildStudent(studentId);
    }
  }

  /** Both halves at once: what an admin's re-sync asks for, and what a backfill writes. */
  async rebuildTest(testId: string): Promise<void> {
    await this.recountTest(testId);
    await this.recountTestItems(testId);
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

  /** One sitting's own two tables, inside the scorer's transaction: marks and totals commit together. */
  async foldStudentSitting(
    tx: Prisma.TransactionClient,
    attempt: FoldableAttempt,
    now: Date,
  ): Promise<void> {
    const totals = addToStudentTotals(emptyStudentTotals(), attempt);
    // StudentStat first, as `rebuildStudent` locks it first: a rebuild mid-evaluation must queue, not race.
    await this.addToStudent(tx, attempt.studentId, totals, now);
    await this.addToSubjects(tx, attempt.studentId, totals, now);
    await this.foldMistakes(tx, [attempt]);
  }

  /** Prisma cannot increment and take a GREATEST in one upsert, so the statement is written out. */
  private async addToStudent(
    tx: Prisma.TransactionClient,
    studentId: string,
    totals: StudentTotals,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "StudentStat" (
        "studentId", "testsAttempted", "testsEvaluated", "sumScore", "totalAnswered",
        "totalCorrect", "totalWrong", "totalUnattempted", "sumTimeSec", "retakeCount",
        "lastAttemptAt", "computedThrough", "computedAt")
      VALUES (
        ${studentId}::uuid, ${totals.testsAttempted}, ${totals.testsEvaluated},
        ${totals.sumScore}, ${totals.totalAnswered}, ${totals.totalCorrect}, ${totals.totalWrong},
        ${totals.totalUnattempted}, ${BigInt(totals.sumTimeSec)}, ${totals.retakeCount},
        ${totals.lastAttemptAt}::timestamptz, ${totals.computedThrough}::timestamptz, ${now})
      ON CONFLICT ("studentId") DO UPDATE SET
        "testsAttempted" = "StudentStat"."testsAttempted" + EXCLUDED."testsAttempted",
        "testsEvaluated" = "StudentStat"."testsEvaluated" + EXCLUDED."testsEvaluated",
        "sumScore" = "StudentStat"."sumScore" + EXCLUDED."sumScore",
        "totalAnswered" = "StudentStat"."totalAnswered" + EXCLUDED."totalAnswered",
        "totalCorrect" = "StudentStat"."totalCorrect" + EXCLUDED."totalCorrect",
        "totalWrong" = "StudentStat"."totalWrong" + EXCLUDED."totalWrong",
        "totalUnattempted" = "StudentStat"."totalUnattempted" + EXCLUDED."totalUnattempted",
        "sumTimeSec" = "StudentStat"."sumTimeSec" + EXCLUDED."sumTimeSec",
        "retakeCount" = "StudentStat"."retakeCount" + EXCLUDED."retakeCount",
        -- GREATEST ignores a NULL side, which is what maxOf did with the row it used to read back.
        "lastAttemptAt" = GREATEST("StudentStat"."lastAttemptAt", EXCLUDED."lastAttemptAt"),
        "computedThrough" = GREATEST("StudentStat"."computedThrough", EXCLUDED."computedThrough"),
        "computedAt" = EXCLUDED."computedAt"`;
  }

  /** Every subject the sitting served, in one statement and in subject order for the lock. */
  private async addToSubjects(
    tx: Prisma.TransactionClient,
    studentId: string,
    totals: StudentTotals,
    now: Date,
  ): Promise<void> {
    const rows = [...totals.subjects.values()].sort((left, right) =>
      left.subjectId.localeCompare(right.subjectId),
    );
    if (rows.length === 0) return;

    await tx.$executeRaw`
      INSERT INTO "StudentSubjectStat" (
        "studentId", "subjectId", "scope", "attempted", "correct", "wrong", "sumTimeSec", "computedAt")
      SELECT ${studentId}::uuid, * FROM unnest(
        ${rows.map((row) => row.subjectId)}::uuid[],
        ${rows.map((row) => row.scope)}::"TestScope"[],
        ${rows.map((row) => row.attempted)}::int[],
        ${rows.map((row) => row.correct)}::int[],
        ${rows.map((row) => row.wrong)}::int[],
        ${rows.map((row) => BigInt(row.sumTimeSec))}::bigint[],
        ${rows.map(() => now)}::timestamptz[])
      ON CONFLICT ("studentId", "subjectId", "scope") DO UPDATE SET
        "attempted" = "StudentSubjectStat"."attempted" + EXCLUDED."attempted",
        "correct" = "StudentSubjectStat"."correct" + EXCLUDED."correct",
        "wrong" = "StudentSubjectStat"."wrong" + EXCLUDED."wrong",
        "sumTimeSec" = "StudentSubjectStat"."sumTimeSec" + EXCLUDED."sumTimeSec",
        "computedAt" = EXCLUDED."computedAt"`;
  }

  /** `isCorrect` is false only for a CHOSEN wrong answer; `skipDuplicates` makes a re-fold write once. */
  private async foldMistakes(
    tx: Prisma.TransactionClient,
    attempts: readonly FoldableAttempt[],
  ): Promise<void> {
    const wrong = attempts.flatMap((attempt) =>
      attempt.questions
        .filter((question) => question.isCorrect === false)
        .map((question) => ({
          studentId: attempt.studentId,
          questionId: question.questionId,
          kind: SAVED_QUESTION_KIND.MISTAKE,
          attemptId: attempt.id,
          paperQuestionId: question.paperQuestionId,
        })),
    );
    if (wrong.length === 0) return;

    await tx.savedQuestion.createMany({ data: wrong, skipDuplicates: true });
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

  /** The cohort's sittings: one per student by `Attempt_graded_per_test_key`, oldest first. */
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

function questionColumns(question: QuestionTotals, now: Date) {
  return {
    ...question,
    sumTimeSec: BigInt(question.sumTimeSec),
    optionCounts: asJson(question.optionCounts),
    pValue: pValueOf(question.correctCount, question.attemptedCount),
    computedAt: now,
  };
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
