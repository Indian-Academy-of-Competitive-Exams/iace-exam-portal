import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  ActorTypes,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  PAPER_QUESTION_STATUS,
  PERFORMANCE_SCOPES,
  PERMISSION_LEVELS,
  performanceReportQuerySchema,
  performanceReportSchema,
  type AnalyticsBucket,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { type AuthenticatedUser } from '../src/common/security';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { AdminPerformanceController } from '../src/attempts/performance.controller';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import {
  cohortShapeOf,
  compositionOf,
  curveBandsOf,
  difficultyStandingOf,
  measure,
  sectionalStandingOf,
  type ReportedQuestion,
} from '../src/attempts/performance-analytics';
import {
  FakePerformancePrisma,
  FakeQueue,
  FakeRedis,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  mcqOptions,
  type FakeAttemptRow,
  type FakePerformanceData,
} from './support/fakes';

const STUDENT = 'stu_1';
const RIVAL = 'stu_2';

function asked(overrides: Partial<ReportedQuestion> = {}): ReportedQuestion {
  return {
    baseConfigSectionId: 'sec_1',
    subjectId: 'sub_r',
    subjectName: 'Reasoning',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    state: ANSWER_STATE.ANSWERED,
    answered: true,
    isCorrect: true,
    marksAwarded: 2,
    timeSpentSec: 30,
    paperQuestionId: 'pq_1',
    marks: 2,
    negativeMarks: 0.5,
    disposition: PAPER_QUESTION_STATUS.ACTIVE,
    ...overrides,
  };
}

const bucket = (over: Partial<AnalyticsBucket> = {}): AnalyticsBucket => ({
  key: 'all',
  name: 'Overall',
  total: 4,
  attempted: 2,
  correct: 1,
  wrong: 1,
  unattempted: 2,
  accuracy: 50,
  marks: 1.5,
  timeSpentSec: 60,
  ...over,
});

// --------------------------------------------------------------------------- accuracy needs an n
// ---------------------------------------------------------------------------

describe('measure', () => {
  /** The failure this prevents: a band the paper never asked reading as a band they failed. */
  it('tells a bucket nobody attempted apart from a bucket they got wholly wrong', () => {
    const untouched = measure(bucket({ attempted: 0, correct: 0, wrong: 0, accuracy: 0 }));
    const allWrong = measure(bucket({ attempted: 3, correct: 0, wrong: 3, accuracy: 0 }));

    assert.equal(untouched.accuracy, null);
    assert.equal(untouched.attempted, 0);
    assert.equal(allWrong.accuracy, 0);
    assert.equal(allWrong.attempted, 3);
  });
});

// --------------------------------------------------------------------------- marks in, marks out
// ---------------------------------------------------------------------------

describe('compositionOf', () => {
  it('splits the paper into what it paid and the two ways it did not', () => {
    const composition = compositionOf([
      asked(),
      asked({ isCorrect: false, marksAwarded: -0.5 }),
      asked({ isCorrect: null, answered: false, marksAwarded: 0, state: ANSWER_STATE.NOT_VISITED }),
    ]);

    assert.equal(composition.maxMarks, 6);
    assert.equal(composition.earned, 2);
    assert.equal(composition.lostToWrong, 2);
    assert.equal(composition.lostToUnanswered, 2);
    assert.equal(composition.penalty, 0.5);
    assert.equal(composition.net, 1.5);
  });

  it('leaves the three buckets adding up to what the paper was worth', () => {
    const composition = compositionOf([
      asked(),
      asked({ isCorrect: false, marksAwarded: -0.5 }),
      asked({ isCorrect: null, answered: true, marksAwarded: 0 }),
      asked({ marks: 3, marksAwarded: 3 }),
    ]);

    assert.equal(
      composition.earned + composition.lostToWrong + composition.lostToUnanswered,
      composition.maxMarks,
    );
  });

  /** A dropped question pays everybody who attempted it, so charging the negative too is double. */
  it('does not charge negative marks on a question the paper dropped', () => {
    const composition = compositionOf([
      asked({
        isCorrect: false,
        marksAwarded: 2,
        disposition: PAPER_QUESTION_STATUS.DROPPED,
      }),
    ]);

    assert.equal(composition.penalty, 0);
    assert.equal(composition.earned, 2);
    assert.equal(composition.net, 2);
  });
});

// --------------------------------------------------------------------------- difficulty vs cohort
// ---------------------------------------------------------------------------

