import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  PERFORMANCE_SCOPES,
  performanceReportQuerySchema,
  performanceReportSchema,
} from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeCatalog,
  makePaper,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
  type Paper,
  type SitInput,
} from './support/database';

const SERIES = 'SSC CGL Foundation';
const WRONG = 'o3';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationOutbox(new FakeQueue().asQueue()),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
);

const service = new PerformanceAnalyticsService(prisma, new LeaderboardService(prisma));

const query = (input: unknown) => performanceReportQuerySchema.parse(input);

type Sat = Omit<SitInput, 'paper' | 'studentId' | 'chosen'>;

async function sit(paper: Paper, studentId: string, chosen: SitInput['chosen'], over: Sat) {
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen,
    timeSpent: [40, 50, 5],
    ...over,
  });
  await processor.score(attempt.id);
  return attempt.id;
}

/** Two papers in one series. The student is under the rival on the first, and alone on the second. */
async function world({ seriesHoldsBoth = true } = {}) {
  const questions = [
    'Reasoning',
    { subject: 'Reasoning', difficulty: DIFFICULTY_LEVEL.HIGH },
    'Reasoning',
  ];
  const first = await makePaper(prisma, { questions });
  const second = await makePaper(prisma, { questions });
  const seriesId = second.catalog.testSeriesId;
  await prisma.testSeries.update({ where: { id: seriesId }, data: { name: SERIES } });
  if (seriesHoldsBoth) {
    await prisma.test.update({ where: { id: first.testId }, data: { testSeriesId: seriesId } });
  }
  const student = (await makeStudent(prisma)).id;
  const rival = (await makeStudent(prisma)).id;
  const on = (at: string) => ({ submittedAt: new Date(at) });

  const older = await sit(
    first,
    student,
    [RIGHT_OPTION, WRONG, null],
    on('2026-08-20T06:00:00.000Z'),
  );
  const newer = await sit(
    second,
    student,
    [RIGHT_OPTION, RIGHT_OPTION, null],
    on('2026-08-25T06:00:00.000Z'),
  );
  const theirs = await sit(
    first,
    rival,
    [RIGHT_OPTION, RIGHT_OPTION, RIGHT_OPTION],
    on('2026-08-20T06:00:00.000Z'),
  );
  return { first, second, seriesId, student, rival, older, newer, theirs };
}

type World = Awaited<ReturnType<typeof world>>;

/** A second sitting of the first paper, outside the cohort: 2 + 2 − 0.5. */
const retakeOf = ({ first, student }: World, over: Sat = {}) =>
  sit(first, student, [RIGHT_OPTION, RIGHT_OPTION, WRONG], {
    attemptNo: 2,
    isGraded: false,
    submittedAt: new Date('2026-08-22T06:00:00.000Z'),
    ...over,
  });

const rolled = (
  testId: string,
  stat: {
    evaluatedCount: number;
    sumScore: number;
    maxScore: number;
  },
) => prisma.testStat.create({ data: { testId, computedAt: new Date(), ...stat } });

const ofAttempt = (studentId: string, attemptId: string) =>
  service.report(studentId, query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }));

const ofTest = (studentId: string, testId: string) =>
  service.report(studentId, query({ scope: PERFORMANCE_SCOPES.TEST, testId }));

const missing = (error: { code?: string }) => error.code === ErrorCodes.NOT_FOUND;

