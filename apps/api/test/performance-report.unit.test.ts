import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ANSWER_STATE,
  ActorTypes,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  PAPER_QUESTION_STATUS,
  PERMISSION_LEVELS,
  performanceReportQuerySchema,
  type AnalyticsBucket,
} from '@iace/contracts';
import { type AuthenticatedUser } from '../src/common/security';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { AdminPerformanceController } from '../src/attempts/performance.controller';
import {
  cohortShapeOf,
  compositionOf,
  curveBandsOf,
  measure,
  sectionalStandingOf,
  type ReportedQuestion,
} from '../src/attempts/performance-analytics';

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

describe('the performance report — the query', () => {
  it('refuses a scope without the id that answers it', () => {
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'TEST' }).success, false);
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'SERIES' }).success, false);
    assert.equal(performanceReportQuerySchema.safeParse({ scope: 'ALL_TIME' }).success, true);
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