describe('difficultyStandingOf', () => {
  it('carries the cohort p-value with the number of questions it is a mean of', () => {
    const bands = difficultyStandingOf(
      [
        asked({ difficulty: DIFFICULTY_LEVEL.HIGH, paperQuestionId: 'pq_1' }),
        asked({ difficulty: DIFFICULTY_LEVEL.HIGH, paperQuestionId: 'pq_2', isCorrect: false }),
      ],
      new Map([
        ['pq_1', 0.2],
        ['pq_2', 0.4],
      ]),
    );
    const high = bands.find((band) => band.key === DIFFICULTY_LEVEL.HIGH);

    assert.equal(high?.cohortPValue, 0.3);
    assert.equal(high?.cohortQuestionCount, 2);
    assert.equal(high?.accuracy, 50);
  });

  /** An unmeasured band must not read as a band the cohort found impossible. */
  it('reports no p-value, and no questions behind it, where the cohort has not been rolled up', () => {
    const bands = difficultyStandingOf([asked({ difficulty: DIFFICULTY_LEVEL.LOW })], new Map());
    const low = bands.find((band) => band.key === DIFFICULTY_LEVEL.LOW);
    const untouched = bands.find((band) => band.key === DIFFICULTY_LEVEL.HIGH);

    assert.equal(low?.cohortPValue, null);
    assert.equal(low?.cohortQuestionCount, 0);
    assert.equal(untouched?.accuracy, null);
  });

  it('counts one paper question once however many times the student sat the paper', () => {
    const twice = [asked({ paperQuestionId: 'pq_1' }), asked({ paperQuestionId: 'pq_1' })];

    const bands = difficultyStandingOf(twice, new Map([['pq_1', 0.5]]));

    assert.equal(
      bands.find((band) => band.key === DIFFICULTY_LEVEL.MEDIUM)?.cohortQuestionCount,
      1,
    );
  });
});

// --------------------------------------------------------------------------- the cohort's curve
// ---------------------------------------------------------------------------

describe('curveBandsOf', () => {
  const histogram = [
    { from: 0, to: 10, count: 4 },
    { from: 10, to: 20, count: 9 },
    { from: 20, to: 30, count: 2 },
  ];

  it('flags exactly one column, the one this score falls in', () => {
    const bands = curveBandsOf(histogram, 12);

    assert.deepEqual(
      bands.map((band) => band.isYours),
      [false, true, false],
    );
  });

  it('keeps the top scorer inside the top band rather than off the end of the chart', () => {
    assert.equal(curveBandsOf(histogram, 30).at(-1)?.isYours, true);
    assert.equal(curveBandsOf(histogram, 44).at(-1)?.isYours, true);
  });

  /** Negative marking puts a score under the curve's floor, and a screen still needs a marker. */
  it('holds a score below the first band in the first band', () => {
    const bands = curveBandsOf(histogram, -4);

    assert.equal(bands.at(0)?.isYours, true);
    assert.equal(bands.filter((band) => band.isYours).length, 1);
  });

  /** No histogram is not a flat distribution: an empty curve is how a screen knows to say so. */
  it('reads a column nothing has written yet as no curve at all', () => {
    assert.deepEqual(curveBandsOf(null, 12), []);
    assert.deepEqual(curveBandsOf({ buckets: 3 }, 12), []);
  });
});

describe('cohortShapeOf', () => {
  /** The convention a rollup writer must match, pinned beside `scoreHistogramSchema`. */
  it('bands the scores into ascending, contiguous, equal-width columns holding every sitting', () => {
    const shape = cohortShapeOf([
      { score: 0, count: 1 },
      { score: 100, count: 3 },
      { score: 45.5, count: 2 },
    ]);

    assert.equal(shape.size, 6);
    assert.equal(shape.topperScore, 100);
    assert.equal(shape.averageScore, 65.17);
    assert.equal(shape.bands.at(0)?.from, 0);
    assert.equal(shape.bands.at(-1)?.to, 100);
    assert.equal(
      shape.bands.every((band, index) => index === 0 || band.from === shape.bands[index - 1]?.to),
      true,
    );
    assert.equal(
      shape.bands.reduce((sum, band) => sum + band.count, 0),
      6,
    );
  });

  /** Negative marking makes a floor below zero ordinary, and it must not fall off the curve. */
  it('starts the curve below zero when the cohort scored below zero', () => {
    const shape = cohortShapeOf([
      { score: -3.5, count: 2 },
      { score: 12, count: 1 },
    ]);

    assert.equal(shape.bands.at(0)?.from, -4);
    assert.equal(shape.bands.at(0)?.count, 2);
    assert.equal(
      shape.bands.reduce((sum, band) => sum + band.count, 0),
      3,
    );
  });

  it('counts no cohort at all where nobody has sat the paper', () => {
    assert.deepEqual(cohortShapeOf([]), {
      topperScore: null,
      averageScore: null,
      size: 0,
      bands: [],
    });
  });
});

