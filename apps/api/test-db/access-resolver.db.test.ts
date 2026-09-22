import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  DEFAULT_EXAM_COURSE,
  EXAM_COURSE,
  ErrorCodes,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  TEST_STATUS,
  type AttemptStatus,
  type StudentCatalog,
  type TestSeriesKind,
  type TestStatus,
} from '@iace/contracts';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import { AccessResolverService } from '../src/access/access-resolver.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakeRedis } from '../test/support/fakes';
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

  /** THE failure this prevents: a Redis blip leaving a just-blocked student starting tests on a stale entry. */
  it('refuses the moment a block or a deactivation lands, on a cache entry nothing busted', async () => {
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

describe('AccessResolverService — the cache', () => {
  it('answers a second read without touching Postgres', async () => {
    const { student } = await reachable();
    const { calls, resolver } = watched();

    await resolver.catalog(student, NOW);
    const afterFirst = calls.length;
    await resolver.catalog(student, NOW);

    assert.ok(afterFirst > 0);
    assert.equal(calls.length, afterFirst);
  });

  it('recomputes one student after their own access changes', async () => {
    const { student } = await reachable();
    const { calls, resolver } = watched();
    await resolver.catalog(student, NOW);
    const afterFirst = calls.length;

    await resolver.invalidateStudent(student);
    await resolver.catalog(student, NOW);

    assert.ok(calls.length > afterFirst);
  });

  /** THE race a DEL cannot survive: a bust between the miss and the write would re-pin the old answer for the TTL. */
  it('honours a bust that lands mid-resolve, instead of re-pinning the old answer', async () => {
    const { student, seriesId } = await reachable();
    const { hook, resolver } = watched();
    hook.before = async (call) => {
      if (call !== 'testSeries.findMany') return;
      hook.before = null;
      await resolver.invalidateStudent(student);
    };

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), [seriesId]);
    await prisma.testSeries.update({ where: { id: seriesId }, data: { isEnabled: false } });

    assert.deepEqual(seriesIds(await resolver.catalog(student, NOW)), []);
  });

  it('leaves every other student’s entry alone when one student is busted', async () => {
    const { at, student } = await reachable();
    const other = await studentAt(at);
    const { calls, resolver } = watched();
    await resolver.catalog(student, NOW);
    await resolver.catalog(other, NOW);
    const afterBoth = calls.length;

    await resolver.invalidateStudent(student);
    await resolver.catalog(other, NOW);

    assert.equal(calls.length, afterBoth);
  });

  /** A series-wide change is one INCR, not a scan: every student falls out of cache at once. */
  it('recomputes for everyone when the catalog itself changes', async () => {
    const { at, student } = await reachable();
    const other = await studentAt(at);
    const { calls, resolver } = watched();
    await resolver.catalog(student, NOW);
    await resolver.catalog(other, NOW);
    const afterBoth = calls.length;

    await resolver.invalidateAll();
    await resolver.catalog(student, NOW);
    const afterFirstRecompute = calls.length;
    await resolver.catalog(other, NOW);

    assert.ok(afterFirstRecompute > afterBoth);
    assert.ok(calls.length > afterFirstRecompute);
  });

  /** WHY the window is not cached: one entry must answer UPCOMING before the opening time and ACTIVE after it. */
  it('crosses an opening time on a cache entry that never changed', async () => {
    const at = await place();
    const opensAt = new Date('2026-06-15T00:00:00.000Z');
    await testIn(at, await series(at), 1, { opensAt });
    const student = await studentAt(at);
    const { calls, resolver } = watched();

    const before = await resolver.catalog(student, new Date(opensAt.getTime() - HOUR_MS));
    const afterFirst = calls.length;
    const later = await resolver.catalog(student, new Date(opensAt.getTime() + HOUR_MS));

    assert.equal(before.series[0]?.tests[0]?.canStart, false);
    assert.equal(later.series[0]?.tests[0]?.canStart, true);
    assert.equal(calls.length, afterFirst);
  });
});