describe('the performance report — one sitting', () => {
  it('answers with every figure derived from what the exam wrote', async () => {
    const { student, older } = await world();

    const report = await ofAttempt(student, older);

    assert.equal(performanceReportSchema.safeParse(report).success, true);
    assert.equal(report.attemptsCounted, 1);
    assert.equal(report.scopeId, older);
    assert.equal(report.composition.net, 1.5);
    assert.equal(report.composition.penalty, 0.5);
    assert.equal(report.time.totalSec, 95);
    assert.equal(report.sections[0]?.score, 1.5);
  });

  it('puts the sitting on its curve at the rank and percentile it holds now', async () => {
    const { student, older } = await world();

    const report = await ofAttempt(student, older);

    assert.deepEqual([report.cohort?.rank, report.cohort?.percentile], [2, 25]);
  });

  it('counts the curve off the sittings when no rollup has been written', async () => {
    const { student, older } = await world();

    const { cohort } = await ofAttempt(student, older);

    assert.equal(cohort?.topperScore, 6);
    assert.equal(cohort?.averageScore, 3.75);
    assert.equal(cohort?.cohortSize, 2);
    assert.equal(
      cohort?.bands.reduce((sum, band) => sum + band.count, 0),
      2,
    );
    assert.equal(cohort?.bands.filter((band) => band.isYours).length, 1);
  });

  /** The split this pins: the rollup owns the totals, and the curve is counted off the sittings. */
  it('takes the totals from the rollup and counts the curve itself', async () => {
    const { first, student, older } = await world();
    await rolled(first.testId, { evaluatedCount: 40, sumScore: 120, maxScore: 5.5 });

    const report = await ofAttempt(student, older);

    assert.equal(performanceReportSchema.safeParse(report).success, true);
    assert.equal(report.cohort?.topperScore, 5.5);
    assert.equal(report.cohort?.averageScore, 3);
    assert.equal(
      report.cohort?.bands.reduce((sum, band) => sum + band.count, 0),
      2,
    );
    assert.equal(report.cohort?.bands.filter((band) => band.isYours).length, 1);
  });

  it('names the cohort the live rank was counted in, however far behind the rollup is', async () => {
    const { first, student, older } = await world();
    await rolled(first.testId, { evaluatedCount: 1, sumScore: 6, maxScore: 6 });

    const { cohort } = await ofAttempt(student, older);

    assert.deepEqual([cohort?.rank, cohort?.cohortSize], [2, 2]);
  });

  /** The one guarantee that must hold at every scope and on both paths. */
  it('carries no answer key, no option and no question text', async () => {
    const { student, older } = await world();

    const payload = JSON.stringify(await ofAttempt(student, older));

    assert.equal(payload.includes('answerKey'), false);
    assert.equal(payload.includes('Option 1'), false);
    assert.equal(payload.includes('isCorrect'), false);
    assert.equal(payload.includes('questionVersion'), false);
  });

  it('reads a sitting that is not theirs as missing rather than refusing it', async () => {
    const { student, theirs } = await world();

    await assert.rejects(() => ofAttempt(student, theirs), missing);
  });
});

describe('the performance report — one paper sat more than once', () => {
  /** The failure this prevents: a 6-mark paper reporting 12 marks because it was sat twice. */
  it('describes the anchor sitting alone, so every figure shares one denominator', async () => {
    const sat = await world();
    await retakeOf(sat);

    const report = await ofTest(sat.student, sat.first.testId);

    assert.equal(report.composition.maxMarks, 6);
    assert.equal(
      report.sections.reduce((sum, section) => sum + section.maxMarks, 0),
      report.composition.maxMarks,
    );
    assert.equal(report.sections[0]?.score, 1.5);
    assert.equal(report.time.totalSec, 95);
  });

  /** The trajectory is the one series that spans sittings on purpose — it must not shrink. */
  it('still plots every sitting the scope holds', async () => {
    const sat = await world();
    const retake = await retakeOf(sat);

    const report = await ofTest(sat.student, sat.first.testId);

    assert.equal(report.attemptsCounted, 2);
    assert.deepEqual(
      report.trajectory.map((point) => [point.attemptId, point.rank, point.percentile]),
      [
        [sat.older, 2, 25],
        [retake, null, null],
      ],
    );
  });

  /** A retake is outside the cohort, so its own report ranks it nowhere rather than borrowing a rank. */
  it('puts a retake on no rank and no percentile', async () => {
    const sat = await world();
    const retake = await retakeOf(sat);

    const { cohort } = await ofAttempt(sat.student, retake);

    assert.deepEqual([cohort?.rank, cohort?.percentile], [null, null]);
  });

  it('keeps the rollup’s n for a retake, which no live count ranks', async () => {
    const sat = await world();
    const retake = await retakeOf(sat);
    await rolled(sat.first.testId, { evaluatedCount: 40, sumScore: 120, maxScore: 6 });

    const paper = await ofTest(sat.student, sat.first.testId);
    const retaken = await ofAttempt(sat.student, retake);

    assert.deepEqual(
      paper.trajectory.map((point) => [point.attemptId, point.cohortSize]),
      [
        [sat.older, 2],
        [retake, 40],
      ],
    );
    assert.equal(retaken.cohort?.cohortSize, 40);
  });

  /** Postgres puts NULLs first on a descending sort, which made an unsubmitted sitting the newest. */
  it('never takes a sitting that was never submitted for the newest one', async () => {
    const sat = await world();
    await retakeOf(sat, { submittedAt: null });

    const report = await ofTest(sat.student, sat.first.testId);

    assert.equal(report.trajectory.at(-1)?.attemptId, sat.older);
    assert.equal(report.sections[0]?.score, 1.5);
  });
});

