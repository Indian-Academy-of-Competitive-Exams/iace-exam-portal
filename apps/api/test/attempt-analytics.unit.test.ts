import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, DIFFICULTY_LEVEL } from '@iace/contracts';
import {
  bucketOf,
  bucketsBy,
  byDifficulty,
  strategyOf,
  timeUseOf,
  type AnalysedQuestion,
} from '../src/attempts/attempt-analytics';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import {
  FakeQueue,
  FakeRedis,
  FakeScoringPrisma,
  FakeStorage,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  rowAt,
} from './support/fakes';

function asked(overrides: Partial<AnalysedQuestion> = {}): AnalysedQuestion {
  return {
    baseConfigSectionId: 'sec_a',
    subjectId: 'sub_r',
    subjectName: 'Reasoning',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    state: ANSWER_STATE.ANSWERED,
    answered: true,
    isCorrect: true,
    marksAwarded: 2,
    timeSpentSec: 30,
    ...overrides,
  };
}

const right = asked();
const wrong = asked({ isCorrect: false, marksAwarded: -0.5, timeSpentSec: 60 });
const untouched = asked({
  answered: false,
  isCorrect: null,
  marksAwarded: 0,
  timeSpentSec: 0,
  state: ANSWER_STATE.NOT_VISITED,
});

// --------------------------------------------------------------------------- the derivations
// ---------------------------------------------------------------------------

describe('bucketOf', () => {
  /** The failure this prevents: a strong student who skipped half the paper reading as weak. */
  it('measures accuracy over what was attempted, not over the whole paper', () => {
    const bucket = bucketOf('all', 'Overall', [right, wrong, untouched, untouched]);

    assert.equal(bucket.total, 4);
    assert.equal(bucket.attempted, 2);
    assert.equal(bucket.unattempted, 2);
    assert.equal(bucket.accuracy, 50);
  });

  it('reads a paper nobody touched as no accuracy rather than as a division by zero', () => {
    const bucket = bucketOf('all', 'Overall', [untouched, untouched]);

    assert.equal(bucket.accuracy, 0);
    assert.equal(Number.isFinite(bucket.accuracy), true);
  });

  it('adds the marks the paper actually awarded, negatives and all', () => {
    assert.equal(bucketOf('all', 'Overall', [right, right, wrong]).marks, 3.5);
  });

  /** The failure this prevents: a broken answer key reading as a question they never opened. */
  it('counts an answer nothing could judge as attempted, and as neither right nor wrong', () => {
    const unjudgeable = asked({ answered: true, isCorrect: null, marksAwarded: 0 });
    const bucket = bucketOf('all', 'Overall', [right, unjudgeable]);

    assert.equal(bucket.attempted, 2);
    assert.equal(bucket.unattempted, 0);
    assert.equal(bucket.correct, 1);
    assert.equal(bucket.wrong, 0);
  });
});

describe('bucketsBy', () => {
  it('splits a paper by whatever key it is given, keeping the order it met them in', () => {
    const buckets = bucketsBy(
      [
        asked({ subjectId: 'sub_q', subjectName: 'Quant' }),
        right,
        asked({ subjectId: 'sub_q', subjectName: 'Quant', isCorrect: false }),
      ],
      (row) => row.subjectId,
      (row) => row.subjectName,
    );

    assert.deepEqual(
      buckets.map((bucket) => [bucket.name, bucket.total, bucket.accuracy]),
      [
        ['Quant', 2, 50],
        ['Reasoning', 1, 100],
      ],
    );
  });
});

describe('byDifficulty', () => {
  /** A band the paper never asked is a fact about the paper, so it is reported as empty. */
  it('reports every band, including one the paper never asked', () => {
    const buckets = byDifficulty([asked({ difficulty: DIFFICULTY_LEVEL.LOW })]);

    assert.deepEqual(
      buckets.map((bucket) => [bucket.key, bucket.total]),
      [
        [DIFFICULTY_LEVEL.LOW, 1],
        [DIFFICULTY_LEVEL.MEDIUM, 0],
        [DIFFICULTY_LEVEL.HIGH, 0],
      ],
    );
  });
});

describe('timeUseOf', () => {
  it('separates the time that earned marks from the time that lost them', () => {
    const time = timeUseOf([right, wrong, asked({ ...untouched, timeSpentSec: 12 })]);

    assert.equal(time.totalSec, 102);
    assert.equal(time.avgOnCorrectSec, 30);
    assert.equal(time.avgOnWrongSec, 60);
    assert.equal(time.spentOnUnattemptedSec, 12);
    assert.equal(time.avgPerQuestionSec, 34);
  });

  it('reports zero rather than NaN where there is nothing of that kind to average', () => {
    const time = timeUseOf([right]);

    assert.equal(time.avgOnWrongSec, 0);
  });
});