describe('AccessCacheListener', () => {
  it('busts one student on student.access_changed', async () => {
    const { at, student } = await reachable();
    const other = await studentAt(at);
    const { calls, resolver } = watched();
    const listener = new AccessCacheListener(resolver);
    await resolver.catalog(student, NOW);
    await resolver.catalog(other, NOW);
    const afterBoth = calls.length;

    await listener.onStudentAccessChanged({ studentId: student });
    await resolver.catalog(other, NOW);
    const afterOther = calls.length;
    await resolver.catalog(student, NOW);

    assert.equal(afterOther, afterBoth);
    assert.ok(calls.length > afterOther);
  });

  it('busts everyone on access.catalog_changed', async () => {
    const { student, seriesId } = await reachable();
    const { calls, resolver } = watched();
    const listener = new AccessCacheListener(resolver);
    await resolver.catalog(student, NOW);
    const afterFirst = calls.length;

    await listener.onCatalogChanged({ testSeriesId: seriesId });
    await resolver.catalog(student, NOW);

    assert.ok(calls.length > afterFirst);
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
    for (const [index, status] of sittings) {
      await prisma.attempt.create({
        data: {
          id: uid(),
          testId: tests[index] ?? '',
          studentId: student,
          attemptNo: 1,
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
});

describe('reading about a test', () => {
  it('opens a test in a series the student reaches', async () => {
    const { student, testId } = await reachable();

    await resolverOn().assertReachable(student, testId);
  });

  /** Reachable is not startable: the brief is what a student reads BEFORE a test opens. */
  it('opens one that has not opened yet, which the start guard still refuses', async () => {
    const at = await place();
    const seriesId = await series(at);
    const later = await testIn(at, seriesId, 1, { opensAt: new Date(NOW.getTime() + HOUR_MS) });
    const student = await studentAt(at);

    await resolverOn().assertReachable(student, later);
    await refused(resolverOn().assertCanStart(student, later, NOW), ErrorCodes.FORBIDDEN);
  });

  it('reads a test in a series the student does not reach as missing', async () => {
    const at = await place();
    const elsewhere = await series(at, { branchIds: [uid()] });
    const testId = await testIn(at, elsewhere, 1);
    const student = await studentAt(at);

    await refused(resolverOn().assertReachable(student, testId), ErrorCodes.NOT_FOUND);
  });

  /** The bug this prevents: a drafted paper readable because only the catalog filtered on status. */
  it('reads a test that is not ACTIVE as missing, however reachable its series', async () => {
    const at = await place();
    const seriesId = await series(at);
    const drafted = await testIn(at, seriesId, 1, { status: TEST_STATUS.DRAFT });
    const student = await studentAt(at);

    await refused(resolverOn().assertReachable(student, drafted), ErrorCodes.NOT_FOUND);
  });

  it('reads everything in a switched-off series as missing', async () => {
    const at = await place();
    const off = await series(at, { isEnabled: false });
    const testId = await testIn(at, off, 1);
    const student = await studentAt(at);

    await refused(resolverOn().assertReachable(student, testId), ErrorCodes.NOT_FOUND);
  });

  /** A grant overrides the kind, reading about a test exactly as it does sitting one. */
  it('opens a granted series the student reaches no other way', async () => {
    const at = await place();
    const elsewhere = await series(at, { branchIds: [uid()] });
    const testId = await testIn(at, elsewhere, 1);
    const student = await studentAt(at);
    await prisma.studentGrant.create({ data: { studentId: student, testSeriesId: elsewhere } });

    await resolverOn().assertReachable(student, testId);
  });

  it('reads everything as missing for a student who is no longer active', async () => {
    const { student, testId } = await reachable();
    await prisma.student.update({ where: { id: student }, data: { isActive: false } });

    await refused(resolverOn().assertReachable(student, testId), ErrorCodes.NOT_FOUND);
  });
});