describe('sectionalStandingOf', () => {
  const section = {
    baseConfigSectionId: 'sec_1',
    name: 'Section A',
    order: 1,
    questionCount: 3,
    maxMarks: 6,
    score: 3.5,
    correctCount: 2,
    wrongCount: 1,
    unattemptedCount: 0,
    timeSpentSec: 90,
  };

  it('reports the cohort mean with the number of sittings it is a mean of', () => {
    const [standing] = sectionalStandingOf(
      [section],
      new Map([['sec_1', { attempted: 4, sumScore: 14, sumTimeSec: 400 }]]),
    );

    assert.equal(standing?.cohortAverageScore, 3.5);
    assert.equal(standing?.cohortAverageTimeSec, 100);
    assert.equal(standing?.cohortSampleSize, 4);
  });

  it('reports no cohort mean at all where no rollup has counted one', () => {
    const [standing] = sectionalStandingOf([section], new Map());

    assert.equal(standing?.cohortAverageScore, null);
    assert.equal(standing?.cohortSampleSize, 0);
  });
});

// --------------------------------------------------------------------------- the service
// ---------------------------------------------------------------------------

const SHAPE = makeScoredTest({
  sections: [
    {
      id: 'sec_1',
      name: 'Section A',
      order: 1,
      questionCount: 3,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

function served(attemptId: string) {
  return [
    makeServedAnswer({
      attemptId,
      questionId: 'q1',
      paperQuestionId: 'pq_1',
      order: 1,
      selectedOptionId: 'o1',
      isCorrect: true,
      marksAwarded: 2,
      timeSpentSec: 40,
      state: ANSWER_STATE.ANSWERED,
      answerKey: { mode: 'EXACT', answers: { en: 'Option 1' } },
      options: mcqOptions(1),
    }),
    makeServedAnswer({
      attemptId,
      questionId: 'q2',
      paperQuestionId: 'pq_2',
      order: 2,
      difficulty: DIFFICULTY_LEVEL.HIGH,
      selectedOptionId: 'o3',
      isCorrect: false,
      marksAwarded: -0.5,
      timeSpentSec: 50,
      state: ANSWER_STATE.ANSWERED,
      options: mcqOptions(2),
    }),
    makeServedAnswer({
      attemptId,
      questionId: 'q3',
      paperQuestionId: 'pq_3',
      order: 3,
      marksAwarded: 0,
      timeSpentSec: 5,
    }),
  ];
}

function sittings(): FakeAttemptRow[] {
  const older = makeAttempt({
    id: 'att_1',
    testId: 'tst_1',
    studentId: STUDENT,
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: new Date('2026-08-20T06:00:00.000Z'),
    score: 1.5,
    lastRank: 4,
    lastPercentile: 60,
    sectionScores: [
      {
        baseConfigSectionId: 'sec_1',
        score: 1.5,
        correctCount: 1,
        wrongCount: 1,
        unattemptedCount: 1,
        timeSpentSec: 95,
      },
    ],
  });
  const newer = makeAttempt({
    id: 'att_2',
    testId: 'tst_2',
    studentId: STUDENT,
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: new Date('2026-08-25T06:00:00.000Z'),
    score: 4,
    lastRank: 2,
    lastPercentile: 88,
  });
  const theirs = makeAttempt({
    id: 'att_9',
    testId: 'tst_1',
    studentId: RIVAL,
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: new Date('2026-08-20T06:00:00.000Z'),
    score: 5.5,
  });

  return [older, newer, theirs];
}

function bench(overrides: Partial<FakePerformanceData> = {}) {
  const attempts = overrides.attempts ?? sittings();
  const data: FakePerformanceData = {
    attempts,
    served: attempts.flatMap((row) => served(row.id)),
    shape: SHAPE,
    students: [
      { id: STUDENT, deletedAt: null },
      { id: RIVAL, deletedAt: null },
    ],
    series: [{ id: 'ser_1', name: 'SSC CGL Foundation' }],
    seriesTests: [
      { testSeriesId: 'ser_1', testId: 'tst_1' },
      { testSeriesId: 'ser_1', testId: 'tst_2' },
    ],
    testStats: [],
    sectionStats: [],
    questionStats: [],
    ...overrides,
  };

  const prisma = new FakePerformancePrisma(data);
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    new FakeRedis().asService(),
    new FakeQueue().asQueue(),
  );
  return { data, service: new PerformanceAnalyticsService(prisma.asService(), leaderboard) };
}

const query = (input: unknown) => performanceReportQuerySchema.parse(input);

describe('the performance report — the query', () => {
  it('refuses a scope without the id that answers it', () => {
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'TEST' }).success, false);
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'SERIES' }).success, false);
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'ALL_TIME' }).success, true);
  });
});

