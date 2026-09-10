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
import { sittingsFrom, watchableTestsWhere } from './live-ops';

/** Both panels come off one read, so the stuck ones are simply the first rows it returns. */
const SITTING_SELECT = {
  id: true,
  studentId: true,
  attemptNo: true,
  isGraded: true,
  startedAt: true,
  endsAt: true,
  student: {
    select: { fullName: true, mobile: true, currentBranch: { select: { name: true } } },
  },
} as const satisfies Prisma.AttemptSelect;

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

const MS_PER_MINUTE = 60 * 1000;

@Injectable()
export class LiveOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
  ) {}

  /** The picker's list. On this feature's own key, so an ops admin needs nothing else granted. */
  async tests(query: LiveOpsTestQuery): Promise<Paginated<LiveOpsTest>> {
    const where = watchableTestsWhere(query.q) as Prisma.TestWhereInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.test.findMany({
        where,
        // Newest window first: what an ops admin is watching opened recently, or is about to.
        orderBy: [{ opensAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
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

    return {
      items: rows.map((row) => {
        return {
          id: row.id,
          title: row.title,
          seriesName: row.testSeries.name,
          stageName: row.examStage.name,
          opensAt: row.opensAt?.toISOString() ?? null,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async board(testId: string, now: Date = new Date()): Promise<LiveOpsBoard> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: { id: true, title: true },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');

    const since = new Date(now.getTime() - LIVE_OPS_RECENT_MINUTES * MS_PER_MINUTE);
    // A voided sitting stays HERE, badged: the admin who stood one down has to be able to see it.
    const landed = { testId, submittedAt: { gte: since } };
    // Read apart, so a hall of stuck sittings cannot fill the window and empty the running list.
    const running = { testId, status: ATTEMPT_STATUS.IN_PROGRESS, endsAt: { gte: now } };
    const overdue = { testId, status: ATTEMPT_STATUS.IN_PROGRESS, endsAt: { lt: now } };

    const [
      questionCount,
      activeRows,
      stuckRows,
      active,
      stuck,
      submittedRecently,
      awaitingScoring,
      recent,
    ] = await Promise.all([
      // Every variant holds the whole paper, so the first one's size is every sitting's size.
      this.prisma.paperQuestion.count({ where: { testId, variant: 0 } }),
      this.sittings(running),
      this.sittings(overdue),
      this.prisma.attempt.count({ where: running }),
      this.prisma.attempt.count({ where: overdue }),
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
  private sittings(where: Prisma.AttemptWhereInput) {
    return this.prisma.attempt.findMany({
      where,
      orderBy: { endsAt: 'asc' },
      take: LIVE_OPS_ROW_CAP,
      select: SITTING_SELECT,
    });
  }
}

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
    score: row.score === null ? null : Number(row.score),
  } satisfies RecentSubmission;
}
