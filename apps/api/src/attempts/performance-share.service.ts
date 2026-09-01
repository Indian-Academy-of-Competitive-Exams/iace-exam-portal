/**
 * Minting, revoking and reading the one unauthenticated door in the platform.
 *
 * Every refusal answers in the same words, so nothing is learnt from being told no, and
 * revocation and expiry are read before any report is loaded.
 */
import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PERFORMANCE_SCOPES,
  type CreatePerformanceShareInput,
  type PerformanceShare,
  type PerformanceShares,
  type ShareableSitting,
  type SharedReport,
} from '@iace/contracts';
import { AuditContext } from '../audit';
import { branchScopeWhere, type BranchScope } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { PerformanceAnalyticsService } from './performance.service';
import {
  newShareToken,
  shareCacheKey,
  shareExpiresAt,
  shareIsLive,
  sharedReportOf,
} from './performance-share';

/** One refusal for every way a link can fail, so nothing is learnt from being told no. */
const NO_SUCH_REPORT = 'This report is not available';
const NO_SUCH_SITTING = 'No such sitting';
const NO_SUCH_SHARE = 'No such shared report';
const NO_SUCH_STUDENT = 'No such student';
const TOO_MANY_READS = 'This report is being opened too often — try again in a minute';

/** How many sittings the share picker offers. Older than this and nobody is sharing it. */
const SHAREABLE_SITTING_CAP = 50;

/** Revoking drops the key, so this is only the backstop for expiry and for a DEL that never ran. */
const SHARED_REPORT_CACHE_SEC = 30;

/** What one link may cost Postgres per window. The cache serves the crowd; this caps the misses. */
const SHARED_REPORT_READ_CAP = 20;
const SHARED_REPORT_READ_WINDOW_SEC = 60;

const SHARE_SELECT = {
  id: true,
  token: true,
  attemptId: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  attempt: { select: { submittedAt: true, test: { select: { title: true } } } },
} as const;

interface ShareRow {
  id: string;
  token: string;
  attemptId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  attempt: { submittedAt: Date | null; test: { title: string | null } };
}

