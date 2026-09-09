import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActorTypes,
  DIFFICULTY_LEVEL,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  TEST_STATUS,
  type AdminPermissions,
  type FeatureKey,
} from '@iace/contracts';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { bandsFor } from '../src/dashboard/dashboard-bands';
import { type AuthenticatedUser } from '../src/common/security';
import { FakeDashboardPrisma, makeDashboardTest, type FakeDashboardData } from './support/fakes';

const NOW = new Date('2026-09-09T06:00:00.000Z');
const EARLIER = new Date('2026-08-20T04:30:00.000Z');
const OPENED = new Date('2026-09-01T04:30:00.000Z');
const SOON = new Date('2026-09-20T04:30:00.000Z');

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

/** The audit feed is every admin's own trail, so the fake only has to hand one back. */
const fakeAudit = () => ({
  listRowActions: () => Promise.resolve({ items: [], page: 1, pageSize: 8, total: 0 }),
});

function build(data: FakeDashboardData = {}) {
  const prisma = new FakeDashboardPrisma(data);
  return { prisma, service: new DashboardService(prisma.asService(), fakeAudit() as never) };
}

// --------------------------------------------------------------------------- the gate
// ---------------------------------------------------------------------------

describe('bandsFor — which bands a caller may see', () => {
  it('opens every band to a super admin', () => {
    const bands = bandsFor(admin({ isSuperAdmin: true }));

    assert.deepEqual(bands, {
      students: true,
      catalog: true,
      questions: true,
      tests: true,
      bank: true,
      sittings: true,
      feed: true,
      windows: true,
    });
  });

  it('closes every band to a deactivated super admin', () => {
    // isActive before the bypass, the guard's own order: nothing else can switch this account off.
    const bands = bandsFor(admin({ isSuperAdmin: true, isActive: false }));

    assert.equal(Object.values(bands).some(Boolean), false);
  });

  it('gives a typist the bank and nothing operational', () => {
    const bands = bandsFor(holding(FEATURE_KEYS.QUESTION_AUTHORING));

    assert.equal(bands.bank, true);
    assert.equal(bands.questions, true);
    assert.equal(bands.students, false);
    assert.equal(bands.tests, false);
    assert.equal(bands.windows, false);
    assert.equal(bands.sittings, false);
  });

  it('gives a student manager the roster and the catalog only', () => {
    const bands = bandsFor(holding(FEATURE_KEYS.STUDENT_MANAGEMENT));

    assert.equal(bands.students, true);
    assert.equal(bands.catalog, true);
    assert.equal(bands.bank, false);
    assert.equal(bands.windows, false);
  });

  it('opens windows to either key that owns a schedule', () => {
    assert.equal(bandsFor(holding(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT)).windows, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_MANAGEMENT)).windows, true);
  });

  it('opens the sittings series to either key that watches a sitting', () => {
    assert.equal(bandsFor(holding(FEATURE_KEYS.STUDENT_PERFORMANCE)).sittings, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_OPERATIONS)).sittings, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_MANAGEMENT)).sittings, false);
  });

  it('leaves the audit feed to every admin who is still active', () => {
    assert.equal(bandsFor(admin()).feed, true);
    assert.equal(bandsFor(admin({ isActive: false })).feed, false);
  });
});

// --------------------------------------------------------------------------- the payload
// ---------------------------------------------------------------------------

describe('DashboardService.overview — a band nobody may see is never even counted', () => {
  const populated: FakeDashboardData = {
    students: [
      { isActive: true, deletedAt: null },
      { isActive: false, deletedAt: null },
      { isActive: true, deletedAt: NOW },
    ],
    branches: 4,
    programs: 2,
    exams: 7,
    series: 3,
    questions: [
      { status: QUESTION_STATUS.ACTIVE, subjectId: 'sub_1', difficulty: DIFFICULTY_LEVEL.LOW },
      { status: QUESTION_STATUS.ACTIVE, subjectId: 'sub_1', difficulty: DIFFICULTY_LEVEL.HIGH },
      { status: QUESTION_STATUS.DRAFT, subjectId: 'sub_2', difficulty: DIFFICULTY_LEVEL.MEDIUM },
    ],
    subjects: [
      { id: 'sub_1', name: 'QUANTITATIVE APTITUDE' },
      { id: 'sub_2', name: 'REASONING' },
    ],
    tests: [makeDashboardTest()],
  };

  it('returns only the typist’s band, and runs no query behind the ones they lack', async () => {
    const { prisma, service } = build(populated);

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_AUTHORING));

    assert.equal(payload.headline?.students, undefined);
    assert.equal(payload.headline?.catalog, undefined);
    assert.equal(payload.headline?.tests, undefined);
    assert.equal(payload.windows, undefined);
    assert.equal(payload.activity?.sittings, undefined);
    // The whole point: a forbidden count is not zeroed, it is never asked for.
    assert.equal(prisma.touched.includes('student'), false);
    assert.equal(prisma.touched.includes('branch'), false);
    assert.equal(prisma.touched.includes('test'), false);
  });

  it('drops the headline entirely when no tile in it is reachable', async () => {
    const { service } = build(populated);

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_PERFORMANCE));

    assert.equal(payload.headline, undefined);
    assert.equal(payload.bank, undefined);
    assert.ok(payload.activity?.sittings);
  });

  it('hands a deactivated admin an empty payload rather than the platform’s numbers', async () => {
    const { prisma, service } = build(populated);

    const payload = await service.overview(admin({ isSuperAdmin: true, isActive: false }));

    // Through JSON, which is what the caller sees: an undefined band never reaches the wire.
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {});
    assert.deepEqual(prisma.touched, []);
  });

  it('counts the roster without the closed accounts', async () => {
    const { service } = build(populated);

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_MANAGEMENT));

    assert.deepEqual(payload.headline?.students, { total: 2, active: 1, suspended: 1 });
    assert.deepEqual(payload.headline?.catalog, { branches: 4, programs: 2, exams: 7 });
  });

  it('folds coverage by subject and difficulty over live questions only', async () => {
    const { service } = build(populated);

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.deepEqual(payload.bank?.coverage, [
      {
        subjectId: 'sub_1',
        subject: 'QUANTITATIVE APTITUDE',
        active: 2,
        byDifficulty: { LOW: 1, HIGH: 1 },
      },
      // Present at zero: a subject with nothing live is exactly the thin area this surfaces.
      { subjectId: 'sub_2', subject: 'REASONING', active: 0, byDifficulty: {} },
    ]);
    assert.deepEqual(payload.headline?.questions, { ACTIVE: 2, DRAFT: 1 });
  });
});

