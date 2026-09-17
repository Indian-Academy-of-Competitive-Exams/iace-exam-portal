import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { QuestionFlagCategory } from '@prisma/client';
import {
  ActorTypes,
  DEFAULT_EXAM_COURSE,
  DIFFICULTY_LEVEL,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  TEST_STATUS,
  type AdminPermissions,
  type FeatureKey,
} from '@iace/contracts';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { type AuthenticatedUser } from '../src/common/security';
import { type PrismaService } from '../src/prisma/prisma.service';
import {
  makeBranch,
  makeCatalog,
  makeQuestion,
  makeStudent,
  makeSubject,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const DAY_MS = 86_400_000;

/** Relative to the real clock the service reads: a pinned date turns "upcoming" into "open" on its own. */
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

function admin(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'adm_1',
    actor: ActorTypes.ADMIN,
    sessionId: 'ses_1',
    isSuperAdmin: false,
    isActive: true,
    permissions: {},
    ...over,
  };
}

const holding = (...keys: FeatureKey[]): AuthenticatedUser =>
  admin({
    permissions: Object.fromEntries(
      keys.map((key) => [key, PERMISSION_LEVELS.READ]),
    ) as AdminPermissions,
  });

/** The audit feed is every admin's own trail, so the stand-in only has to hand one back. */
const fakeAudit = () => ({
  listRowActions: () => Promise.resolve({ items: [], page: 1, pageSize: 8, total: 0 }),
});

/** The service over a client that records which tables it reached for. */
function build(client: PrismaService = prisma) {
  const touched = new Set<string>();
  const watched = new Proxy(client, {
    get(target, key: string | symbol) {
      if (typeof key === 'string' && !key.startsWith('$') && !key.startsWith('_')) {
        touched.add(key);
      }
      return Reflect.get(target, key) as unknown;
    },
  });
  return { touched, service: new DashboardService(watched, fakeAudit() as never) };
}

/** Three accounts (one closed), four branches, two programs, seven exams, and a small bank. */
async function populated() {
  await makeStudent(prisma);
  await makeStudent(prisma, { isActive: false });
  await makeStudent(prisma, { deletedAt: new Date() });
  for (let i = 0; i < 4; i += 1) await makeBranch(prisma);
  for (let i = 0; i < 2; i += 1) {
    await prisma.program.create({ data: { code: uid(), name: 'Program' } });
  }
  const catalog = await makeCatalog(prisma);
  await makeTest(prisma, catalog, { status: TEST_STATUS.ACTIVE });
  for (let i = 0; i < 6; i += 1) {
    await prisma.exam.create({
      data: { course: DEFAULT_EXAM_COURSE, code: uid(), name: 'Exam' },
    });
  }
  const quant = await makeSubject(prisma, 'QUANTITATIVE APTITUDE');
  const reasoning = await makeSubject(prisma, 'REASONING');
  const active = QUESTION_STATUS.ACTIVE;
  await makeQuestion(prisma, {
    subjectId: quant.id,
    status: active,
    difficulty: DIFFICULTY_LEVEL.LOW,
  });
  await makeQuestion(prisma, {
    subjectId: quant.id,
    status: active,
    difficulty: DIFFICULTY_LEVEL.HIGH,
  });
  await makeQuestion(prisma, { subjectId: reasoning.id, difficulty: DIFFICULTY_LEVEL.MEDIUM });
  return { quant, reasoning };
}

describe('DashboardService.overview — a band nobody may see is never even counted', () => {
  it('returns only the typist’s band, and runs no query behind the ones they lack', async () => {
    await populated();
    const { service, touched } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_AUTHORING));

    assert.equal(payload.headline?.students, undefined);
    assert.equal(payload.headline?.catalog, undefined);
    assert.equal(payload.headline?.tests, undefined);
    assert.equal(payload.windows, undefined);
    assert.equal(payload.activity?.sittings, undefined);
    // The whole point: a forbidden count is not zeroed, it is never asked for.
    assert.equal(touched.has('student'), false);
    assert.equal(touched.has('branch'), false);
    assert.equal(touched.has('test'), false);
  });

  it('drops the headline entirely when no tile in it is reachable', async () => {
    await populated();
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_PERFORMANCE));

    assert.equal(payload.headline, undefined);
    assert.equal(payload.bank, undefined);
    assert.ok(payload.activity?.sittings);
  });

  it('hands a deactivated admin an empty payload rather than the platform’s numbers', async () => {
    await populated();
    const { service, touched } = build();

    const payload = await service.overview(admin({ isSuperAdmin: true, isActive: false }));

    // Through JSON, which is what the caller sees: an undefined band never reaches the wire.
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {});
    assert.deepEqual([...touched], []);
  });

  it('counts the roster without the closed accounts', async () => {
    await populated();
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_MANAGEMENT));

    assert.deepEqual(payload.headline?.students, { total: 2, active: 1, suspended: 1 });
    assert.deepEqual(payload.headline?.catalog, { branches: 4, programs: 2, exams: 7 });
  });

  it('folds coverage by subject and difficulty over live questions only', async () => {
    const { quant, reasoning } = await populated();
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.deepEqual(payload.bank?.coverage, [
      {
        subjectId: quant.id,
        subject: 'QUANTITATIVE APTITUDE',
        active: 2,
        byDifficulty: { LOW: 1, HIGH: 1 },
      },
      // Present at zero: a subject with nothing live is exactly the thin area this surfaces.
      { subjectId: reasoning.id, subject: 'REASONING', active: 0, byDifficulty: {} },
    ]);
    assert.deepEqual(payload.headline?.questions, { ACTIVE: 2, DRAFT: 1 });
  });
});