describe('the performance report — the wider scopes', () => {
  it('plots percentile over the sittings in order, oldest first, and never marks', async () => {
    const { student, older, newer } = await world();

    const report = await service.report(student, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));

    assert.equal(report.scopeId, null);
    assert.deepEqual(
      report.trajectory.map((point) => [point.attemptId, point.percentile]),
      [
        [older, 25],
        [newer, 100],
      ],
    );
    assert.equal(
      report.trajectory.some((point) => Object.hasOwn(point, 'score')),
      false,
    );
  });

  it('carries the live n behind each ranked percentile, never a lagging rollup’s', async () => {
    const { first, student } = await world();
    await rolled(first.testId, { evaluatedCount: 1, sumScore: 6, maxScore: 6 });

    const report = await service.report(student, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));

    assert.deepEqual(
      report.trajectory.map((point) => [point.rank, point.cohortSize]),
      [
        [2, 2],
        [1, 1],
      ],
    );
  });

  /** Two papers do not share a distribution, so a curve across them would be a lie. */
  it('draws no cohort curve for a scope that spans more than one paper', async () => {
    const { student, seriesId } = await world();

    const wide = await service.report(student, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));
    const series = await service.report(
      student,
      query({ scope: PERFORMANCE_SCOPES.SERIES, seriesId }),
    );

    assert.equal(wide.cohort, null);
    assert.equal(series.cohort, null);
    assert.equal(series.label, SERIES);
    assert.equal(series.attemptsCounted, 2);
  });

  it('folds only the sittings the series holds', async () => {
    const { student, seriesId, second } = await world({ seriesHoldsBoth: false });

    const report = await service.report(
      student,
      query({ scope: PERFORMANCE_SCOPES.SERIES, seriesId }),
    );

    assert.equal(report.attemptsCounted, 1);
    assert.equal(report.trajectory[0]?.testId, second.testId);
  });

  /** The defect this prevents: standings scanned every sitting ever made, not just the ≤20 plotted. */
  it('still stands every plotted sitting once history runs past the cap', async () => {
    const catalog = await makeCatalog(prisma);
    const student = await makeStudent(prisma);
    const dayMs = 24 * 60 * 60 * 1000;
    const sittings: string[] = [];
    for (let day = 0; day < 25; day += 1) {
      const testId = (await makeTest(prisma, catalog)).id;
      const submittedAt = new Date(Date.UTC(2026, 0, 1) + day * dayMs);
      const sitting = await makeSitting(prisma, {
        testId,
        studentId: student.id,
        score: 10,
        submittedAt,
      });
      sittings.push(sitting.id);
    }

    const report = await service.report(student.id, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));

    assert.equal(report.attemptsCounted, 20);
    assert.deepEqual(
      report.trajectory.map((point) => point.attemptId),
      sittings.slice(5),
    );
    assert.ok(report.trajectory.every((point) => point.rank === 1 && point.percentile === 100));
  });
});

describe('the performance report — the admin path', () => {
  it('reads any student it is asked for', async () => {
    const { first, rival } = await world();

    const report = await service.forStudent(
      rival,
      query({ scope: PERFORMANCE_SCOPES.TEST, testId: first.testId }),
    );

    assert.equal(report.studentId, rival);
    assert.equal(report.attemptsCounted, 1);
    assert.equal(JSON.stringify(report).includes('answerKey'), false);
  });

  it('reads an unknown student as missing rather than as a student with nothing', async () => {
    await world();

    await assert.rejects(
      () => service.forStudent(uid(), query({ scope: PERFORMANCE_SCOPES.ALL_TIME })),
      missing,
    );
  });
});

describe('the performance report — the series a student may ask about', () => {
  /** The picker cannot offer a series they never sat: that report would be an empty screen. */
  it('offers the scope picker only the series the student has sat', async () => {
    const { student, seriesId, first } = await world();
    await prisma.testSeries.create({
      data: { id: uid(), name: 'Untouched', examStageId: first.catalog.examStageId },
    });

    assert.deepEqual(await service.satSeries(student), [{ id: seriesId, name: SERIES }]);
  });
});

