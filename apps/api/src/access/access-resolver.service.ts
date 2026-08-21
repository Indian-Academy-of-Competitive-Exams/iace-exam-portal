import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  SERIES_AVAILABILITY,
  TEST_STATUS,
  UNLOCK_MODE,
  UNLOCK_STATE,
  type SeriesAvailability,
  type StudentCatalog,
  type StudentCatalogSeries,
  type UnlockMode,
  type UnlockState,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { DomainEventBus } from '../common/events';
import { applyAutoUnlocks, needsUnlock } from './auto-unlock';

/** A safety net under the event-driven busts, never the mechanism that keeps the catalog right. */
const CATALOG_TTL_SEC = 15 * 60;

/**
 * Bump on every change to `ResolvedCatalog`: the epochs survive a deploy, so without this a
 * payload the previous build wrote is read back as the new shape until its TTL runs out.
 */
const CATALOG_SHAPE = 'v1';

const catalogInclude = (branchId: string) =>
  ({
    examStage: { select: { id: true, name: true, exam: { select: { code: true } } } },
    prerequisiteSeries: { select: { name: true } },
    branchConfigs: { where: { branchId }, select: { startAt: true, endAt: true } },
    // The `access` → `Test` seam docs/03 §4 records: the tests module does not exist yet, so
    // there is no facade to ask and the read is made here.
    tests: {
      where: { test: { status: TEST_STATUS.ACTIVE } },
      select: { order: true, test: { select: { id: true, title: true } } },
    },
  }) as const satisfies Prisma.TestSeriesInclude;

type CatalogRow = Prisma.TestSeriesGetPayload<{ include: ReturnType<typeof catalogInclude> }>;

interface ResolvedTest {
  id: string;
  title: string | null;
  order: number | null;
}

/** What is cached: everything the clock does NOT decide. */
interface ResolvedSeries {
  id: string;
  name: string;
  description: string | null;
  examStage: { id: string; name: string; examCode: string } | null;
  programCode: string | null;
  isFree: boolean;
  sequentialTests: boolean;
  unlockMode: UnlockMode;
  unlockState: UnlockState;
  startAt: string | null;
  endAt: string | null;
  prerequisiteSeriesId: string | null;
  prerequisiteSeriesName: string | null;
  tests: ResolvedTest[];
}

interface ResolvedCatalog {
  testBlocked: boolean;
  series: ResolvedSeries[];
}

interface FreshCatalog {
  catalog: ResolvedCatalog;
  opened: boolean;
}

/**
 * The one place "can this student reach this?" is answered. A student reaches a series by an
 * explicit grant, a program match or an exam match, and every one of those is then gated by the
 * `BranchTestConfig` row for their branch.
 */
