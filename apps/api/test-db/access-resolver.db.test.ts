import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  DEFAULT_EXAM_COURSE,
  EXAM_COURSE,
  ErrorCodes,
  STUDENT_SERIES_SOURCE,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  TEST_STATUS,
  testSeriesListQuerySchema,
  type AttemptStatus,
  type StudentCatalog,
  type TestSeriesKind,
  type TestStatus,
} from '@iace/contracts';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { ProgramsService } from '../src/access/programs.service';
import { StudentGrantsService } from '../src/access/student-grants.service';
import { TestSeriesService } from '../src/access/test-series.service';
import { AuditContext, AuditService } from '../src/audit';
import { ExamStagesService } from '../src/configs';
import { NotificationsService } from '../src/notifications/notifications.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeEventBus, FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  makeBranch,
  makeCatalog,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
  type Catalog,
  type StudentOverrides,
} from './support/database';

const COURSE = DEFAULT_EXAM_COURSE;
const PROGRAM = 'SSC CGL FOUNDATION';
const OTHER_PROGRAM = 'SSC CHSL FOUNDATION';
const NOW = new Date('2026-06-01T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface Place {
  catalog: Catalog;
  branch: string;
  event: string;
}

/** A stage on the course, a branch, both programs and one event — what every series below hangs off. */
async function place(): Promise<Place> {
  const catalog = await makeCatalog(prisma);
  const branch = (await makeBranch(prisma)).id;
  await prisma.program.createMany({
    data: [PROGRAM, OTHER_PROGRAM].map((code) => ({ code, name: code })),
  });
  const event = await prisma.event.create({ data: { name: 'Scholarship test' } });
  return { catalog, branch, event: event.id };
}

interface SeriesOverrides {
  name?: string;
  kind?: TestSeriesKind;
  branchIds?: string[];
  isEnabled?: boolean;
  sequentialTests?: boolean;
}

/** A switched-on series of the kind asked for, carrying exactly what its kind's CHECK demands. */
async function series(at: Place, over: SeriesOverrides = {}): Promise<string> {
  const kind = over.kind ?? TEST_SERIES_KIND.STANDARD;
  const row = await prisma.testSeries.create({
    data: {
      id: uid(),
      name: over.name ?? `${kind} series`,
      kind,
      examStageId: at.catalog.examStageId,
      isEnabled: over.isEnabled ?? true,
      sequentialTests: over.sequentialTests ?? false,
      branchIds: over.branchIds ?? (kind === TEST_SERIES_KIND.STANDARD ? [at.branch] : []),
      programCode: kind === TEST_SERIES_KIND.PROGRAM ? PROGRAM : null,
      eventId: kind === TEST_SERIES_KIND.EVENT ? at.event : null,
    },
    select: { id: true },
  });
  return row.id;
}

const testIn = async (
  at: Place,
  seriesId: string,
  seriesOrder: number,
  over: { status?: TestStatus; opensAt?: Date | null } = {},
) =>
  (
    await makeTest(
      prisma,
      { ...at.catalog, testSeriesId: seriesId },
      { status: TEST_STATUS.ACTIVE, seriesOrder, ...over },
    )
  ).id;

const studentAt = async (at: Place, over: StudentOverrides = {}) =>
  (await makeStudent(prisma, { currentBranchId: at.branch, enrolledCourses: [COURSE], ...over }))
    .id;

/** A student at a branch on the course, one STANDARD series that branch runs, one ACTIVE test in it. */
async function reachable() {
  const at = await place();
  const seriesId = await series(at);
  const testId = await testIn(at, seriesId, 1);
  const student = await studentAt(at);
  return { at, seriesId, testId, student };
}

const resolverOn = (client: PrismaService = prisma) =>
  new AccessResolverService(client, new FakeRedis().asService());

const seriesIds = (catalog: StudentCatalog) => catalog.series.map((row) => row.id);

/** How many times the shared copy was built: the one read that is not per student. */
const builds = (calls: readonly string[]) =>
  calls.filter((call) => call === 'testSeries.findMany').length;

const reached = async (student: string) => seriesIds(await resolverOn().catalog(student, NOW));

const refused = async (attempt: Promise<unknown>, code: string) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  assert.equal(error.code, code);
};