@Injectable()
export class PerformanceShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: PerformanceAnalyticsService,
    private readonly auditContext: AuditContext,
    private readonly redis: RedisService,
  ) {}

  /** The owner's view: their live and dead links, and the sittings a new one could open. */
  async list(
    studentId: string,
    scope: BranchScope,
    withToken: boolean,
  ): Promise<PerformanceShares> {
    const now = new Date();
    await this.requireStudent(studentId, scope);
    const [shares, sittings] = await Promise.all([
      this.prisma.performanceShare.findMany({
        where: { attempt: { studentId } },
        orderBy: { createdAt: 'desc' },
        select: SHARE_SELECT,
      }),
      this.prisma.attempt.findMany({
        where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
        orderBy: { submittedAt: { sort: 'desc', nulls: 'last' } },
        take: SHAREABLE_SITTING_CAP,
        select: { id: true, submittedAt: true, test: { select: { title: true } } },
      }),
    ]);

    return {
      shares: shares.map((row) => toShare(row, now, withToken)),
      sittings: sittings.map(toSitting),
    };
  }

  /** A student may only ever share a sitting of their own, and only one that has been marked. */
  async create(
    studentId: string,
    input: CreatePerformanceShareInput,
    createdByAdminId: string | null,
    scope: BranchScope,
  ): Promise<PerformanceShare> {
    const now = new Date();
    await this.requireStudent(studentId, scope);
    const sitting = await this.prisma.attempt.findFirst({
      where: { id: input.attemptId, studentId, status: ATTEMPT_STATUS.EVALUATED },
      select: { id: true },
    });
    if (!sitting) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SITTING);

    const share = await this.prisma.performanceShare.create({
      data: {
        token: newShareToken(),
        attemptId: sitting.id,
        createdByAdminId,
        expiresAt: shareExpiresAt(input.expiresOn, now),
      },
      select: SHARE_SELECT,
    });
    // A link has no life of its own in the log — it is filed against the student it publishes.
    this.auditContext.setEntityId(studentId);
    return toShare(share, now, true);
  }

  /** Either party may pull any link to this student's data; the FIRST revocation is the truth. */
  async revoke(studentId: string, shareId: string, scope: BranchScope): Promise<PerformanceShare> {
    const now = new Date();
    await this.requireStudent(studentId, scope);
    // `revokedAt: null` in the WHERE is what makes two revokes in flight settle on one date.
    await this.prisma.performanceShare.updateMany({
      where: { id: shareId, attempt: { studentId }, revokedAt: null },
      data: { revokedAt: now },
    });

    const share = await this.prisma.performanceShare.findFirst({
      where: { id: shareId, attempt: { studentId } },
      select: SHARE_SELECT,
    });
    if (!share) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_SHARE);
    // The cache must never outlive the revocation it would otherwise keep serving.
    await this.redis.del(redisKeys.sharedReport(shareCacheKey(share.token)));
    this.auditContext.setEntityId(studentId);
    return toShare(share, now, true);
  }

  /** Scoped, so a student at another branch is missing rather than merely unmodifiable. */
  private async requireStudent(studentId: string, scope: BranchScope): Promise<void> {
    const reachable = branchScopeWhere(scope);
    if (!reachable) return;
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null, currentBranchId: reachable },
      select: { id: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_STUDENT);
  }

  /** The public read. Nothing is loaded until the link has proved it is still open. */
  async readPublic(token: string): Promise<SharedReport> {
    const cacheKey = shareCacheKey(token);
    const cached = await this.redis.getJson<SharedReport>(redisKeys.sharedReport(cacheKey));
    if (cached) return cached;
    await this.assertUnderReadCap(cacheKey);

    const now = new Date();
    const share = await this.prisma.performanceShare.findUnique({
      where: { token },
      select: { attemptId: true, expiresAt: true, revokedAt: true },
    });
    if (!share || !shareIsLive(share, now)) {
      throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_REPORT);
    }

    const sitting = await this.prisma.attempt.findFirst({
      where: {
        id: share.attemptId,
        status: ATTEMPT_STATUS.EVALUATED,
        student: { deletedAt: null },
      },
      select: {
        id: true,
        studentId: true,
        submittedAt: true,
        student: {
          select: { fullName: true, currentBranch: { select: { name: true } } },
        },
      },
    });
    if (!sitting) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_REPORT);

    const report = await this.analytics.report(sitting.studentId, {
      scope: PERFORMANCE_SCOPES.ATTEMPT,
      attemptId: sitting.id,
    });

    const shared = sharedReportOf({
      report,
      studentName: sitting.student.fullName,
      branchName: sitting.student.currentBranch?.name ?? null,
      submittedAt: sitting.submittedAt?.toISOString() ?? null,
    });
    await this.redis.setJson(redisKeys.sharedReport(cacheKey), shared, SHARED_REPORT_CACHE_SEC);
    return shared;
  }

  /** A share link is designed to be pasted into a public group, so one link is the thing to cap. */
  private async assertUnderReadCap(cacheKey: string): Promise<void> {
    const key = redisKeys.sharedReportReads(cacheKey);
    const reads = await this.redis.client.incr(key);
    if (reads === 1) await this.redis.client.expire(key, SHARED_REPORT_READ_WINDOW_SEC);
    if (reads > SHARED_REPORT_READ_CAP) {
      throw new AppException(ErrorCodes.RATE_LIMITED, TOO_MANY_READS);
    }
  }
}

function toShare(row: ShareRow, now: Date, withToken: boolean): PerformanceShare {
  return {
    id: row.id,
    token: withToken ? row.token : null,
    attemptId: row.attemptId,
    testTitle: row.attempt.test.title,
    submittedAt: row.attempt.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    isLive: shareIsLive(row, now),
  };
}

function toSitting(row: {
  id: string;
  submittedAt: Date | null;
  test: { title: string | null };
}): ShareableSitting {
  return {
    attemptId: row.id,
    testTitle: row.test.title,
    submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}
