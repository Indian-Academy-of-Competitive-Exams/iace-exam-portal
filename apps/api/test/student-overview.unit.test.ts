import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ActorTypes,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_SCOPE,
  scopesSat,
  studentOverviewSchema,
  type StudentOverview,
} from '@iace/contracts';
import { type AuthenticatedUser } from '../src/common/security';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { AdminOverviewController } from '../src/attempts/overview.controller';
import { StudentOverviewService } from '../src/attempts/overview.service';
import {
  FakeLeaderboard,
  FakeOverviewPrisma,
  makeStanding,
  type FakeOverviewData,
  type FakeStanding,
  type FakeOverviewSubjectRow,
  type FakeStudentStatRow,
} from './support/fakes';

const STUDENT = 'stu_1';
const BRANCH = 'brn_1';

const stat = (over: Partial<FakeStudentStatRow> = {}): FakeStudentStatRow => ({
  studentId: STUDENT,
  testsAttempted: 5,
  testsEvaluated: 4,
  sumScore: 260,
  sumPercentile: 253.2,
  bestPercentile: 88.5,
  totalAnswered: 300,
  totalCorrect: 200,
  totalWrong: 100,
  totalUnattempted: 120,
  sumTimeSec: 18_000,
  retakeCount: 1,
  lastAttemptAt: new Date('2026-08-30T09:00:00.000Z'),
  computedThrough: null,
  computedAt: new Date('2026-08-30T09:05:00.000Z'),
  ...over,
});

const row = (over: Partial<FakeOverviewSubjectRow> = {}): FakeOverviewSubjectRow => ({
  studentId: STUDENT,
  subjectId: 'sub_r',
  subjectName: 'Reasoning',
  scope: TEST_SCOPE.FULL,
  attempted: 40,
  correct: 30,
  sumTimeSec: 1_600,
  ...over,
});

/** Three graded sittings as the live ranking counts them now; the stat row's saved sums disagree. */
const STANDINGS: FakeStanding[] = [
  makeStanding({ attemptId: 'att_1', testId: 'tst_1', percentile: 70 }),
  makeStanding({ attemptId: 'att_2', testId: 'tst_2', percentile: 80.5 }),
  makeStanding({ attemptId: 'att_3', testId: 'tst_3', percentile: 60.01 }),
];

function serviceFor(over: Partial<FakeOverviewData> = {}, standings: FakeStanding[] = STANDINGS) {
  const data: FakeOverviewData = {
    stats: [stat()],
    subjects: [row()],
    students: [{ id: STUDENT, deletedAt: null, currentBranchId: BRANCH }],
    ...over,
  };
  const prisma = new FakeOverviewPrisma(data);
  return new StudentOverviewService(prisma as never, new FakeLeaderboard(standings).asService());
}

// --------------------------------------------------------------------------- the standing
// ---------------------------------------------------------------------------

describe('StudentOverviewService standing', () => {
  it('divides the stored sums by the sittings behind them', async () => {
    const overview = await serviceFor().overview(STUDENT);

    assert.equal(overview.standing.avgScore, 65);
    assert.equal(overview.standing.testsEvaluated, 4);
    assert.equal(overview.standing.retakeCount, 1);
  });

  /** The failure this prevents: a percentile saved at scoring, which drifts as others sit the paper. */
  it('averages and bests every graded sitting at the percentile it holds now', async () => {
    const overview = await serviceFor().overview(STUDENT);

    assert.equal(overview.standing.avgPercentile, 70.17);
    assert.equal(overview.standing.bestPercentile, 80.5);
  });

  /** Four sittings none of which were graded: dividing by that is the bug this guards. */
  it('reads an unevaluated career as a dash rather than a division by zero', async () => {
    const overview = await serviceFor(
      { stats: [stat({ testsEvaluated: 0, sumScore: 0, sumPercentile: 0, bestPercentile: null })] },
      [],
    ).overview(STUDENT);

    assert.equal(overview.standing.avgPercentile, null);
    assert.equal(overview.standing.avgScore, null);
    assert.equal(overview.standing.bestPercentile, null);
  });

  /** A student the rollup has never folded has no row at all, which is a clean slate. */
  it('answers a student with no stat row with an empty standing, not an error', async () => {
    const overview = await serviceFor({ stats: [], subjects: [] }, []).overview(STUDENT);

    assert.equal(overview.standing.testsAttempted, 0);
    assert.equal(overview.standing.avgPercentile, null);
    assert.deepEqual(overview.disposition, { correct: 0, wrong: 0, unattempted: 0 });
    assert.deepEqual(overview.subjects, []);
    assert.equal(overview.measure.accuracy, null);
  });

  it('serialises every Decimal and BigInt the two tables hold', async () => {
    const overview = await serviceFor().overview(STUDENT);

    assert.doesNotThrow(() => studentOverviewSchema.parse(overview));
    assert.doesNotThrow(() => JSON.stringify(overview));
  });
});

// --------------------------------------------------------------------------- what each table may answer
// ---------------------------------------------------------------------------