/** The real client, with every model call it makes named, and a hook run before each one lands. */
function watched() {
  const calls: string[] = [];
  const hook: { before: ((call: string) => Promise<void>) | null } = { before: null };
  const client = new Proxy(prisma, {
    get(target, model: string | symbol) {
      const delegate = Reflect.get(target, model) as unknown;
      if (typeof model !== 'string' || model.startsWith('$') || model.startsWith('_')) {
        return delegate;
      }
      if (typeof delegate !== 'object' || delegate === null) return delegate;
      return new Proxy(delegate, {
        get(inner, method: string | symbol) {
          const member = Reflect.get(inner, method) as unknown;
          if (typeof method !== 'string' || typeof member !== 'function') return member;
          return async (...args: unknown[]) => {
            const call = `${model}.${method}`;
            calls.push(call);
            await hook.before?.(call);
            return member.apply(inner, args) as unknown;
          };
        },
      });
    },
  });
  return { client, calls, hook, resolver: resolverOn(client) };
}

describe('AccessResolverService — how a series is reached', () => {
  it('reaches a STANDARD series only at a branch that runs it', async () => {
    const { at, seriesId, student } = await reachable();
    const elsewhere = await studentAt(at, { currentBranchId: (await makeBranch(prisma)).id });

    assert.deepEqual(await reached(student), [seriesId]);
    assert.deepEqual(await reached(elsewhere), []);
  });

  /** The mirror of the branch arm: the centre runs it, but this student is not on that course. */
  it('gives a STANDARD series to nobody outside its course', async () => {
    const { at } = await reachable();
    const banking = await studentAt(at, { enrolledCourses: [EXAM_COURSE.BANKING] });

    assert.deepEqual(await reached(banking), []);
  });

  it('gives a student with no branch nothing on a course match', async () => {
    const { at } = await reachable();

    assert.deepEqual(await reached(await studentAt(at, { currentBranchId: null })), []);
  });

  /** FREE is the platform's shop window: no branch, no course, no program, and still reached. */
  it('reaches a FREE series with no enrolment at all', async () => {
    const at = await place();
    const free = await series(at, { kind: TEST_SERIES_KIND.FREE });
    const outsider = await studentAt(at, { currentBranchId: null, enrolledCourses: [] });

    assert.deepEqual(await reached(outsider), [free]);
  });

  /** THE failure this prevents: a PROGRAM series opened on a course match hands a paid cohort's papers to everyone on that exam. */
  it('reaches a PROGRAM series only while the student carries the program', async () => {
    const at = await place();
    const program = await series(at, { kind: TEST_SERIES_KIND.PROGRAM });

    assert.deepEqual(await reached(await studentAt(at, { programs: [PROGRAM] })), [program]);
    assert.deepEqual(await reached(await studentAt(at, { programs: [OTHER_PROGRAM] })), []);
    assert.deepEqual(await reached(await studentAt(at, { programs: [] })), []);
  });

  /** An event intake names its sitters; being on the course at the branch is not being named. */
  it('reaches an EVENT series only as a candidate on its event', async () => {
    const at = await place();
    const event = await series(at, { kind: TEST_SERIES_KIND.EVENT });
    const candidate = await studentAt(at);
    const bystander = await studentAt(at);
    await prisma.eventCandidate.create({ data: { eventId: at.event, studentId: candidate } });

    assert.deepEqual(await reached(candidate), [event]);
    assert.deepEqual(await reached(bystander), []);
  });

  it('lets a grant override every kind', async () => {
    const at = await place();
    const outsider = await studentAt(at, { currentBranchId: null, enrolledCourses: [] });
    const granted: string[] = [];
    for (const kind of TEST_SERIES_KINDS) {
      const id = await series(at, { kind, name: kind, branchIds: [] });
      await prisma.studentGrant.create({ data: { studentId: outsider, testSeriesId: id } });
      granted.push(id);
    }

    assert.deepEqual((await reached(outsider)).toSorted(), granted.toSorted());
  });

  /** THE failure this prevents: a series pulled out of service still reaching its grantees. */
  it('reaches nothing in a series nobody switched on', async () => {
    const at = await place();
    const off = await series(at, { isEnabled: false });
    const student = await studentAt(at);
    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: off } });

    assert.deepEqual(await reached(student), []);
  });

  it('treats a soft-deleted student as one that is not there', async () => {
    const { at } = await reachable();
    const gone = await studentAt(at, { deletedAt: new Date('2026-05-01T00:00:00.000Z') });

    await refused(resolverOn().catalog(gone, NOW), ErrorCodes.NOT_FOUND);
  });

  /** Deactivation takes the platform away, so it has to take the catalog with it. */
  it('treats a deactivated student as one that is not there', async () => {
    const { at } = await reachable();
    const off = await studentAt(at, { isActive: false });

    await refused(resolverOn().catalog(off, NOW), ErrorCodes.NOT_FOUND);
  });

  it('never shows a test that is not ACTIVE', async () => {
    const { at, seriesId, testId, student } = await reachable();
    await testIn(at, seriesId, 2, { status: TEST_STATUS.DRAFT });
    await testIn(at, seriesId, 3, { status: TEST_STATUS.INACTIVE });

    const catalog = await resolverOn().catalog(student, NOW);

    assert.deepEqual(
      catalog.series[0]?.tests.map((test) => test.id),
      [testId],
    );
  });
});