/** Every key the report may carry, at any depth. Adding one here is a review, never a side effect. */
const REPORT_FIELDS = [
  'attemptId',
  'attemptsCounted',
  'averageScore',
  'avgOnCorrectSec',
  'avgOnWrongSec',
  'avgPerQuestionSec',
  'bands',
  'baseConfigSectionId',
  'cohort',
  'cohortAverageScore',
  'cohortAverageTimeSec',
  'cohortSampleSize',
  'cohortSize',
  'composition',
  'correctCount',
  'count',
  'earned',
  'from',
  'generatedAt',
  'isYours',
  'label',
  'lostToUnanswered',
  'lostToWrong',
  'maxMarks',
  'name',
  'net',
  'order',
  'paceIndex',
  'penalty',
  'percentile',
  'questionCount',
  'rank',
  'scope',
  'scopeId',
  'score',
  'sections',
  'spentOnUnattemptedSec',
  'studentId',
  'submittedAt',
  'testId',
  'testTitle',
  'time',
  'timeSpentSec',
  'to',
  'topperScore',
  'topperTimeSec',
  'totalSec',
  'trajectory',
  'unattemptedCount',
  'wrongCount',
];

/** Every key name at every depth, so a field added three levels down is caught like one at the top. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysIn(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, held] of Object.entries(value)) {
      found.add(key);
      keysIn(held, found);
    }
  }
  return found;
}

describe('the performance report — the payload whitelist', () => {
  /** The mirror of the public report's whitelist: a new key here is a decision, not a refactor. */
  it('carries exactly the fields the contract names and nothing else', async () => {
    const { student, older, seriesId } = await world();

    const sitting = await ofAttempt(student, older);
    const series = await service.report(
      student,
      query({ scope: PERFORMANCE_SCOPES.SERIES, seriesId }),
    );

    assert.deepEqual([...keysIn(series, keysIn(sitting))].toSorted(), REPORT_FIELDS);
  });
});

describe('the days a student sat a test on', () => {
  /** Evaluated sittings of one paper, one per instant; the calendar reads two columns and no paper. */
  async function satOn(instants: readonly string[], joined = '2026-08-01') {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const student = await makeStudent(prisma, { createdAt: new Date(`${joined}T00:00:00.000Z`) });
    for (const [index, at] of instants.entries()) {
      await sitPaper(prisma, {
        paper,
        studentId: student.id,
        chosen: [RIGHT_OPTION],
        attemptNo: index + 1,
        isGraded: index === 0,
        status: ATTEMPT_STATUS.EVALUATED,
        submittedAt: new Date(at),
      });
    }
    return student.id;
  }

  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

  /** 04:00 IST is 22:30 UTC the day before: the calendar files it on the institute's day. */
  it('counts by institute day, not by the UTC one the instant is stored in', async () => {
    const student = await satOn(['2026-09-07T22:30:00.000Z', '2026-09-08T04:00:00.000Z']);

    const { days } = await service.testDays(student);

    assert.deepEqual(days.toSorted(byDate), [{ date: '2026-09-08', sittings: 2 }]);
  });

  it('counts every sitting that landed on a day', async () => {
    const student = await satOn([
      '2026-09-06T06:00:00.000Z',
      '2026-09-06T09:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);

    const { days } = await service.testDays(student);

    assert.deepEqual(days.toSorted(byDate), [
      { date: '2026-09-06', sittings: 2 },
      { date: '2026-09-07', sittings: 1 },
    ]);
  });

  /** The account's own first institute day is the floor, and the client draws from it. */
  it('opens the window on the day the account was made', async () => {
    const student = await satOn(['2026-09-06T01:00:00.000Z'], '2026-08-15');

    assert.equal((await service.testDays(student)).from, '2026-08-15');
  });

  /** Nothing was sat before the account existed, so the floor cannot cut a sitting off. */
  it('keeps a sitting made on the opening day itself', async () => {
    const student = await satOn(['2026-09-06T01:00:00.000Z'], '2026-09-06');

    assert.deepEqual((await service.testDays(student)).days, [{ date: '2026-09-06', sittings: 1 }]);
  });

  it('answers a student who has sat nothing with no days rather than an error', async () => {
    const student = await satOn([]);

    assert.deepEqual((await service.testDays(student)).days, []);
  });

  it('refuses to answer for a student who is not there', async () => {
    await assert.rejects(() => service.testDays(uid()));
  });
});