describe('the performance report — one sitting', () => {
  it('answers with every figure derived from what the exam wrote', async () => {
    const { service } = bench();

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_1' }),
    );

    assert.equal(performanceReportSchema.safeParse(report).success, true);
    assert.equal(report.attemptsCounted, 1);
    assert.equal(report.scopeId, 'att_1');
    assert.equal(report.composition.net, 1.5);
    assert.equal(report.composition.penalty, 0.5);
    assert.equal(report.time.totalSec, 95);
    assert.equal(report.sections[0]?.score, 1.5);
  });

  /** No job writes a rollup today, so the sittings themselves are what makes the curve true. */
  it('counts the curve off the sittings when no rollup has been written', async () => {
    const { service } = bench();

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_1' }),
    );

    assert.equal(report.cohort?.topperScore, 5.5);
    assert.equal(report.cohort?.averageScore, 3.5);
    assert.equal(report.cohort?.cohortSize, 2);
    assert.equal(
      report.cohort?.bands.reduce((sum, band) => sum + band.count, 0),
      2,
    );
    assert.equal(report.cohort?.bands.filter((band) => band.isYours).length, 1);
  });

  it('prefers the rollup once one exists, and draws its curve', async () => {
    const { service } = bench({
      testStats: [
        {
          testId: 'tst_1',
          evaluatedCount: 40,
          sumScore: new Prisma.Decimal(120),
          maxScore: new Prisma.Decimal(6),
          scoreHistogram: [
            { from: 0, to: 3, count: 25 },
            { from: 3, to: 6, count: 15 },
          ],
        },
      ],
    });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_1' }),
    );

    assert.equal(performanceReportSchema.safeParse(report).success, true);
    assert.equal(report.cohort?.cohortSize, 40);
    assert.equal(report.cohort?.topperScore, 6);
    assert.equal(report.cohort?.averageScore, 3);
    assert.deepEqual(
      report.cohort?.bands.map((band) => band.isYours),
      [true, false],
    );
  });

  /** The rollup wins field by field, so a row without a histogram still keeps its counts. */
  it('counts the curve off the sittings when the rollup carries no histogram', async () => {
    const { service } = bench({
      testStats: [
        {
          testId: 'tst_1',
          evaluatedCount: 40,
          sumScore: new Prisma.Decimal(120),
          maxScore: new Prisma.Decimal(6),
          scoreHistogram: null,
        },
      ],
    });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_1' }),
    );

    assert.equal(report.cohort?.cohortSize, 40);
    assert.equal(report.cohort?.topperScore, 6);
    assert.equal(
      report.cohort?.bands.reduce((sum, band) => sum + band.count, 0),
      2,
    );
    assert.equal(report.cohort?.bands.filter((band) => band.isYours).length, 1);
  });

  /** The one guarantee that must hold at every scope and on both paths. */
  it('carries no answer key, no option and no question text', async () => {
    const { service } = bench();

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_1' }),
    );
    const payload = JSON.stringify(report);

    assert.equal(payload.includes('answerKey'), false);
    assert.equal(payload.includes('Option 1'), false);
    assert.equal(payload.includes('isCorrect'), false);
    assert.equal(payload.includes('questionVersion'), false);
  });

  it('reads a sitting that is not theirs as missing rather than refusing it', async () => {
    const { service } = bench();

    await assert.rejects(
      () =>
        service.report(STUDENT, query({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: 'att_9' })),
      (error: { code?: string }) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the performance report — one paper sat more than once', () => {
  const retake = () =>
    makeAttempt({
      id: 'att_3',
      testId: 'tst_1',
      studentId: STUDENT,
      attemptNo: 2,
      isGraded: false,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-22T06:00:00.000Z'),
      score: 3.5,
      sectionScores: [
        {
          baseConfigSectionId: 'sec_1',
          score: 3.5,
          correctCount: 2,
          wrongCount: 1,
          unattemptedCount: 0,
          timeSpentSec: 80,
        },
      ],
    });

  /** The failure this prevents: a 6-mark paper reporting 12 marks because it was sat twice. */
  it('describes the anchor sitting alone, so every figure shares one denominator', async () => {
    const { service } = bench({ attempts: [...sittings(), retake()] });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.TEST, testId: 'tst_1' }),
    );

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
    const { service } = bench({ attempts: [...sittings(), retake()] });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.TEST, testId: 'tst_1' }),
    );

    assert.equal(report.attemptsCounted, 2);
    assert.deepEqual(
      report.trajectory.map((point) => point.attemptId),
      ['att_1', 'att_3'],
    );
  });

  /** Postgres puts NULLs first on a descending sort, which made an unsubmitted sitting the newest. */
  it('never takes a sitting that was never submitted for the newest one', async () => {
    const abandoned = makeAttempt({
      id: 'att_4',
      testId: 'tst_1',
      studentId: STUDENT,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: null,
      score: 6,
      lastPercentile: 99,
      sectionScores: [
        {
          baseConfigSectionId: 'sec_1',
          score: 6,
          correctCount: 3,
          wrongCount: 0,
          unattemptedCount: 0,
          timeSpentSec: 60,
        },
      ],
    });
    const { service } = bench({ attempts: [...sittings(), abandoned] });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.TEST, testId: 'tst_1' }),
    );

    assert.equal(report.trajectory.at(-1)?.attemptId, 'att_1');
    assert.equal(report.sections[0]?.score, 1.5);
  });
});