describe('AccessResolverService — a blocked student', () => {
  /** Blocked is view-only, not invisible: the student still sees the journey they are on. */
  it('still lists everything, with nothing startable, and is refused at the start guard', async () => {
    const { at, seriesId, testId } = await reachable();
    const blocked = await studentAt(at, { isTestBlocked: true });
    const resolver = resolverOn();

    const catalog = await resolver.catalog(blocked, NOW);

    assert.equal(catalog.testBlocked, true);
    assert.deepEqual(seriesIds(catalog), [seriesId]);
    assert.ok(catalog.series[0]?.tests.every((test) => !test.canStart));
    await refused(resolver.assertCanStart(blocked, testId, NOW), ErrorCodes.FORBIDDEN);
  });
});

describe('AccessResolverService — when a test opens', () => {
  const testAt = async (opensAt: Date | null) => {
    const at = await place();
    const seriesId = await series(at);
    await testIn(at, seriesId, 1, { opensAt });
    return (await resolverOn().catalog(await studentAt(at), NOW)).series[0]?.tests[0];
  };

  it('is listed but not startable before it opens', async () => {
    const test = await testAt(new Date('2026-07-01T00:00:00.000Z'));

    assert.equal(test?.canStart, false);
    assert.equal(test?.opensAt, '2026-07-01T00:00:00.000Z');
  });

  it('is startable once it has opened, and at the exact instant it opens', async () => {
    assert.equal((await testAt(new Date('2026-05-01T00:00:00.000Z')))?.canStart, true);
    await resetDatabase(prisma);
    assert.equal((await testAt(NOW))?.canStart, true);
  });

  /** The failure this prevents: a series with no times set locking every student out of it. */
  it('is startable at any time when nothing schedules it', async () => {
    const test = await testAt(null);

    assert.equal(test?.canStart, true);
    assert.equal(test?.opensAt, null);
  });

  /** The guarantee the model rests on: an opened test stays startable however long ago it opened. */
  it('stays startable long after it opened, because nothing shuts it', async () => {
    assert.equal((await testAt(new Date('2020-01-01T00:00:00.000Z')))?.canStart, true);
  });
});

describe('AccessResolverService — when a test opens for one program', () => {
  const OPENS = new Date('2026-07-01T00:00:00.000Z');
  const EARLY = new Date('2026-05-01T00:00:00.000Z');
  const EARLIER = new Date('2026-04-01T00:00:00.000Z');

  /** One test opening in July, with the program openings given; seen by each set of programs. */
  const seenBy = async (unlocks: Record<string, Date>, ...holdings: string[][]) => {
    const at = await place();
    const seriesId = await series(at);
    const testId = await testIn(at, seriesId, 1, { opensAt: OPENS });
    await prisma.testProgramUnlock.createMany({
      data: Object.entries(unlocks).map(([programCode, opensAt]) => ({
        testId,
        programCode,
        opensAt,
      })),
    });
    const seen = [];
    for (const programs of holdings) {
      const student = await studentAt(at, { programs });
      seen.push((await resolverOn().catalog(student, NOW)).series[0]?.tests[0]);
    }
    return seen;
  };

  /** THE failure this prevents: one cohort's early sitting opening the paper for everybody. */
  it('opens a test early for a program holder and for nobody else', async () => {
    const [holder, outsider] = await seenBy({ [PROGRAM]: EARLY }, [PROGRAM], []);

    assert.deepEqual([holder?.opensAt, holder?.canStart], [EARLY.toISOString(), true]);
    assert.deepEqual([outsider?.opensAt, outsider?.canStart], [OPENS.toISOString(), false]);
  });

  it('takes the earliest opening when the student holds two programs', async () => {
    const [both] = await seenBy({ [PROGRAM]: EARLY, [OTHER_PROGRAM]: EARLIER }, [
      PROGRAM,
      OTHER_PROGRAM,
    ]);

    assert.equal(both?.opensAt, EARLIER.toISOString());
  });
});

