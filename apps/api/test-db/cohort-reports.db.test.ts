import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { REPORT_KEYS, TEST_SERIES_KIND, TEST_STATUS } from '@iace/contracts';
import { packedSections } from '../src/attempts/score-paper';
import {
  makeBranch,
  makeCatalog,
  makePaper,
  makeSection,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  type Catalog,
  type StudentOverrides,
} from './support/database';
import { figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();
const { read } = reportsOver(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const WEEK = { from: '2026-06-08', to: '2026-06-14' };
const IN_WEEK = new Date('2026-06-09T06:00:00.000Z');
const WEEK_BEFORE = new Date('2026-06-03T06:00:00.000Z');

async function freeCatalog(): Promise<Catalog> {
  const catalog = await makeCatalog(prisma);
  await prisma.testSeries.update({
    where: { id: catalog.testSeriesId },
    data: { kind: TEST_SERIES_KIND.FREE },
  });
  return catalog;
}

const liveTest = async (catalog: Catalog, opensAt: Date | null = null) =>
  (
    await makeTest(prisma, catalog, {
      opensAt,
      status: TEST_STATUS.ACTIVE,
      finalizedAt: new Date(),
    })
  ).id;

const student = async (fullName: string, over: StudentOverrides = {}) =>
  (await makeStudent(prisma, { fullName, ...over })).id;

const sitOn = (testId: string, studentId: string, score: number, submittedAt = IN_WEEK) =>
  makeSitting(prisma, { testId, studentId, score, submittedAt });

describe('the branch performance', () => {
  it('averages each sitting’s place in the whole cohort, never recounted within the branch', async () => {
    const testId = await liveTest(await freeCatalog());
    const north = (await makeBranch(prisma, 'NORTH')).id;
    const south = (await makeBranch(prisma, 'SOUTH')).id;
    await sitOn(testId, await student('Ana', { currentBranchId: north }), 90);
    await sitOn(testId, await student('Bala', { currentBranchId: north }), 50);
    await student('Absent', { currentBranchId: north });
    await sitOn(testId, await student('Chitra', { currentBranchId: south }), 30);
    await sitOn(testId, await student('Dev', { currentBranchId: south }), 10);

    const rows = tableOf(await read(REPORT_KEYS.PERFORMANCE_BY_BRANCH, WEEK), 'Branch performance');

    assert.deepEqual(
      rows.map((row) => [
        row.Branch,
        row.Students,
        row['Students who sat'],
        row['Participation (%)'],
        row['Average percentile'],
      ]),
      [
        ['NORTH', 3, 2, 66.67, 75],
        ['SOUTH', 2, 2, 100, 25],
      ],
    );
  });

  it('counts a student on two programs under each, and one on none under its own row', async () => {
    const testId = await liveTest(await freeCatalog());
    await sitOn(testId, await student('Ana', { programs: ['ALPHA', 'BETA'] }), 90);
    await sitOn(testId, await student('Bala'), 10);

    const rows = tableOf(
      await read(REPORT_KEYS.PERFORMANCE_BY_PROGRAM, WEEK),
      'Program performance',
    );

    assert.deepEqual(
      rows.map((row) => [row.Program, row['Ranked sittings']]),
      [
        ['ALPHA', 1],
        ['BETA', 1],
        ['No program', 1],
      ],
    );
  });
});

describe('the top performers', () => {
  it('places students by average percentile over the period, as many as asked for', async () => {
    const catalog = await freeCatalog();
    const [first, second] = [await liveTest(catalog), await liveTest(catalog)];
    const [ana, bala, chitra] = [
      await student('Ana'),
      await student('Bala'),
      await student('Chitra'),
    ];
    await sitOn(first, ana, 90);
    await sitOn(first, bala, 50);
    await sitOn(first, chitra, 10);
    await sitOn(second, bala, 90);
    await sitOn(second, ana, 10);

    const rows = tableOf(
      await read(REPORT_KEYS.TOP_PERFORMERS, { ...WEEK, top: 2 }),
      'Top performers',
    );

    assert.deepEqual(
      rows.map((row) => [row.Place, row.Student, row['Tests sat']]),
      [
        [1, 'Bala', 2],
        [2, 'Ana', 2],
      ],
    );
  });
});

describe('the most improved', () => {
  it('compares only students ranked in both periods, and files a fall apart from a gain', async () => {
    const catalog = await freeCatalog();
    const [before, now] = [await liveTest(catalog), await liveTest(catalog)];
    const [ana, bala, newcomer] = [
      await student('Ana'),
      await student('Bala'),
      await student('New'),
    ];
    await sitOn(before, ana, 10, WEEK_BEFORE);
    await sitOn(before, bala, 90, WEEK_BEFORE);
    await sitOn(now, ana, 90);
    await sitOn(now, bala, 10);
    await sitOn(now, newcomer, 50);

    const document = await read(REPORT_KEYS.MOST_IMPROVED, WEEK);

    assert.equal(figureOf(document, 'Ranked in both periods'), 2);
    assert.deepEqual(
      tableOf(document, 'Most improved').map((row) => row.Student),
      ['Ana'],
    );
    assert.deepEqual(
      tableOf(document, 'Fallen back').map((row) => row.Student),
      ['Bala'],
    );
  });
});

describe('the subject-wise accuracy', () => {
  it('puts the weakest subject first', async () => {
    const catalog = await freeCatalog();
    const testId = await liveTest(catalog);
    const quant = await makeSection(prisma, catalog, { name: 'Quant', order: 1 });
    const english = await makeSection(prisma, catalog, { name: 'English', order: 2 });
    const sitting = await sitOn(testId, await student('Ana'), 40);
    const scored = (id: string, correctCount: number, wrongCount: number) => ({
      baseConfigSectionId: id,
      score: 0,
      correctCount,
      wrongCount,
      unattemptedCount: 0,
      timeSpentSec: 0,
    });
    await prisma.attempt.update({
      where: { id: sitting.id },
      data: { sectionScores: packedSections([scored(english.id, 9, 1), scored(quant.id, 2, 8)]) },
    });

    const rows = tableOf(await read(REPORT_KEYS.WEAK_SUBJECTS, WEEK), 'Subjects');

    assert.deepEqual(
      rows.map((row) => [row.Subject, row['Accuracy (%)']]),
      [
        ['Quant', 20],
        ['English', 90],
      ],
    );
  });
});

describe('the topic-wise difficulty', () => {
  it('sums each topic over the tests sat in the period, hardest first', async () => {
    const paper = await makePaper(prisma, { questions: ['Maths', 'English'] });
    const [maths, english] = paper.items;
    await sitOn(paper.testId, await student('Ana'), 4);
    await prisma.testQuestionStat.createMany({
      data: [
        { ...statOf(paper.testId, maths), correctCount: 8, wrongCount: 2 },
        { ...statOf(paper.testId, english), correctCount: 1, wrongCount: 9 },
      ],
    });

    const rows = tableOf(await read(REPORT_KEYS.WEAK_TOPICS, WEEK), 'Topics');

    assert.deepEqual(
      rows.map((row) => [row.Subject, row['Got it right (%)']]),
      [
        ['English', 10],
        ['Maths', 80],
      ],
    );
  });

  const statOf = (testId: string, item?: { paperQuestionId: string; questionId: string }) => ({
    testId,
    paperQuestionId: item?.paperQuestionId ?? '',
    questionId: item?.questionId ?? '',
    computedAt: new Date(),
  });
});

describe('the absentees across tests', () => {
  it('counts each student’s reached tests against the ones they hold a sitting of', async () => {
    const catalog = await freeCatalog();
    const opened = new Date('2026-06-10T04:00:00.000Z');
    const [first, second] = [await liveTest(catalog, opened), await liveTest(catalog, opened)];
    const [ana, bala] = [await student('Ana'), await student('Bala')];
    await student('Chitra');
    await sitOn(first, ana, 40);
    await sitOn(second, ana, 40);
    await sitOn(first, bala, 40);

    const document = await read(REPORT_KEYS.ABSENTEES, WEEK);

    assert.equal(figureOf(document, 'Missed every test'), 1);
    assert.deepEqual(
      tableOf(document, 'Absentees').map((row) => [row.Student, row['Tests reached'], row.Missed]),
      [
        ['Chitra', 2, 2],
        ['Bala', 2, 1],
      ],
    );
  });
});

describe('the inactive students', () => {
  const lastSat = (studentId: string, daysAgo: number) =>
    prisma.studentStat.create({
      data: {
        studentId,
        lastAttemptAt: new Date(Date.now() - daysAgo * 86_400_000),
        computedAt: new Date(),
      },
    });

  it('lists who has not sat within the days asked, the never-sat first, and nobody suspended', async () => {
    await lastSat(await student('Recent'), 3);
    await lastSat(await student('Away'), 40);
    await student('Never');
    await student('Suspended', { isActive: false });

    const document = await read(REPORT_KEYS.INACTIVE_STUDENTS, { days: 30 });

    assert.equal(figureOf(document, 'Never sat a test'), 1);
    assert.deepEqual(
      tableOf(document, 'Inactive students').map((row) => [row.Student, row['Days since']]),
      [
        ['Never', null],
        ['Away', 40],
      ],
    );
  });
});

describe('the retakes', () => {
  it('counts the unranked marked sittings of the period by student', async () => {
    const testId = await liveTest(await freeCatalog());
    const ana = await student('Ana');
    await sitOn(testId, ana, 40);
    await makeSitting(prisma, {
      testId,
      studentId: ana,
      score: 60,
      attemptNo: 2,
      isGraded: false,
      submittedAt: IN_WEEK,
    });

    const rows = tableOf(await read(REPORT_KEYS.RETAKES, WEEK), 'Retakes');

    assert.deepEqual(
      rows.map((row) => [row.Student, row.Retakes, row['Tests retaken']]),
      [['Ana', 1, 1]],
    );
  });
});