describe('strategyOf', () => {
  /** The failure this prevents: a stacked bar of these double-counting an answered-and-marked one. */
  it('partitions the paper, so the five counts sum to it exactly', () => {
    const rows = [
      asked({ state: ANSWER_STATE.ANSWERED_MARKED }),
      asked({ state: ANSWER_STATE.MARKED_REVIEW }),
      asked({ state: ANSWER_STATE.NOT_ANSWERED }),
      asked({ state: ANSWER_STATE.NOT_VISITED }),
      right,
    ];

    const strategy = strategyOf(rows);

    assert.deepEqual(strategy, {
      answered: 1,
      answeredAndMarked: 1,
      markedOnly: 1,
      seenAndLeft: 1,
      neverOpened: 1,
    });
    assert.equal(
      Object.values(strategy).reduce((sum, count) => sum + count, 0),
      rows.length,
    );
  });
});

// --------------------------------------------------------------------------- the endpoints
// ---------------------------------------------------------------------------

const STUDENT = 'stu_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');

const SHAPE = makeScoredTest({
  totalQuestions: 3,
  totalMarks: 6,
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

function bench() {
  const mine = makeAttempt({
    id: 'att_1',
    studentId: STUDENT,
    testId: 'tst_1',
    status: ATTEMPT_STATUS.EVALUATED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + 900_000),
    score: 3.5,
    correctCount: 2,
    wrongCount: 1,
    unattemptedCount: 0,
  });
  const rival = makeAttempt({
    id: 'att_2',
    studentId: 'stu_2',
    testId: 'tst_1',
    status: ATTEMPT_STATUS.EVALUATED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + 600_000),
    score: 6,
  });
  const served = [
    makeServedAnswer({
      questionId: 'q1',
      order: 1,
      selectedOptionId: 'o1',
      isCorrect: true,
      marksAwarded: 2,
    }),
    makeServedAnswer({
      questionId: 'q2',
      order: 2,
      selectedOptionId: 'o1',
      isCorrect: true,
      marksAwarded: 2,
      subjectId: 'sub_q',
      subjectName: 'Quant',
      difficulty: DIFFICULTY_LEVEL.HIGH,
    }),
    makeServedAnswer({
      questionId: 'q3',
      order: 3,
      selectedOptionId: 'o2',
      isCorrect: false,
      marksAwarded: -0.5,
      state: ANSWER_STATE.ANSWERED_MARKED,
    }),
  ];
  const prisma = new FakeScoringPrisma([mine, rival], served, SHAPE);
  const redis = new FakeRedis();
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  return {
    prisma,
    leaderboard,
    mine,
    rival,
    service: new AttemptReportService(prisma.asService(), leaderboard, new FakeStorage() as never),
  };
}

describe('the analytics one sitting can be asked for', () => {
  it('derives every figure from what the exam already wrote', async () => {
    const { service, mine } = bench();

    const report = await service.analytics(STUDENT, mine.id);

    assert.equal(report.overall.accuracy, 66.67);
    assert.deepEqual(
      report.subjects.map((bucket) => [bucket.name, bucket.correct]),
      [
        ['Reasoning', 1],
        ['Quant', 1],
      ],
    );
    assert.equal(report.difficulty.find((band) => band.key === DIFFICULTY_LEVEL.HIGH)?.correct, 1);
    assert.equal(report.strategy.answeredAndMarked, 1);
    assert.equal(report.sections[0]?.name, 'Section A');
  });

  it('sets this sitting against the cohort it was sat in', async () => {
    const { service, leaderboard, mine, rival } = bench();
    await leaderboard.record({ ...mine, score: 3.5 });
    await leaderboard.record({ ...rival, score: 6 });

    const report = await service.analytics(STUDENT, mine.id);

    assert.equal(report.cohort.score, 3.5);
    assert.equal(report.cohort.topperScore, 6);
    assert.equal(report.cohort.averageScore, 4.75);
    assert.equal(report.cohort.rank, 2);
  });

  it('refuses a paper nobody has marked yet', async () => {
    const { service, prisma, mine } = bench();
    rowAt(prisma.attempts).status = ATTEMPT_STATUS.SUBMITTED;

    await assert.rejects(() => service.analytics(STUDENT, mine.id));
  });
});

describe('the trend across every test a student has sat', () => {
  it('reads oldest first, so a chart draws left to right', async () => {
    const { service, prisma } = bench();
    prisma.attempts.push(
      makeAttempt({
        id: 'att_old',
        studentId: STUDENT,
        testId: 'tst_0',
        status: ATTEMPT_STATUS.EVALUATED,
        submittedAt: new Date('2026-08-01T05:00:00.000Z'),
        score: 1,
        correctCount: 1,
        wrongCount: 1,
      }),
    );

    const trend = await service.performance(STUDENT);

    assert.deepEqual(
      trend.points.map((point) => point.attemptId),
      ['att_old', 'att_1'],
    );
    assert.equal(trend.testsSat, 2);
    assert.equal(trend.points[0]?.accuracy, 50);
  });

  it('leaves another student’s sittings out of it', async () => {
    const { service } = bench();

    const trend = await service.performance(STUDENT);

    assert.equal(
      trend.points.every((point) => point.attemptId !== 'att_2'),
      true,
    );
  });
});