describe('AccessResolverService — what the paper is', () => {
  /** THE failure this prevents: an unstartable test must not blank out what the paper itself is. */
  it('reports duration, sections, questions and marks though it cannot be started yet', async () => {
    const at = await place();
    await prisma.baseConfig.update({
      where: { id: at.catalog.baseConfigId },
      data: { durationSec: 5400 },
    });
    await prisma.baseConfigSection.create({
      data: {
        id: uid(),
        baseConfigId: at.catalog.baseConfigId,
        name: 'General Intelligence',
        order: 1,
        questionCount: 90,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
    });
    const seriesId = await series(at);
    await testIn(at, seriesId, 1, { opensAt: new Date('2027-05-01T00:00:00.000Z') });

    const test = (await resolverOn().catalog(await studentAt(at), NOW)).series[0]?.tests[0];

    assert.equal(test?.canStart, false);
    assert.deepEqual([test?.durationSec, test?.sectionCount, test?.totalQuestions], [5400, 1, 90]);
  });
});

describe('AccessResolverService.assertCanStart', () => {
  it('passes for an active, unlocked test the student reaches', async () => {
    const { student, testId } = await reachable();

    await assert.doesNotReject(() => resolverOn().assertCanStart(student, testId, NOW));
  });

  /** The guard and the catalog share one resolution, so they can never disagree. */
  it('refuses a test that is in no series the student reaches', async () => {
    const { at, testId } = await reachable();
    const elsewhere = await studentAt(at, { currentBranchId: (await makeBranch(prisma)).id });

    await refused(resolverOn().assertCanStart(elsewhere, testId, NOW), ErrorCodes.FORBIDDEN);
  });

  /** THE failure this prevents: a just-blocked student starting tests because a bump went missing. */
  it('refuses the moment a block or a deactivation lands, with nothing bumped', async () => {
    const { student, testId } = await reachable();
    const resolver = resolverOn();
    await resolver.assertCanStart(student, testId, NOW);

    for (const change of [{ isTestBlocked: true }, { isTestBlocked: false, isActive: false }]) {
      await prisma.student.update({ where: { id: student }, data: change });
      await refused(resolver.assertCanStart(student, testId, NOW), ErrorCodes.FORBIDDEN);
    }
  });
});

describe('AccessResolverService — the read path', () => {
  /** THE failure this prevents: a catalog GET that opens a series is a write on the hot read path. */
  it('reads a catalog without writing anything', async () => {
    const { student } = await reachable();
    const { calls, resolver } = watched();

    await resolver.catalog(student, NOW);

    assert.ok(calls.length > 0);
    assert.deepEqual(
      calls.filter((call) => /\.(create|update|upsert|delete)/.test(call)),
      [],
    );
  });
});

describe('AccessResolverService — the shared copy', () => {
  it('reads the series once, however many students and reads follow', async () => {
    const { at, student } = await reachable();
    const other = await studentAt(at);
    const { calls, resolver } = watched();

    await resolver.catalog(student, NOW);
    await resolver.catalog(student, NOW);
    await resolver.catalog(other, NOW);

    assert.equal(builds(calls), 1);
  });

  /** A series-wide change is one INCR: the next read rebuilds once for every student, not once each. */
  it('rebuilds once after a bump, not once per student', async () => {
    const { at, student } = await reachable();
    const other = await studentAt(at);
    const { calls, resolver } = watched();
    await resolver.catalog(student, NOW);

    await resolver.invalidateAll();
    await resolver.catalog(student, NOW);
    await resolver.catalog(other, NOW);

    assert.equal(builds(calls), 2);
  });

  /** THE race a held copy must survive: a bump landing mid-build must not leave that build in charge. */
  it('honours a bump that lands while the copy is being built', async () => {
    const { student, seriesId } = await reachable();
    const { hook, resolver } = watched();
    hook.before = async (call) => {
      if (call !== 'testSeries.findMany') return;
      hook.before = null;
      await resolver.invalidateAll();
    };

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), [seriesId]);
    await prisma.testSeries.update({ where: { id: seriesId }, data: { isEnabled: false } });

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), []);
  });

  /** THE failure this prevents: a Valkey reset leaving every process on its old copy through the next bump. */
  it('rebuilds after a bump even when the counter went backwards', async () => {
    const { student, seriesId } = await reachable();
    const redis = new FakeRedis();
    const resolver = new AccessResolverService(prisma, redis.asService());
    await redis.client.set(redisKeys.catalogEpoch, '42');
    await resolver.catalog(student, NOW);

    await redis.client.del(redisKeys.catalogEpoch);
    await prisma.testSeries.update({ where: { id: seriesId }, data: { isEnabled: false } });
    await resolver.invalidateAll();

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), []);
  });

  /** THE failure this prevents: a Valkey blip 500ing the catalog, the paper and the start guard at once. */
  it('serves the held copy when the counter cannot be read at all', async () => {
    const { student, seriesId, testId } = await reachable();
    const redis = new FakeRedis();
    const resolver = new AccessResolverService(prisma, redis.asService());
    await resolver.catalog(student, NOW);
    redis.client.get = () => Promise.reject(new Error('Valkey is unreachable'));

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), [seriesId]);
    await assert.doesNotReject(() => resolver.assertCanStart(student, testId, NOW));
  });

  /** Nothing per student is held, so nothing per student has to be bumped. */
  it('shows a student’s own grant and sitting on the next read, with nothing bumped', async () => {
    const { at, student, testId } = await reachable();
    const elsewhere = await series(at, { name: 'Granted series', branchIds: [uid()] });
    const resolver = resolverOn();
    await resolver.catalog(student, NOW);

    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: elsewhere } });
    await prisma.attempt.create({
      data: {
        id: uid(),
        testId,
        studentId: student,
        attemptNo: 1,
        status: ATTEMPT_STATUS.SUBMITTED,
        startedAt: NOW,
        endsAt: new Date(NOW.getTime() + HOUR_MS),
        submittedAt: NOW,
        shuffleSeed: 1,
      },
    });
    const catalog = await resolver.catalog(student, NOW);

    assert.ok(seriesIds(catalog).includes(elsewhere));
    const sat = catalog.series.flatMap((row) => row.tests).find((test) => test.id === testId);
    assert.equal(sat?.attemptStatus, ATTEMPT_STATUS.SUBMITTED);
  });

  /** The safety net: a write that changes a held field without bumping lasts one max age, not forever. */
  it('rebuilds a copy older than its max age, bump or no bump', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
    const { student, seriesId } = await reachable();
    const resolver = resolverOn();
    await resolver.catalog(student, NOW);
    await prisma.testSeries.update({ where: { id: seriesId }, data: { name: 'Renamed' } });

    const held = await resolver.catalog(student, NOW);
    context.mock.timers.tick(15 * 60 * 1000);
    const rebuilt = await resolver.catalog(student, NOW);

    assert.equal(held.series[0]?.name, 'STANDARD series');
    assert.equal(rebuilt.series[0]?.name, 'Renamed');
  });

  /** WHY the clock is not held: one copy must answer not-yet before the opening time and open after it. */
  it('crosses an opening time on a copy that never changed', async () => {
    const at = await place();
    const opensAt = new Date('2026-06-15T00:00:00.000Z');
    await testIn(at, await series(at), 1, { opensAt });
    const student = await studentAt(at);
    const { calls, resolver } = watched();

    const before = await resolver.catalog(student, new Date(opensAt.getTime() - HOUR_MS));
    const later = await resolver.catalog(student, new Date(opensAt.getTime() + HOUR_MS));

    assert.equal(before.series[0]?.tests[0]?.canStart, false);
    assert.equal(later.series[0]?.tests[0]?.canStart, true);
    assert.equal(builds(calls), 1);
  });
});

