/**
 * Watching one test's sittings. Every read is scoped to the chosen test and bounded by an index —
 * there is no scan over every attempt, and nothing here reads a question, an answer or a key.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LIVE_OPS_RECENT_MINUTES,
  LIVE_OPS_ROW_CAP,
  type LiveOpsBoard,
  type LiveOpsTest,
  type LiveOpsTestQuery,
  type Paginated,
  type RecentSubmission,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptStateService } from './attempt-state.service';
import { numberOrNull } from './attempt-report';
import { sittingsFrom, watchableTestsWhere, type SittingRow } from './live-ops';
import { MS_PER_MINUTE } from '../common/time/units';
import { pageArgs, paged } from '../common/pagination';

const SUBMISSION_SELECT = {
  id: true,
  studentId: true,
  attemptNo: true,
  isGraded: true,
  status: true,
  submittedAt: true,
  score: true,
  student: { select: { fullName: true, mobile: true } },
} as const satisfies Prisma.AttemptSelect;

@Injectable()
export class LiveOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
  ) {}

  /** The picker's list. On this feature's own key, so an ops admin needs nothing else granted. */
  async tests(query: LiveOpsTestQuery): Promise<Paginated<LiveOpsTest>> {
    const where = watchableTestsWhere(query.q);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.test.findMany({
        where,
        // Newest window first: what an ops admin is watching opened recently, or is about to.
        orderBy: [{ opensAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        ...pageArgs(query),
        select: {
          id: true,
          title: true,
          opensAt: true,
          testSeries: { select: { name: true } },
          examStage: { select: { name: true } },
        },
      }),
      this.prisma.test.count({ where }),
    ]);

    return paged(
      query,
      rows.map((row) => {
        return {
          id: row.id,
          title: row.title,
          seriesName: row.testSeries.name,
          stageName: row.examStage.name,
          opensAt: row.opensAt?.toISOString() ?? null,
        };
      }),
      total,
    );
  }

  async board(testId: string, now: Date = new Date()): Promise<LiveOpsBoard> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: { id: true, title: true },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');

    const since = new Date(now.getTime() - LIVE_OPS_RECENT_MINUTES * MS_PER_MINUTE);
    // Voided ones stay, badged; updatedAt never trails submittedAt, so (testId, updatedAt) finds them.
    const landed = { testId, submittedAt: { gte: since }, updatedAt: { gte: since } };

    const [questionCount, activeRows, stuckRows, live, submittedRecently, awaitingScoring, recent] =
      await Promise.all([
        this.prisma.paperQuestion.count({ where: { testId } }),
        // Read apart, so a hall of stuck sittings cannot fill the window and empty the running list.
        this.sittings(testId, Prisma.sql`a."endsAt" >= ${now}`),
        this.sittings(testId, Prisma.sql`a."endsAt" < ${now}`),
        this.liveCounts(testId, now),
        this.prisma.attempt.count({ where: landed }),
        this.prisma.attempt.count({
          where: { testId, status: ATTEMPT_STATUS.SUBMITTED, score: null },
        }),
        this.prisma.attempt.findMany({
          where: landed,
          orderBy: { submittedAt: 'desc' },
          take: LIVE_OPS_ROW_CAP,
          select: SUBMISSION_SELECT,
        }),
      ]);
    const { active, stuck } = live;

    const held = await this.state.readMany([...activeRows, ...stuckRows].map((row) => row.id));

    return {
      testId: test.id,
      testTitle: test.title,
      serverNow: now.toISOString(),
      counts: { active, stuck, submittedRecently, awaitingScoring },
      active: sittingsFrom(activeRows, held, questionCount),
      stuck: sittingsFrom(stuckRows, held, questionCount),
      recent: recent.map(toSubmission),
    };
  }

  /** One panel's page of live sittings, closest to its deadline first. */
  private async sittings(testId: string, deadline: Prisma.Sql): Promise<SittingRow[]> {
    const rows = await this.prisma.$queryRaw<LiveRow[]>`
      SELECT a."id", a."studentId", a."attemptNo", a."isGraded", a."startedAt", a."endsAt",
             s."fullName", s."mobile", b."name" AS "branchName"
      FROM "Attempt" a
      JOIN "Student" s ON s."id" = a."studentId"
      LEFT JOIN "Branch" b ON b."id" = s."currentBranchId"
      WHERE a."testId" = ${testId}::uuid AND ${IN_PROGRESS} AND ${deadline}
      ORDER BY a."endsAt" ASC
      LIMIT ${LIVE_OPS_ROW_CAP}`;
    return rows.map(nested);
  }

  /** Both panels' sizes off one pass of the live index, which the deadline only splits. */
  private async liveCounts(testId: string, now: Date): Promise<{ active: number; stuck: number }> {
    const [counted] = await this.prisma.$queryRaw<{ active: number; stuck: number }[]>`
      SELECT count(*) FILTER (WHERE a."endsAt" >= ${now})::int AS "active",
             count(*) FILTER (WHERE a."endsAt" < ${now})::int AS "stuck"
      FROM "Attempt" a
      WHERE a."testId" = ${testId}::uuid AND ${IN_PROGRESS}`;
    return { active: counted?.active ?? 0, stuck: counted?.stuck ?? 0 };
  }
}

/** Literal, not a parameter: a bound enum cannot prove Attempt_live_by_test_idx's predicate, so the planner skips it. */
const IN_PROGRESS = Prisma.raw(`a."status" = '${ATTEMPT_STATUS.IN_PROGRESS}'`);

/** One row as the raw read returns it: the student and branch arrive flat and are nested below. */
interface LiveRow {
  id: string;
  studentId: string;
  attemptNo: number;
  isGraded: boolean;
  startedAt: Date;
  endsAt: Date;
  fullName: string;
  mobile: string;
  branchName: string | null;
}

const nested = (row: LiveRow): SittingRow => ({
  id: row.id,
  studentId: row.studentId,
  attemptNo: row.attemptNo,
  isGraded: row.isGraded,
  startedAt: row.startedAt,
  endsAt: row.endsAt,
  student: {
    fullName: row.fullName,
    mobile: row.mobile,
    currentBranch: row.branchName === null ? null : { name: row.branchName },
  },
});

function toSubmission(row: Prisma.AttemptGetPayload<{ select: typeof SUBMISSION_SELECT }>) {
  return {
    attemptId: row.id,
    studentId: row.studentId,
    studentName: row.student.fullName,
    mobile: row.student.mobile,
    attemptNo: row.attemptNo,
    isGraded: row.isGraded,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    score: numberOrNull(row.score),
  } satisfies RecentSubmission;
}
