import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  UNLOCK_MODE,
  UNLOCK_REQUEST_STATUS,
  UNLOCK_STATE,
  TEST_SERIES_KIND,
  FREE_SERIES_FAMILY_CAP,
  type ExamFamily,
  type Paginated,
  type SeriesUnlockRequest,
  type SeriesUnlockRequestRow,
  type UnlockDecision,
  type UnlockRequestListQuery,
  type UnlockRequestStatus,
} from '@iace/contracts';
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
  async listRequests(query: UnlockRequestListQuery): Promise<Paginated<SeriesUnlockRequestRow>> {
    const where: Prisma.SeriesUnlockRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.testSeriesId ? { testSeriesId: query.testSeriesId } : {}),
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
  ): Promise<SeriesUnlockRequestRow> {
    const pending = await this.prisma.seriesUnlockRequest.findUnique({
      where: { id: requestId },
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
  /** Two ways to be askable: a REQUEST-mode series they reach, or a FREE one they do not. */
  private async assertRequestable(studentId: string, testSeriesId: string): Promise<void> {
    const { series } = await this.resolver.catalog(studentId);
    const reached = series.find((row) => row.id === testSeriesId);

    if (!reached) {
      await this.assertFreeAndUnderCap(studentId, testSeriesId);
      return;
    }
    if (reached.unlockMode !== UNLOCK_MODE.REQUEST) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'This series does not open by asking');
    }
    if (reached.unlockState === UNLOCK_STATE.UNLOCKED) {
      throw new AppException(ErrorCodes.CONFLICT, 'That series is already open to you');
    }
  }

  /** Askable unreached only when FREE, and only inside the cap — which pending asks count toward. */
  private async assertFreeAndUnderCap(studentId: string, testSeriesId: string): Promise<void> {
    const target = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { kind: true, examStage: { select: { exam: { select: { family: true } } } } },
    });
    if (target?.kind !== TEST_SERIES_KIND.FREE) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');
    }

    const family = target.examStage?.exam.family ?? null;
    const held = await this.familiesHeld(studentId);
    if (family !== null && held.has(family)) return;
    if (held.size < FREE_SERIES_FAMILY_CAP) return;

    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `Free tests run to ${FREE_SERIES_FAMILY_CAP} exam families. Ask the institute to open another.`,
    );
  }

  /** The families a student already holds a free series in, granted or still queued. */
  private async familiesHeld(studentId: string): Promise<Set<ExamFamily>> {
    const rows = await this.prisma.testSeries.findMany({
      where: {
        kind: TEST_SERIES_KIND.FREE,
        OR: [
          { grants: { some: { studentId } } },
          { unlockRequests: { some: { studentId, status: UNLOCK_REQUEST_STATUS.PENDING } } },
        ],
      },
      select: { examStage: { select: { exam: { select: { family: true } } } } },
    });

    return new Set(
      rows
        .map((row) => row.examStage?.exam.family)
        .filter((family): family is ExamFamily => family !== undefined && family !== null),
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