describe('AccessCacheListener', () => {
  it('bumps every process on access.catalog_changed and on exam_stage.changed', async () => {
    const { at, student, seriesId } = await reachable();
    const { calls, resolver } = watched();
    const listener = new AccessCacheListener(resolver);
    await resolver.catalog(student, NOW);

    await listener.onCatalogChanged({ testSeriesId: seriesId });
    await resolver.catalog(student, NOW);
    await listener.onExamStageChanged({ examStageId: at.catalog.examStageId });
    await resolver.catalog(student, NOW);

    assert.equal(builds(calls), 3);
  });
});

describe('AccessResolverService — a series that unlocks in order', () => {
  /** Three tests in a series that unlocks in order, and the sittings given, by test index. */
  const inOrder = async (sittings: readonly [number, AttemptStatus][] = []) => {
    const at = await place();
    const seriesId = await series(at, { sequentialTests: true });
    const tests = [
      await testIn(at, seriesId, 1),
      await testIn(at, seriesId, 2),
      await testIn(at, seriesId, 3),
    ];
    const student = await studentAt(at);
    const taken = new Map<number, number>();
    for (const [index, status] of sittings) {
      const attemptNo = (taken.get(index) ?? 0) + 1;
      taken.set(index, attemptNo);
      await prisma.attempt.create({
        data: {
          id: uid(),
          testId: tests[index] ?? '',
          studentId: student,
          attemptNo,
          // `Attempt_graded_per_test_key`: the first sitting holds the ranked slot, so a retake is ungraded.
          isGraded: attemptNo === 1,
          status,
          startedAt: NOW,
          endsAt: new Date(NOW.getTime() + HOUR_MS),
          shuffleSeed: 1,
          ...(status === ATTEMPT_STATUS.IN_PROGRESS ? {} : { submittedAt: NOW }),
        },
      });
    }
    return { student, tests, resolver: resolverOn() };
  };

  const startable = async (sittings: readonly [number, AttemptStatus][] = []) => {
    const { student, resolver } = await inOrder(sittings);
    return (await resolver.catalog(student, NOW)).series[0]?.tests.map((test) => test.canStart);
  };

  /** The failure this prevents: a flag on screen saying "in order" while every test is open. */
  it('opens the first and holds the rest', async () => {
    assert.deepEqual(await startable(), [true, false, false]);
  });

  it('opens the next one once its predecessor has been sat', async () => {
    assert.deepEqual(await startable([[0, ATTEMPT_STATUS.SUBMITTED]]), [true, true, false]);
  });

  it('counts an evaluated sitting as sat, and leaves nothing shut once all are', async () => {
    const all = [0, 1, 2].map((index): [number, AttemptStatus] => [
      index,
      ATTEMPT_STATUS.EVALUATED,
    ]);

    assert.deepEqual(await startable(all), [true, true, true]);
  });

  it('does not count a sitting still in progress', async () => {
    assert.deepEqual(await startable([[0, ATTEMPT_STATUS.IN_PROGRESS]]), [true, false, false]);
  });

  /** THE failure this prevents: a retake of test 1 shutting test 2 again, because the newest sitting is not sat. */
  it('keeps the next one open while a sat test is being retaken', async () => {
    const { student, resolver } = await inOrder([
      [0, ATTEMPT_STATUS.EVALUATED],
      [0, ATTEMPT_STATUS.IN_PROGRESS],
    ]);

    const tests = (await resolver.catalog(student, NOW)).series[0]?.tests ?? [];

    assert.deepEqual(
      tests.map((test) => test.canStart),
      [true, true, false],
    );
    assert.equal(tests[0]?.attemptStatus, ATTEMPT_STATUS.IN_PROGRESS);
  });

  it('holds nothing back when the series does not unlock in order', async () => {
    const { at, seriesId, student } = await reachable();
    await testIn(at, seriesId, 2);

    const catalog = await resolverOn().catalog(student, NOW);

    assert.deepEqual(
      catalog.series[0]?.tests.map((test) => test.canStart),
      [true, true],
    );
  });

  it('refuses one still waiting its turn at the start guard', async () => {
    const { student, tests, resolver } = await inOrder();

    await refused(resolver.assertCanStart(student, tests[1] ?? '', NOW), ErrorCodes.FORBIDDEN);
  });

  /** The failure this prevents: the guard's own projection drifting from the catalog the screen read. */
  it('answers exactly what the catalog says for every test in the series', async () => {
    const { student, tests, resolver } = await inOrder([[0, ATTEMPT_STATUS.EVALUATED]]);
    const catalog = await resolver.catalog(student, NOW);
    const said = new Map(
      (catalog.series[0]?.tests ?? []).map((test) => [test.id, test.canStart] as const),
    );

    const gated = await Promise.all(
      tests.map((testId) =>
        resolver.assertCanStart(student, testId, NOW).then(
          () => true,
          () => false,
        ),
      ),
    );

    assert.deepEqual(gated, [true, true, false]);
    assert.deepEqual(
      gated,
      tests.map((testId) => said.get(testId)),
    );
  });
});

