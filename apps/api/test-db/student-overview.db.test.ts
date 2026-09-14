import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ErrorCodes,
  TEST_SCOPE,
  scopesSat,
  studentOverviewSchema,
  type TestScope,
} from '@iace/contracts';
import { StudentOverviewService } from '../src/attempts/overview.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FakeLeaderboard, makeStanding, type FakeStanding } from '../test/support/fakes';
import { makeStudent, makeSubject, resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Three graded sittings, each at the percentile the live ranking counts for it now. */
const standingsOf = (studentId: string): FakeStanding[] => [
  makeStanding({ studentId, attemptId: 'att_1', testId: 'tst_1', percentile: 70 }),
  makeStanding({ studentId, attemptId: 'att_2', testId: 'tst_2', percentile: 80.5 }),
  makeStanding({ studentId, attemptId: 'att_3', testId: 'tst_3', percentile: 60.01 }),
];

const build = (studentId: string, graded = true, client: PrismaService = prisma) =>
  new StudentOverviewService(
    client,
    new FakeLeaderboard(graded ? standingsOf(studentId) : []).asService(),
  );

interface StatInput {
  testsEvaluated?: number;
  sumScore?: number;
}

/** A career of five sittings, four graded, with the lifetime disposition the donut reads. */
function stat(studentId: string, over: StatInput = {}) {
  return prisma.studentStat.create({
    data: {
      studentId,
      testsAttempted: 5,
      testsEvaluated: over.testsEvaluated ?? 4,
      sumScore: over.sumScore ?? 260,
      totalAnswered: 300,
      totalCorrect: 200,
      totalWrong: 100,
      totalUnattempted: 120,
      sumTimeSec: 18_000,
      retakeCount: 1,
      lastAttemptAt: new Date('2026-08-30T09:00:00.000Z'),
      computedAt: new Date('2026-08-30T09:05:00.000Z'),
    },
  });
}

interface TallyInput {
  subjectId: string;
  scope?: TestScope;
  attempted: number;
  correct: number;
  sumTimeSec: number;
}

function tally(studentId: string, input: TallyInput) {
  return prisma.studentSubjectStat.create({
    data: {
      studentId,
      subjectId: input.subjectId,
      scope: input.scope ?? TEST_SCOPE.FULL,
      attempted: input.attempted,
      correct: input.correct,
      sumTimeSec: input.sumTimeSec,
      computedAt: new Date('2026-08-30T09:05:00.000Z'),
    },
  });
}

/** A folded student with one Reasoning row. */
async function folded() {
  const student = await makeStudent(prisma);
  const reasoning = await makeSubject(prisma, 'Reasoning');
  await stat(student.id);
  await tally(student.id, {
    subjectId: reasoning.id,
    attempted: 40,
    correct: 30,
    sumTimeSec: 1_600,
  });
  return { student, reasoning };
}

describe('StudentOverviewService standing', () => {
  it('divides the stored sums by the sittings behind them', async () => {
    const { student } = await folded();

    const overview = await build(student.id).overview(student.id);

    assert.equal(overview.standing.avgScore, 65);
    assert.equal(overview.standing.testsEvaluated, 4);
    assert.equal(overview.standing.retakeCount, 1);
  });

  /** The failure this prevents: a percentile saved at scoring, which drifts as others sit the paper. */
  it('averages and bests every graded sitting at the percentile it holds now', async () => {
    const { student } = await folded();

    const overview = await build(student.id).overview(student.id);

    assert.equal(overview.standing.avgPercentile, 70.17);
    assert.equal(overview.standing.bestPercentile, 80.5);
  });

  /** Four sittings none of which were graded: dividing by that is the bug this guards. */
  it('reads an unevaluated career as a dash rather than a division by zero', async () => {
    const student = await makeStudent(prisma);
    await stat(student.id, { testsEvaluated: 0, sumScore: 0 });

    const overview = await build(student.id, false).overview(student.id);

    assert.equal(overview.standing.avgPercentile, null);
    assert.equal(overview.standing.avgScore, null);
    assert.equal(overview.standing.bestPercentile, null);
  });

  /** A student the rollup has never folded has no row at all, which is a clean slate. */
  it('answers a student with no stat row with an empty standing, not an error', async () => {
    const student = await makeStudent(prisma);

    const overview = await build(student.id, false).overview(student.id);

    assert.equal(overview.standing.testsAttempted, 0);
    assert.equal(overview.standing.avgPercentile, null);
    assert.deepEqual(overview.disposition, { correct: 0, wrong: 0, unattempted: 0 });
    assert.deepEqual(overview.subjects, []);
    assert.equal(overview.measure.accuracy, null);
  });

  it('serialises every Decimal and BigInt the two tables hold', async () => {
    const { student } = await folded();

    const overview = await build(student.id).overview(student.id);

    assert.doesNotThrow(() => studentOverviewSchema.parse(overview));
    assert.doesNotThrow(() => JSON.stringify(overview));
  });
});

describe('StudentOverviewService sourcing', () => {
  /** Reasoning full-length and sectional, and Quantitative Aptitude full-length. */
  async function mixed() {
    const { student, reasoning } = await folded();
    const quant = await makeSubject(prisma, 'Quantitative Aptitude');
    await tally(student.id, { subjectId: quant.id, attempted: 60, correct: 30, sumTimeSec: 3_600 });
    await tally(student.id, {
      subjectId: reasoning.id,
      scope: TEST_SCOPE.SECTIONAL,
      attempted: 10,
      correct: 2,
      sumTimeSec: 900,
    });
    return student;
  }

  /** Σcorrect / Σattempted and ΣsumTimeSec / Σattempted, over every subject row of every scope. */
  it('sums the measure straight off the subject rows', async () => {
    const student = await mixed();

    const overview = await build(student.id).overview(student.id);

    assert.equal(overview.measure.attempted, 110);
    assert.equal(overview.measure.correct, 62);
    assert.equal(overview.measure.accuracy, 56.36);
    assert.equal(overview.measure.pace, 55.45);
  });

  /** Accuracy has one home, the subject rows, so a tile never disagrees with the subject charts. */
  it('never sources accuracy from the StudentStat totals', async () => {
    const student = await mixed();

    const overview = await build(student.id).overview(student.id);

    assert.notEqual(overview.measure.accuracy, (200 / 300) * 100);
  });

  /** The donut's third slice exists nowhere else, so it is lifetime. */
  it('takes the disposition from StudentStat, unattempted included', async () => {
    const student = await mixed();

    const overview = await build(student.id).overview(student.id);

    assert.deepEqual(overview.disposition, { correct: 200, wrong: 100, unattempted: 120 });
  });

  it('groups every scope row under the subject it belongs to', async () => {
    const student = await makeStudent(prisma);
    const reasoning = await makeSubject(prisma, 'Reasoning');
    await stat(student.id);
    await tally(student.id, {
      subjectId: reasoning.id,
      attempted: 40,
      correct: 30,
      sumTimeSec: 1_600,
    });
    await tally(student.id, {
      subjectId: reasoning.id,
      scope: TEST_SCOPE.SECTIONAL,
      attempted: 20,
      correct: 5,
      sumTimeSec: 1_000,
    });

    const overview = await build(student.id).overview(student.id);

    assert.equal(overview.subjects.length, 1);
    assert.equal(overview.subjects[0]?.tallies.length, 2);
    assert.deepEqual(scopesSat(overview.subjects), [TEST_SCOPE.FULL, TEST_SCOPE.SECTIONAL]);
  });
});

describe('StudentOverviewService.forStudent', () => {
  it('returns the named student', async () => {
    const { student } = await folded();

    const overview = await build(student.id).forStudent(student.id);

    assert.equal(overview.studentId, student.id);
    assert.equal(overview.standing.testsEvaluated, 4);
  });

  it('refuses an unknown student', async () => {
    await assert.rejects(
      build(uid('student')).forStudent(uid('student')),
      (error: { code?: string }) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

/** The tallies come off the two rollup tables; a sitting is read only through the live standings. */
describe('StudentOverviewService reads', () => {
  it('queries only StudentStat, StudentSubjectStat and the student, and ranks through the leaderboard', async () => {
    const { student } = await folded();
    const touched = new Set<string>();
    const watched = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (typeof key === 'string' && !key.startsWith('$') && !key.startsWith('_')) {
          touched.add(key);
        }
        return Reflect.get(target, key) as unknown;
      },
    });

    const overview = await build(student.id, true, watched).forStudent(student.id);

    assert.equal(overview.standing.avgPercentile, 70.17);
    assert.deepEqual(touched, new Set(['student', 'studentStat', 'studentSubjectStat']));
  });
});
