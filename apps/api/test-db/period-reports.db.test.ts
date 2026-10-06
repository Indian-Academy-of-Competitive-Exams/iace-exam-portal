import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  REPORT_KEYS,
  TEST_SERIES_KIND,
  TEST_STATUS,
  todayISO,
} from '@iace/contracts';
import { shiftInstituteDay } from '../src/common/time/institute-day';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
  type Catalog,
} from './support/database';
import { figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();
const { read } = reportsOver(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A FREE series reaches every live student, so who a test reaches is plain to read. */
async function freeCatalog(): Promise<Catalog> {
  const catalog = await makeCatalog(prisma);
  await prisma.testSeries.update({
    where: { id: catalog.testSeriesId },
    data: { kind: TEST_SERIES_KIND.FREE },
  });
  return catalog;
}

const liveTest = async (catalog: Catalog, title: string, opensAt: Date | null = null) =>
  (
    await makeTest(prisma, catalog, {
      title,
      opensAt,
      status: TEST_STATUS.ACTIVE,
      finalizedAt: new Date(),
    })
  ).id;

const student = async (fullName: string) => (await makeStudent(prisma, { fullName })).id;

const sitOn = (testId: string, studentId: string, score: number, submittedAt: Date) =>
  makeSitting(prisma, { testId, studentId, score, submittedAt });

/** 00:30 on Monday 8 June in Kolkata, which is still Sunday evening in UTC. */
const MONDAY_EARLY = new Date('2026-06-07T19:00:00.000Z');
const WEEK = { from: '2026-06-08', to: '2026-06-14' };
const WEEK_BEFORE = { from: '2026-06-01', to: '2026-06-07' };

describe('the weekly test activity', () => {
  it('files a sitting under the institute day it was handed in, not the UTC one', async () => {
    const testId = await liveTest(await freeCatalog(), 'Mock 1');
    await sitOn(testId, await student('Ana'), 40, MONDAY_EARLY);

    const thisWeek = await read(REPORT_KEYS.TEST_ACTIVITY_WEEKLY, WEEK);
    const weekBefore = await read(REPORT_KEYS.TEST_ACTIVITY_WEEKLY, WEEK_BEFORE);

    assert.equal(figureOf(thisWeek, 'Ranked sittings'), 1);
    assert.deepEqual(
      tableOf(thisWeek, 'Tests').map((row) => [row.Test, row['Sittings in period']]),
      [['Mock 1', 1]],
    );
    assert.deepEqual(tableOf(weekBefore, 'Tests'), []);
  });

  it('lists a test that opened in the week and that nobody has sat', async () => {
    const catalog = await freeCatalog();
    await liveTest(catalog, 'Opened and unsat', new Date('2026-06-10T04:00:00.000Z'));
    await student('Ana');

    const document = await read(REPORT_KEYS.TEST_ACTIVITY_WEEKLY, WEEK);

    assert.equal(figureOf(document, 'Tests opened'), 1);
    assert.deepEqual(
      tableOf(document, 'Tests').map((row) => [
        row.Test,
        row['Sittings in period'],
        row.Reached,
        row['Participation (%)'],
      ]),
      [['Opened and unsat', 0, 1, 0]],
    );
  });

  it('sets the week beside the one before it, and a test’s figures are its cohort’s to date', async () => {
    const testId = await liveTest(await freeCatalog(), 'Mock 1');
    await sitOn(testId, await student('Ana'), 80, new Date('2026-06-03T06:00:00.000Z'));
    await sitOn(testId, await student('Bala'), 40, new Date('2026-06-09T06:00:00.000Z'));

    const document = await read(REPORT_KEYS.TEST_ACTIVITY_WEEKLY, WEEK);
    const [row] = tableOf(document, 'Tests');

    assert.equal(figureOf(document, 'Sittings, period before'), 1);
    assert.equal(figureOf(document, 'Students who sat'), 1);
    assert.equal(row?.['Sittings in period'], 1);
    assert.equal(row?.['Ranked to date'], 2);
    assert.equal(row?.['Mean score'], 60);
    assert.equal(row?.Topper, 'Ana');
  });
});

describe('a test that has not opened yet', () => {
  it('is not counted as opened, however far into the period its day is', async () => {
    const catalog = await freeCatalog();
    const today = todayISO();
    await liveTest(catalog, 'Opens tomorrow', new Date(Date.now() + 86_400_000));
    await student('Ana');

    const document = await read(REPORT_KEYS.TEST_ACTIVITY_WEEKLY, {
      from: today,
      to: shiftInstituteDay(today, 3),
    });

    assert.equal(figureOf(document, 'Tests opened'), 0);
    assert.deepEqual(tableOf(document, 'Tests'), []);
  });
});

describe('the series progress', () => {
  it('lists every student the series reaches by how many of its tests they have sat', async () => {
    const catalog = await freeCatalog();
    const first = await liveTest(catalog, 'Mock 1');
    const second = await liveTest(catalog, 'Mock 2');
    const ana = await student('Ana');
    const bala = await student('Bala');
    await student('Chitra');
    const on = new Date('2026-06-09T06:00:00.000Z');
    await sitOn(first, ana, 50, on);
    await sitOn(second, ana, 50, on);
    await sitOn(first, bala, 30, on);

    const document = await read(REPORT_KEYS.SERIES_PROGRESS, { seriesId: catalog.testSeriesId });

    assert.equal(figureOf(document, 'Sat every active test'), 1);
    assert.deepEqual(
      tableOf(document, 'Students').map((row) => [row.Student, row['Tests sat']]),
      [
        ['Ana', 2],
        ['Bala', 1],
        ['Chitra', 0],
      ],
    );
  });

  it('answers not found for a series that is not there', async () => {
    await assert.rejects(
      read(REPORT_KEYS.SERIES_PROGRESS, { seriesId: uid() }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the test schedule', () => {
  it('lists what opens in the period, a draft with a date included', async () => {
    const catalog = await freeCatalog();
    await liveTest(catalog, 'Live', new Date('2026-06-12T04:00:00.000Z'));
    await makeTest(prisma, catalog, {
      title: 'Draft',
      opensAt: new Date('2026-06-09T04:00:00.000Z'),
    });
    await liveTest(catalog, 'Next week', new Date('2026-06-16T04:00:00.000Z'));

    const rows = tableOf(await read(REPORT_KEYS.TEST_SCHEDULE, WEEK), 'Schedule');

    assert.deepEqual(
      rows.map((row) => [row.Test, row.Status]),
      [
        ['Draft', 'Draft'],
        ['Live', 'Active'],
      ],
    );
  });
});

describe('the participation trend', () => {
  it('gives every day of the period a row, a day nobody sat included', async () => {
    const testId = await liveTest(await freeCatalog(), 'Mock 1');
    const ana = await student('Ana');
    await sitOn(testId, ana, 40, MONDAY_EARLY);
    await sitOn(testId, await student('Bala'), 30, new Date('2026-06-08T10:00:00.000Z'));

    const document = await read(REPORT_KEYS.PARTICIPATION_TREND, {
      from: '2026-06-07',
      to: '2026-06-09',
    });

    assert.deepEqual(
      tableOf(document, 'Days').map((row) => [row.Day, row['Ranked sittings'], row.Students]),
      [
        ['7 Jun 2026', 0, 0],
        ['8 Jun 2026', 2, 2],
        ['9 Jun 2026', 0, 0],
      ],
    );
    assert.equal(figureOf(document, 'Days with a sitting'), 1);
  });
});