describe('the open proof-reading flags tile', () => {
  it('is absent while nothing has been flagged, so it no-ops before proof-reading ships', async () => {
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.ok(payload.bank);
    assert.equal('openFlags' in payload.bank, false);
  });

  it('appears the moment a flag is open', async () => {
    const subject = await makeSubject(prisma);
    const question = await makeQuestion(prisma, { subjectId: subject.id });
    const raisedById = uid();
    for (let i = 0; i < 3; i += 1) {
      await prisma.questionFlag.create({
        data: {
          questionId: question.id,
          category: QuestionFlagCategory.INVALID,
          comment: 'Key is wrong',
          raisedById,
        },
      });
    }
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.equal(payload.bank?.openFlags, 3);
  });
});

describe('the sittings series and the windows', () => {
  /** Opened, upcoming, a draft, and one under a series nobody can reach. */
  async function schedule() {
    const catalog = await makeCatalog(prisma);
    await prisma.testSeries.update({
      where: { id: catalog.testSeriesId },
      data: { name: 'SSC CGL Mocks', isEnabled: true },
    });
    const hiddenSeries = await prisma.testSeries.create({
      data: { name: uid(), examStageId: catalog.examStageId, isEnabled: false },
    });
    const active = TEST_STATUS.ACTIVE;
    const opened = daysFromNow(-13);
    const old = await makeTest(prisma, catalog, {
      title: 'Mock 1',
      status: active,
      opensAt: opened,
    });
    await prisma.testStat.create({
      data: { testId: old.id, attemptCount: 40, evaluatedCount: 38, computedAt: new Date() },
    });
    const soon = await makeTest(prisma, catalog, {
      title: null,
      status: active,
      opensAt: daysFromNow(6),
    });
    const draft = await makeTest(prisma, catalog, { status: TEST_STATUS.DRAFT, opensAt: opened });
    const hidden = await makeTest(
      prisma,
      { ...catalog, testSeriesId: hiddenSeries.id },
      { status: active, opensAt: daysFromNow(-25) },
    );
    return { old, soon, draft, hidden, opened };
  }

  it('reads each point off the folded rollup, oldest first', async () => {
    const { old, soon, hidden } = await schedule();
    const { service, touched } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_PERFORMANCE));

    assert.deepEqual(
      payload.activity?.sittings?.map((sitting) => [sitting.testId, sitting.attempts]),
      [
        [hidden.id, 0],
        [old.id, 40],
        [soon.id, 0],
      ],
    );
    // Folded, never walked: the series must not reach for the sittings themselves.
    assert.equal(touched.has('attempt'), false);
  });

  it('splits open from upcoming and leaves out a series nobody can reach', async () => {
    const { old, soon, draft, hidden } = await schedule();
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT));

    assert.deepEqual(
      payload.windows?.open.map((window) => window.testId),
      [old.id],
    );
    assert.deepEqual(
      payload.windows?.upcoming.map((window) => window.testId),
      [soon.id],
    );
    // A draft test and a test under a disabled series are not windows an admin can act on.
    const shown = [...(payload.windows?.open ?? []), ...(payload.windows?.upcoming ?? [])];
    assert.equal(
      shown.some((window) => window.testId === hidden.id || window.testId === draft.id),
      false,
    );
  });

  it('carries the series name and the instant a window opens', async () => {
    const { old, opened } = await schedule();
    const { service } = build();

    const payload = await service.overview(holding(FEATURE_KEYS.TEST_MANAGEMENT));

    assert.deepEqual(payload.windows?.open[0], {
      testId: old.id,
      title: 'Mock 1',
      series: 'SSC CGL Mocks',
      opensAt: opened.toISOString(),
    });
  });
});