describe('StudentOverviewService sourcing', () => {
  const mixed: FakeOverviewSubjectRow[] = [
    row({ attempted: 40, correct: 30, sumTimeSec: 1_600 }),
    row({
      subjectId: 'sub_q',
      subjectName: 'Quantitative Aptitude',
      attempted: 60,
      correct: 30,
      sumTimeSec: 3_600,
    }),
    row({
      scope: TEST_SCOPE.SECTIONAL,
      attempted: 10,
      correct: 2,
      sumTimeSec: 900,
    }),
  ];

  /** Σcorrect / Σattempted and ΣsumTimeSec / Σattempted, over every subject row of every scope. */
  it('sums the measure straight off the subject rows', async () => {
    const overview = await serviceFor({ subjects: mixed }).overview(STUDENT);

    assert.equal(overview.measure.attempted, 110);
    assert.equal(overview.measure.correct, 62);
    assert.equal(overview.measure.accuracy, 56.36);
    assert.equal(overview.measure.pace, 55.45);
  });

  /** Accuracy has one home, the subject rows, so a tile never disagrees with the subject charts. */
  it('never sources accuracy from the StudentStat totals', async () => {
    const overview = await serviceFor({ subjects: mixed }).overview(STUDENT);
    const statAccuracy = (200 / 300) * 100;

    assert.notEqual(overview.measure.accuracy, statAccuracy);
  });

  /** The donut's third slice exists nowhere else, so it is lifetime. */
  it('takes the disposition from StudentStat, unattempted included', async () => {
    const overview = await serviceFor({ subjects: mixed }).overview(STUDENT);

    assert.deepEqual(overview.disposition, { correct: 200, wrong: 100, unattempted: 120 });
  });

  it('groups every scope row under the subject it belongs to', async () => {
    const overview = await serviceFor({
      subjects: [
        row({ scope: TEST_SCOPE.FULL, attempted: 40, correct: 30, sumTimeSec: 1_600 }),
        row({ scope: TEST_SCOPE.SECTIONAL, attempted: 20, correct: 5, sumTimeSec: 1_000 }),
      ],
    }).overview(STUDENT);

    assert.equal(overview.subjects.length, 1);
    assert.equal(overview.subjects[0]?.tallies.length, 2);
    assert.deepEqual(scopesSat(overview.subjects), [TEST_SCOPE.FULL, TEST_SCOPE.SECTIONAL]);
  });
});

// --------------------------------------------------------------------------- the admin's way in
// ---------------------------------------------------------------------------

describe('StudentOverviewService.forStudent', () => {
  it('returns the named student', async () => {
    const overview = await serviceFor().forStudent(STUDENT);

    assert.equal(overview.studentId, STUDENT);
    assert.equal(overview.standing.testsEvaluated, 4);
  });

  it('refuses an unknown student', async () => {
    await assert.rejects(
      serviceFor().forStudent('stu_nope'),
      (error: { code?: string }) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('AdminOverviewController guard', () => {
  const guard = new FeaturePermissionGuard(new Reflector());

  function contextFor(user: Partial<AuthenticatedUser>): ExecutionContext {
    const request = {
      user: {
        id: 'adm_1',
        actor: ActorTypes.ADMIN,
        isActive: true,
        isSuperAdmin: false,
        allBranches: false,
        branchIds: [BRANCH],
        permissions: {},
        ...user,
      },
    };

    return {
      getHandler: () => AdminOverviewController.prototype.read,
      getClass: () => AdminOverviewController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('lets an admin holding STUDENT_PERFORMANCE through', () => {
    const context = contextFor({
      permissions: { [FEATURE_KEYS.STUDENT_PERFORMANCE]: PERMISSION_LEVELS.READ },
    });

    assert.equal(guard.canActivate(context), true);
  });

  /** Managing students is not the same as reading how one of them performs. */
  it('refuses an admin who holds every other key', () => {
    const context = contextFor({
      permissions: { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });

    assert.throws(
      () => guard.canActivate(context),
      (error: { code?: string }) => error.code === ErrorCodes.FORBIDDEN,
    );
  });

  it('refuses a student token outright', () => {
    const context = contextFor({ actor: ActorTypes.STUDENT });

    assert.throws(
      () => guard.canActivate(context),
      (error: { code?: string }) => error.code === ErrorCodes.FORBIDDEN,
    );
  });
});

/** Nothing on this screen re-derives from an attempt what the two rollup tables already hold. */
describe('StudentOverviewService reads', () => {
  it('touches only StudentStat, StudentSubjectStat and the student it was asked about', async () => {
    const touched: string[] = [];
    const prisma = new FakeOverviewPrisma({
      stats: [stat()],
      subjects: [row()],
      students: [{ id: STUDENT, deletedAt: null, currentBranchId: BRANCH }],
    });
    const watched = new Proxy(prisma, {
      get(target, key: string) {
        touched.push(key);
        return Reflect.get(target, key) as unknown;
      },
    });

    const overview: StudentOverview = await new StudentOverviewService(
      watched as never,
      new FakeLeaderboard(STANDINGS).asService(),
    ).forStudent(STUDENT);

    assert.equal(overview.studentId, STUDENT);
    assert.deepEqual(new Set(touched), new Set(['student', 'studentStat', 'studentSubjectStat']));
  });
});
