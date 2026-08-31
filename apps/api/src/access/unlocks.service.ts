import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FREE_SERIES_EXAM_CAP,
  type OpenSeriesList,
  type Paginated,
  type SeriesUnlockRequest,
  type SeriesUnlockRequestRow,
  TEST_SERIES_KIND,
  UNLOCK_REQUEST_STATUS,
  type UnlockDecision,
  type UnlockRequestListQuery,
  type UnlockRequestStatus,
  fieldDiff,
} from '@iace/contracts';
import { branchScopeWhere, type BranchScope } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AccessResolverService } from './access-resolver.service';
import { openUnlock } from './auto-unlock';

const requestInclude = {
  testSeries: { select: { id: true, name: true } },
  student: { select: { id: true, fullName: true, mobile: true } },
} as const satisfies Prisma.SeriesUnlockRequestInclude;

/** The `SeriesUnlockRequest` columns, with nothing joined. */
interface RequestColumns {
  id: string;
  studentId: string;
  testSeriesId: string;
  status: UnlockRequestStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
}

type RequestRow = RequestColumns & {
  testSeries: { id: string; name: string };
  student: { id: string; fullName: string | null; mobile: string };
};

/** What an unlock decision's audit row records — the only column a decision moves. */
const AUDITED_REQUEST_FIELDS = ['status'] as const;