@Injectable()
export class AccessResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: DomainEventBus,
  ) {}

  /** The catalog as of `now` — availability and `canStart` are derived here on every read. */
  async catalog(studentId: string, now: Date = new Date()): Promise<StudentCatalog> {
    const resolved = await this.resolved(studentId);

    return {
      testBlocked: resolved.testBlocked,
      series: resolved.series.map((series) => project(series, resolved.testBlocked, now)),
    };
  }

  /**
   * The attempt-start guard: the catalog's own resolution, so the two cannot disagree, plus a
   * live re-read of the switches the cache cannot be trusted to have caught up with.
   */
  async assertCanStart(studentId: string, testId: string, now: Date = new Date()): Promise<void> {
    const [permitted, { series }] = await Promise.all([
      this.stillPermitted(studentId),
      this.catalog(studentId, now),
    ]);

    const startable =
      permitted &&
      series.some((row) => row.tests.some((test) => test.id === testId && test.canStart));
    if (!startable) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'This test is not open to you right now');
    }
  }

  async invalidateStudent(studentId: string): Promise<void> {
    await this.redis.client.incr(redisKeys.catalogStudentEpoch(studentId));
  }

  async invalidateAll(): Promise<void> {
    await this.redis.client.incr(redisKeys.catalogEpoch);
  }

  /**
   * A block or a deactivation must bite now, not when the entry expires — the cache bust is
   * best-effort, and this is an authorization answer, not the live-test hot path.
   */
  private async stillPermitted(studentId: string): Promise<boolean> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { isActive: true, isTestBlocked: true, deletedAt: true },
    });
    return student?.isActive === true && !student.isTestBlocked && student.deletedAt === null;
  }

  private async resolved(studentId: string): Promise<ResolvedCatalog> {
    const key = await this.catalogKey(studentId);

    const cached = await this.redis.getJson<ResolvedCatalog>(key);
    if (cached) return cached;

    const { catalog, opened } = await this.resolve(studentId);
    // An unlock this read performed busts the epoch `key` was built from, so the entry would be
    // dead the moment it was written — and the read that follows recomputes anyway.
    if (!opened) await this.redis.setJson(key, catalog, CATALOG_TTL_SEC);
    return catalog;
  }

  private async catalogKey(studentId: string): Promise<string> {
    const [epoch, studentEpoch] = await this.redis.client.mget(
      redisKeys.catalogEpoch,
      redisKeys.catalogStudentEpoch(studentId),
    );
    return redisKeys.studentCatalog(
      studentId,
      CATALOG_SHAPE,
      counterOf(epoch),
      counterOf(studentEpoch),
    );
  }

  private async resolve(studentId: string): Promise<FreshCatalog> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null, isActive: true },
      select: { isTestBlocked: true, currentBranchId: true, programs: true, enrolledExams: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const branchId = student.currentBranchId;
    // No branch, no access: the enable flag and the window both live on the branch's row.
    if (branchId === null) {
      return { catalog: { testBlocked: student.isTestBlocked, series: [] }, opened: false };
    }

    const rows = await this.prisma.testSeries.findMany({
      where: {
        branchConfigs: { some: { branchId, enabled: true } },
        OR: reachedBy(studentId, student.programs, student.enrolledExams),
      },
      include: catalogInclude(branchId),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    // Before the unlock state is read, so a series this call opens is UNLOCKED in this call.
    const opened = await applyAutoUnlocks(this.prisma, this.events, studentId, rows, new Date());
    const unlocked = await this.unlockedIds(studentId, rows);
    for (const id of opened) unlocked.add(id);

    return {
      catalog: {
        testBlocked: student.isTestBlocked,
        series: rows.map((row) => toResolved(row, unlocked)),
      },
      opened: opened.length > 0,
    };
  }

  private async unlockedIds(studentId: string, rows: CatalogRow[]): Promise<Set<string>> {
    const gated = rows.filter(needsUnlock).map((row) => row.id);
    if (gated.length === 0) return new Set();

    const unlocks = await this.prisma.studentSeriesUnlock.findMany({
      where: { studentId, testSeriesId: { in: gated }, unlockedAt: { not: null } },
      select: { testSeriesId: true },
    });
    return new Set(unlocks.map((row) => row.testSeriesId));
  }
}

/** A corrupt counter would otherwise make the key NaN — stable, so every later bust is a no-op. */
function counterOf(raw: string | null | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function reachedBy(
  studentId: string,
  programs: string[],
  enrolledExams: string[],
): Prisma.TestSeriesWhereInput[] {
  return [
    { grants: { some: { studentId } } },
    ...(programs.length > 0 ? [{ programCode: { in: programs } }] : []),
    // `programCode: null` is what makes a program-tagged series program-ONLY: an exam
    // enrolment alone must never open one.
    ...(enrolledExams.length > 0
      ? [{ programCode: null, examStage: { exam: { code: { in: enrolledExams } } } }]
      : []),
  ];
}

function toResolved(row: CatalogRow, unlocked: Set<string>): ResolvedSeries {
  const branchWindow = row.branchConfigs[0];
  const locked = needsUnlock(row) && !unlocked.has(row.id);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examStage: row.examStage
      ? { id: row.examStage.id, name: row.examStage.name, examCode: row.examStage.exam.code }
      : null,
    programCode: row.programCode,
    isFree: row.isFree,
    sequentialTests: row.sequentialTests,
    unlockMode: row.unlockMode,
    unlockState: locked ? UNLOCK_STATE.LOCKED : UNLOCK_STATE.UNLOCKED,
    startAt: branchWindow?.startAt?.toISOString() ?? null,
    endAt: branchWindow?.endAt?.toISOString() ?? null,
    prerequisiteSeriesId: row.prerequisiteSeriesId,
    prerequisiteSeriesName: row.prerequisiteSeries?.name ?? null,
    tests: row.tests
      .map((link) => ({ id: link.test.id, title: link.test.title, order: link.order }))
      .sort(byOrderThenId),
  };
}

function project(series: ResolvedSeries, testBlocked: boolean, now: Date): StudentCatalogSeries {
  const availability = availabilityAt(series, now);
  const canStart =
    availability === SERIES_AVAILABILITY.ACTIVE &&
    series.unlockState === UNLOCK_STATE.UNLOCKED &&
    !testBlocked;

  return {
    ...series,
    availability,
    canRequestUnlock:
      series.unlockState === UNLOCK_STATE.LOCKED && series.unlockMode === UNLOCK_MODE.REQUEST,
    tests: series.tests.map((test) => ({ ...test, canStart })),
  };
}

function availabilityAt(
  series: { startAt: string | null; endAt: string | null },
  now: Date,
): SeriesAvailability {
  const at = now.getTime();
  if (series.startAt !== null && Date.parse(series.startAt) > at) {
    return SERIES_AVAILABILITY.UPCOMING;
  }
  if (series.endAt !== null && Date.parse(series.endAt) <= at) {
    return SERIES_AVAILABILITY.ENDED;
  }
  return SERIES_AVAILABILITY.ACTIVE;
}

/** An unordered test sorts last, and the id keeps the order stable when two share one. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

function byOrderThenId(left: ResolvedTest, right: ResolvedTest): number {
  return (
    (left.order ?? ORDERED_LAST) - (right.order ?? ORDERED_LAST) || left.id.localeCompare(right.id)
  );
}