describe('reading about a test', () => {
  it('opens a test in a series the student reaches', async () => {
    const { student, testId } = await reachable();

    await assert.doesNotReject(resolverOn().reachableTest(student, testId));
  });

  /** Reachable is not startable: the brief is what a student reads BEFORE a test opens. */
  it('opens one that has not opened yet, which the start guard still refuses', async () => {
    const at = await place();
    const seriesId = await series(at);
    const later = await testIn(at, seriesId, 1, { opensAt: new Date(NOW.getTime() + HOUR_MS) });
    const student = await studentAt(at);

    await resolverOn().reachableTest(student, later);
    await refused(resolverOn().assertCanStart(student, later, NOW), ErrorCodes.FORBIDDEN);
  });

  it('reads a test in a series the student does not reach as missing', async () => {
    const at = await place();
    const elsewhere = await series(at, { branchIds: [uid()] });
    const testId = await testIn(at, elsewhere, 1);
    const student = await studentAt(at);

    await refused(resolverOn().reachableTest(student, testId), ErrorCodes.NOT_FOUND);
  });

  /** The bug this prevents: a drafted paper readable because only the catalog filtered on status. */
  it('reads a test that is not ACTIVE as missing, however reachable its series', async () => {
    const at = await place();
    const seriesId = await series(at);
    const drafted = await testIn(at, seriesId, 1, { status: TEST_STATUS.DRAFT });
    const student = await studentAt(at);

    await refused(resolverOn().reachableTest(student, drafted), ErrorCodes.NOT_FOUND);
  });

  it('reads everything in a switched-off series as missing', async () => {
    const at = await place();
    const off = await series(at, { isEnabled: false });
    const testId = await testIn(at, off, 1);
    const student = await studentAt(at);

    await refused(resolverOn().reachableTest(student, testId), ErrorCodes.NOT_FOUND);
  });

  /** A grant overrides the kind, reading about a test exactly as it does sitting one. */
  it('opens a granted series the student reaches no other way', async () => {
    const at = await place();
    const elsewhere = await series(at, { branchIds: [uid()] });
    const testId = await testIn(at, elsewhere, 1);
    const student = await studentAt(at);
    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: elsewhere } });

    await assert.doesNotReject(resolverOn().reachableTest(student, testId));
  });

  it('reads everything as missing for a student who is no longer active', async () => {
    const { student, testId } = await reachable();
    await prisma.student.update({ where: { id: student }, data: { isActive: false } });

    await refused(resolverOn().reachableTest(student, testId), ErrorCodes.NOT_FOUND);
  });
});