describe('the performance report — the wider scopes', () => {
  it('plots percentile over the sittings in order, oldest first, and never marks', async () => {
    const { service } = bench();

    const report = await service.report(STUDENT, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));

    assert.equal(report.scopeId, null);
    assert.deepEqual(
      report.trajectory.map((point) => [point.attemptId, point.percentile]),
      [
        ['att_1', 60],
        ['att_2', 88],
      ],
    );
    assert.equal(
      report.trajectory.some((point) => Object.hasOwn(point, 'score')),
      false,
    );
  });

  it('carries the n behind each percentile once a rollup has counted the cohort', async () => {
    const { service } = bench({
      testStats: [
        { testId: 'tst_1', evaluatedCount: 40, sumScore: 120, maxScore: 6, scoreHistogram: null },
      ],
    });

    const report = await service.report(STUDENT, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));

    assert.deepEqual(
      report.trajectory.map((point) => point.cohortSize),
      [40, null],
    );
  });

  /** Two papers do not share a distribution, so a curve across them would be a lie. */
  it('draws no cohort curve for a scope that spans more than one paper', async () => {
    const { service } = bench();

    const wide = await service.report(STUDENT, query({ scope: PERFORMANCE_SCOPES.ALL_TIME }));
    const series = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.SERIES, seriesId: 'ser_1' }),
    );

    assert.equal(wide.cohort, null);
    assert.equal(series.cohort, null);
    assert.equal(series.label, 'SSC CGL Foundation');
    assert.equal(series.attemptsCounted, 2);
  });

  it('folds only the sittings the series holds', async () => {
    const { service } = bench({
      seriesTests: [{ testSeriesId: 'ser_1', testId: 'tst_2' }],
    });

    const report = await service.report(
      STUDENT,
      query({ scope: PERFORMANCE_SCOPES.SERIES, seriesId: 'ser_1' }),
    );

    assert.equal(report.attemptsCounted, 1);
    assert.equal(report.trajectory[0]?.testId, 'tst_2');
  });
});

describe('the performance report — the admin path', () => {
  it('reads any student it is asked for', async () => {
    const { service } = bench();

    const report = await service.forStudent(
      RIVAL,
      query({ scope: PERFORMANCE_SCOPES.TEST, testId: 'tst_1' }),
    );

    assert.equal(report.studentId, RIVAL);
    assert.equal(report.attemptsCounted, 1);
    assert.equal(JSON.stringify(report).includes('answerKey'), false);
  });

  it('reads an unknown student as missing rather than as a student with nothing', async () => {
    const { service } = bench();

    await assert.rejects(
      () => service.forStudent('stu_nope', query({ scope: PERFORMANCE_SCOPES.ALL_TIME })),
      (error: { code?: string }) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the performance report — the permission on the admin route', () => {
  const guard = new FeaturePermissionGuard(new Reflector());

  function contextFor(user: Partial<AuthenticatedUser>): ExecutionContext {
    const request = {
      user: {
        id: 'adm_1',
        actor: ActorTypes.ADMIN,
        isActive: true,
        isSuperAdmin: false,
        permissions: {},
        ...user,
      },
    };
    return {
      getHandler: () => AdminPerformanceController.prototype.report,
      getClass: () => AdminPerformanceController,
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
      permissions: {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
      },
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