describe('the open proof-reading flags tile', () => {
  it('is absent while nothing has been flagged, so it no-ops before proof-reading ships', async () => {
    const { service } = build({ openFlags: 0 });

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.ok(payload.bank);
    assert.equal('openFlags' in payload.bank, false);
  });

  it('appears the moment a flag is open', async () => {
    const { service } = build({ openFlags: 3 });

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.equal(payload.bank?.openFlags, 3);
  });

  it('stands down when the table is not in this database, rather than taking the band with it', async () => {
    // Caught in the browser: P2021 from Lane E's undeployed migration 500'd the WHOLE dashboard.
    const { service } = build({
      openFlags: 'missing-table',
      questions: [
        { status: QUESTION_STATUS.ACTIVE, subjectId: 'sub_1', difficulty: DIFFICULTY_LEVEL.LOW },
      ],
      subjects: [{ id: 'sub_1', name: 'REASONING' }],
    });

    const payload = await service.overview(holding(FEATURE_KEYS.QUESTION_MANAGEMENT));

    assert.equal(payload.bank?.coverage.length, 1);
    assert.equal('openFlags' in (payload.bank ?? {}), false);
  });
});

describe('the sittings series and the windows', () => {
  const tests = [
    makeDashboardTest({ id: 'tst_old', opensAt: OPENED, attemptCount: 40, evaluatedCount: 38 }),
    makeDashboardTest({
      id: 'tst_soon',
      title: null,
      opensAt: SOON,
      attemptCount: 0,
      evaluatedCount: 0,
    }),
    makeDashboardTest({ id: 'tst_draft', status: TEST_STATUS.DRAFT, opensAt: OPENED }),
    makeDashboardTest({ id: 'tst_hidden', opensAt: EARLIER, seriesEnabled: false }),
  ];

  it('reads each point off the folded rollup, oldest first', async () => {
    const { service } = build({ tests });

    const payload = await service.overview(holding(FEATURE_KEYS.STUDENT_PERFORMANCE));

    // The fake has no `attempt` delegate at all, so reaching for one here would have thrown.
    assert.deepEqual(
      payload.activity?.sittings?.map((sitting) => [sitting.testId, sitting.attempts]),
      [
        ['tst_hidden', 0],
        ['tst_old', 40],
        ['tst_soon', 0],
      ],
    );
  });

  it('splits open from upcoming and leaves out a series nobody can reach', async () => {
    const { service } = build({ tests });

    const payload = await service.overview(holding(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT));

    assert.deepEqual(
      payload.windows?.open.map((window) => window.testId),
      ['tst_old'],
    );
    assert.deepEqual(
      payload.windows?.upcoming.map((window) => window.testId),
      ['tst_soon'],
    );
    // A draft test and a test under a disabled series are not windows an admin can act on.
    const shown = [...(payload.windows?.open ?? []), ...(payload.windows?.upcoming ?? [])];
    assert.equal(
      shown.some((window) => window.testId === 'tst_hidden' || window.testId === 'tst_draft'),
      false,
    );
  });

  it('carries the series name and the instant a window opens', async () => {
    const { service } = build({ tests });

    const payload = await service.overview(holding(FEATURE_KEYS.TEST_MANAGEMENT));

    assert.deepEqual(payload.windows?.open[0], {
      testId: 'tst_old',
      title: 'Mock 1',
      series: 'SSC CGL Mocks',
      opensAt: OPENED.toISOString(),
    });
  });
});