/** The mirror of `seriesSources`: everyone counted here reaches the series the other way, and can sit it. */
describe('AccessResolverService.audienceCount', () => {
  const counted = (seriesId: string) => resolverOn().audienceCount(seriesId);

  it('counts the students a standard series reaches and nobody else', async () => {
    const at = await place();
    const seriesId = await series(at);
    const inside = await studentAt(at);
    await studentAt(at, { currentBranchId: (await makeBranch(prisma)).id });
    await studentAt(at, { enrolledCourses: [] });

    assert.equal(await counted(seriesId), 1);
    assert.deepEqual(await reached(inside), [seriesId]);
  });

  it('counts every student for a free series', async () => {
    const at = await place();
    const seriesId = await series(at, { kind: TEST_SERIES_KIND.FREE, branchIds: [] });
    await studentAt(at);
    await studentAt(at, { currentBranchId: null, enrolledCourses: [] });

    assert.equal(await counted(seriesId), 2);
    // The fan-out reads the same mirror: an empty OR member once emptied every free series' roster.
    assert.equal((await resolverOn().studentsReaching(seriesId)).length, 2);
  });

  it('counts only the students carrying a program series program', async () => {
    const at = await place();
    const seriesId = await series(at, { kind: TEST_SERIES_KIND.PROGRAM });
    const carrying = await studentAt(at, { programs: [PROGRAM] });
    await studentAt(at, { programs: [OTHER_PROGRAM] });

    assert.equal(await counted(seriesId), 1);
    assert.deepEqual(await reached(carrying), [seriesId]);
  });

  it('counts an event series roster and nobody off it', async () => {
    const at = await place();
    const seriesId = await series(at, { kind: TEST_SERIES_KIND.EVENT });
    const candidate = await studentAt(at);
    await studentAt(at);
    await prisma.eventCandidate.create({ data: { eventId: at.event, studentId: candidate } });

    assert.equal(await counted(seriesId), 1);
    assert.deepEqual(await reached(candidate), [seriesId]);
  });

  it('counts a granted student a series reaches no other way', async () => {
    const at = await place();
    const elsewhere = await series(at, { branchIds: [uid()] });
    const student = await studentAt(at);
    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: elsewhere } });

    assert.equal(await counted(elsewhere), 1);
  });

  /** The switch is not the cohort: a series switched off has the same students waiting behind it. */
  it('counts the cohort of a series nobody switched on', async () => {
    const at = await place();
    const off = await series(at, { isEnabled: false });
    await studentAt(at);

    assert.equal(await counted(off), 1);
    assert.equal((await resolverOn().studentsReaching(off)).length, 0);
  });

  it('leaves out a soft-deleted student and a deactivated one', async () => {
    const at = await place();
    const seriesId = await series(at);
    await studentAt(at, { deletedAt: new Date() });
    await studentAt(at, { isActive: false });

    assert.equal(await counted(seriesId), 0);
  });

  /** THE failure this prevents: a blocked student in the admin's reach figure, told a test they cannot sit is open. */
  it('leaves out a student blocked from sitting tests', async () => {
    const at = await place();
    const seriesId = await series(at);
    const free = await series(at, { kind: TEST_SERIES_KIND.FREE, branchIds: [] });
    await studentAt(at, { isTestBlocked: true });

    assert.equal(await counted(seriesId), 0);
    assert.deepEqual(await resolverOn().studentsReaching(free), []);
  });
});