/** Owns who has been let into a series and who is asking: a locked one they reach, or a FREE one. */
@Injectable()
export class UnlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AccessResolverService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  /** A student asks for a REQUEST-mode series they already reach and cannot yet start. */
  async request(studentId: string, testSeriesId: string): Promise<SeriesUnlockRequest> {
    await this.assertRequestable(studentId, testSeriesId);

    const open = await this.openRequest(studentId, testSeriesId);
    if (open) return toRequest(open);

    try {
      const created = await this.prisma.seriesUnlockRequest.create({
        data: { studentId, testSeriesId },
      });
      // The catalog carries the ask, so without this the screen offers to ask all over again.
      this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
      return toRequest(created);
    } catch (error) {
      // The partial unique is what really holds "one open request"; two taps race past the read.
      const raced = isUniqueViolation(error)
        ? await this.openRequest(studentId, testSeriesId)
        : null;
      if (!raced) throw error;
      return toRequest(raced);
    }
  }

  /** The admin queue: newest first, because triage works from what just came in. */
  /** The FREE series a student could ask for: everything of that kind they do not already reach. */
  async openToAsk(studentId: string): Promise<OpenSeriesList> {
    const { series } = await this.resolver.catalog(studentId);
    const reached = new Set(series.map((row) => row.id));

    const rows = await this.prisma.testSeries.findMany({
      where: { kind: TEST_SERIES_KIND.FREE, id: { notIn: [...reached] } },
      select: {
        id: true,
        name: true,
        examStage: { select: { name: true, exam: { select: { code: true } } } },
        unlockRequests: {
          where: { studentId, status: UNLOCK_REQUEST_STATUS.PENDING },
          select: { id: true },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return {
      series: rows.map((row) => ({
        id: row.id,
        name: row.name,
        examStage: row.examStage
          ? { name: row.examStage.name, examCode: row.examStage.exam.code }
          : null,
        pending: row.unlockRequests.length > 0,
      })),
      examsHeld: [...(await this.examsHeld(studentId))],
    };
  }

  async listRequests(
    query: UnlockRequestListQuery,
    scope: BranchScope,
  ): Promise<Paginated<SeriesUnlockRequestRow>> {
    const branches = narrowedTo(scope, query.branchId);
    const where: Prisma.SeriesUnlockRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.testSeriesId ? { testSeriesId: query.testSeriesId } : {}),
      // Whose request it is decides who may see it, and a student belongs to one branch.
      ...(branches ? { student: { currentBranchId: branches } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.seriesUnlockRequest.findMany({
        where,
        include: requestInclude,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.seriesUnlockRequest.count({ where }),
    ]);

    return { items: rows.map(toRequestRow), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Approval opens the series and NOTHING else — no grant is minted, so the day the student's
   * branch switches the series off, this closes with it.
   */
  async decide(
    requestId: string,
    adminId: string,
    status: UnlockDecision,
    scope: BranchScope,
  ): Promise<SeriesUnlockRequestRow> {
    const reachable = branchScopeWhere(scope);
    const pending = await this.prisma.seriesUnlockRequest.findFirst({
      where: {
        id: requestId,
        ...(reachable ? { student: { currentBranchId: reachable } } : {}),
      },
      include: requestInclude,
    });
    if (!pending) throw new AppException(ErrorCodes.NOT_FOUND, 'No such request');

    const decidedAt = new Date();
    const decided = { ...pending, status, decidedAt, decidedById: adminId };

    // Conditioned on PENDING rather than read-then-write: two admins open the same queue.
    const { count } = await this.prisma.seriesUnlockRequest.updateMany({
      where: { id: requestId, status: UNLOCK_REQUEST_STATUS.PENDING },
      data: { status, decidedAt, decidedById: adminId },
    });
    if (count === 0) {
      throw new AppException(ErrorCodes.CONFLICT, 'Somebody has already answered that request');
    }

    this.auditContext.setEntityId(pending.testSeriesId);
    // Filed against the series, so the student is the one thing the row could not otherwise name.
    this.auditContext.setChanged({
      ...fieldDiff(pending, decided, AUDITED_REQUEST_FIELDS),
      studentId: { from: pending.studentId, to: pending.studentId },
    });

    if (status === UNLOCK_REQUEST_STATUS.APPROVED) {
      await this.approve(pending.studentId, pending.testSeriesId, decidedAt, adminId);
    }
    return toRequestRow(decided);
  }

  /** Reached means it was merely locked; not reached means it was FREE, so it earns a grant. */
  private async approve(
    studentId: string,
    testSeriesId: string,
    at: Date,
    adminId: string,
  ): Promise<void> {
    const { series } = await this.resolver.catalog(studentId);
    if (series.some((row) => row.id === testSeriesId)) {
      await this.open(studentId, testSeriesId, at);
      return;
    }

    await this.assertFreeAndUnderCap(studentId, testSeriesId);
    await this.prisma.studentGrant.createMany({
      data: [{ studentId, testSeriesId, createdById: adminId }],
      skipDuplicates: true,
    });
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  private async open(studentId: string, testSeriesId: string, at: Date): Promise<void> {
    const opened = await openUnlock(this.prisma, studentId, testSeriesId, at);
    // A series that opened itself while the request waited in the queue is not news twice over.
    if (opened) this.events.emit(DOMAIN_EVENTS.SERIES_UNLOCKED, { studentId, testSeriesId });
    // Without this the series the student just won stays LOCKED for the rest of the cache TTL.
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  /**
   * Reach is the resolver's answer, never a second copy of it here: a series the student cannot
   * reach must not become reachable by asking about it.
   */
  /** Two ways to be askable: a series they reach that is shut, or a FREE one they do not reach. */
  private async assertRequestable(studentId: string, testSeriesId: string): Promise<void> {
    const { series } = await this.resolver.catalog(studentId);
    const reached = series.find((row) => row.id === testSeriesId);

    if (!reached) {
      await this.assertFreeAndUnderCap(studentId, testSeriesId);
      return;
    }
    // Asking is what gets a student past a prerequisite early, so every shut series takes one.
    if (!reached.canRequestUnlock) {
      throw new AppException(ErrorCodes.CONFLICT, 'That series is already open to you');
    }
  }

  /** Askable unreached only when FREE, and only inside the cap — which pending asks count toward. */
  private async assertFreeAndUnderCap(studentId: string, testSeriesId: string): Promise<void> {
    const target = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { kind: true, examStage: { select: { exam: { select: { code: true } } } } },
    });
    if (target?.kind !== TEST_SERIES_KIND.FREE) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');
    }

    const examCode = target.examStage?.exam.code ?? null;
    const held = await this.examsHeld(studentId);
    if (examCode !== null && held.has(examCode)) return;
    if (held.size < FREE_SERIES_EXAM_CAP) return;

    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `Free tests run to ${FREE_SERIES_EXAM_CAP} exams. Ask the institute to open another.`,
    );
  }

  /** The exams a student already holds a free series on, granted or still queued. */
  private async examsHeld(studentId: string): Promise<Set<string>> {
    const rows = await this.prisma.testSeries.findMany({
      where: {
        kind: TEST_SERIES_KIND.FREE,
        OR: [
          { grants: { some: { studentId } } },
          { unlockRequests: { some: { studentId, status: UNLOCK_REQUEST_STATUS.PENDING } } },
        ],
      },
      select: { examStage: { select: { exam: { select: { code: true } } } } },
    });

    return new Set(
      rows
        .map((row) => row.examStage?.exam.code)
        .filter((code): code is string => code !== undefined),
    );
  }

  private openRequest(studentId: string, testSeriesId: string): Promise<RequestColumns | null> {
    return this.prisma.seriesUnlockRequest.findFirst({
      where: { studentId, testSeriesId, status: UNLOCK_REQUEST_STATUS.PENDING },
    });
  }
}

function toRequest(row: RequestColumns): SeriesUnlockRequest {
  return {
    id: row.id,
    studentId: row.studentId,
    testSeriesId: row.testSeriesId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedById: row.decidedById,
  };
}

function toRequestRow(row: RequestRow): SeriesUnlockRequestRow {
  return {
    ...toRequest(row),
    testSeries: row.testSeries,
    student: row.student,
  };
}

/** The filter INTERSECTS the caller's scope: `in: []` is how a branch outside it answers nothing. */
function narrowedTo(
  scope: BranchScope,
  branchId: string | undefined,
): { in: string[] } | undefined {
  const reachable = branchScopeWhere(scope);
  if (branchId === undefined) return reachable;
  return { in: reachable && !reachable.in.includes(branchId) ? [] : [branchId] };
}