/** The admin page and the grant picker read the resolver's own rule, so they cannot drift from what the student sees. */
describe('what an admin reads a student reaching', () => {
  const grantsOn = () =>
    new StudentGrantsService(
      prisma,
      new AuditContext(),
      new NotificationsService(prisma),
      new AuditService(prisma, new FakeStorage() as never),
      resolverOn(),
    );

  const pickerFor = async (studentId: string) => {
    const auditContext = new AuditContext();
    const events = new FakeEventBus().asService();
    const service = new TestSeriesService(
      prisma,
      new ExamStagesService(prisma, auditContext, events),
      new ProgramsService(prisma, auditContext),
      resolverOn(),
      auditContext,
      events,
    );
    const page = await service.list(
      testSeriesListQuerySchema.parse({ pageSize: '100', notReachedBy: studentId }),
    );
    return page.items.map((row) => row.id).toSorted();
  };

  it('lists the series the catalog lists, each with the route that reaches it', async () => {
    const at = await place();
    const standard = await series(at, { name: 'A standard' });
    const program = await series(at, { name: 'B program', kind: TEST_SERIES_KIND.PROGRAM });
    const event = await series(at, { name: 'C event', kind: TEST_SERIES_KIND.EVENT });
    const granted = await series(at, { name: 'D granted', branchIds: [uid()] });
    const elsewhere = await series(at, { name: 'E elsewhere', branchIds: [uid()] });
    const off = await series(at, { name: 'F off', isEnabled: false });
    const student = await studentAt(at, { programs: [PROGRAM] });
    await prisma.eventCandidate.create({ data: { eventId: at.event, studentId: student } });
    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: granted } });

    const admin = await grantsOn().reachedSeries(student);

    assert.deepEqual(
      admin.map((row) => row.id),
      await reached(student),
    );
    assert.deepEqual(
      admin.map((row) => [row.id, row.sources]),
      [
        [standard, [STUDENT_SERIES_SOURCE.COURSE]],
        [program, [STUDENT_SERIES_SOURCE.PROGRAM]],
        [event, [STUDENT_SERIES_SOURCE.EVENT]],
        [granted, [STUDENT_SERIES_SOURCE.GRANT]],
      ],
    );
    assert.deepEqual(
      admin.filter((row) => row.grantedAt !== null).map((row) => row.id),
      [granted],
    );
    assert.deepEqual(
      await pickerFor(student),
      [elsewhere, off, at.catalog.testSeriesId].toSorted(),
    );
  });

  /** Deactivation empties the student's own catalog; the admin deciding whether to reactivate them still needs the list. */
  it('shows a deactivated student what they would reach, and reads an unknown one as missing', async () => {
    const { at, seriesId } = await reachable();
    const off = await studentAt(at, { isActive: false });

    await refused(resolverOn().catalog(off, NOW), ErrorCodes.NOT_FOUND);
    assert.deepEqual(
      (await grantsOn().reachedSeries(off)).map((row) => row.id),
      [seriesId],
    );
    assert.deepEqual(await pickerFor(off), [at.catalog.testSeriesId]);
    await refused(grantsOn().reachedSeries(uid()), ErrorCodes.NOT_FOUND);
  });
});
