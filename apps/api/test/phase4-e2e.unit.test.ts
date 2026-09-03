import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type AppException,
} from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { redisKeys } from '../src/redis/redis.keys';
import {
  FakeEventBus,
  FakeQueue,
  fakeRollupOutbox,
  FakeRedis,
  FakeScoringPrisma,
  FakeStorage,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  mcqOptions,
  type FakeAttemptRow,
  type FakeServedAnswerRow,
} from './support/fakes';

const TEST_ID = 'tst_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');
const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR = 3_600_000;

/** Three questions, two marks each, half a mark off for a wrong one. The right option is `o2`. */
const SHAPE = makeScoredTest({
  totalQuestions: 3,
  totalMarks: 6,
  durationSec: 3600,
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

/** Who answered what: `o2` is right, `o1` is wrong, null is left alone. */
const COHORT: Readonly<Record<string, readonly (string | null)[]>> = {
  att_ace: ['o2', 'o2', 'o2'],
  att_middle: ['o1', 'o2', 'o2'],
  att_last: ['o1', 'o1', null],
};

/** Minutes taken, so equal marks would settle on speed rather than on nothing. */
const MINUTES: Readonly<Record<string, number>> = { att_ace: 25, att_middle: 20, att_last: 30 };

function sitting(id: string): FakeAttemptRow {
  return makeAttempt({
    id,
    studentId: `stu_${id}`,
    testId: TEST_ID,
    status: ATTEMPT_STATUS.SUBMITTED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + (MINUTES[id] ?? 0) * 60_000),
    score: null,
  });
}

function served(): FakeServedAnswerRow[] {
  return Object.entries(COHORT).flatMap(([attemptId, answers]) =>
    answers.map((selectedOptionId, seat) =>
      makeServedAnswer({
        attemptId,
        questionId: `q${seat + 1}`,
        order: seat + 1,
        options: mcqOptions(2),
        selectedOptionId,
        state: selectedOptionId === null ? ANSWER_STATE.NOT_VISITED : ANSWER_STATE.ANSWERED,
        timeSpentSec: 30,
      }),
    ),
  );
}

function platform(schedule: { scheduled: boolean; closesAt: string | null; extraTimeSec: number }) {
  const attempts = Object.keys(COHORT).map(sitting);
  const rows = served();
  const prisma = new FakeScoringPrisma(attempts, rows, SHAPE);
  const redis = new FakeRedis();
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  const access = { testSchedule: () => Promise.resolve(schedule) } as never;

  return {
    prisma,
    redis,
    rows,
    attempts,
    scoring: new ScoringProcessor(
      prisma.asService(),
      leaderboard,
      fakeRollupOutbox(prisma, new FakeQueue()),
      new FakeEventBus().asService(),
    ),
    reports: new AttemptReportService(
      prisma.asService(),
      access,
      leaderboard,
      new FakeStorage() as never,
    ),
  };
}

/** What the relay and the worker do between them, with the queue taken out of the middle. */
async function scoreEveryone(scoring: ScoringProcessor): Promise<void> {
  for (const attemptId of Object.keys(COHORT)) await scoring.score(attemptId);
}

const CLOSED = {
  scheduled: true,
  closesAt: new Date(NOW.getTime() - 4 * HOUR).toISOString(),
  extraTimeSec: 0,
};
const OPEN = {
  scheduled: true,
  closesAt: new Date(NOW.getTime() + HOUR).toISOString(),
  extraTimeSec: 0,
};

describe('a cohort, end to end: scored, ranked, reported', () => {
  it('scores every sitting exactly as the paper says', async () => {
    const { scoring, attempts } = platform(CLOSED);

    await scoreEveryone(scoring);

    assert.deepEqual(
      attempts.map((row) => [row.id, row.score, row.correctCount, row.wrongCount]),
      [
        ['att_ace', 6, 3, 0],
        ['att_middle', 3.5, 2, 1],
        ['att_last', -1, 0, 2],
      ],
    );
    assert.ok(attempts.every((row) => row.status === ATTEMPT_STATUS.EVALUATED));
  });

  it('ranks them off the board, best first', async () => {
    const { scoring, redis } = platform(CLOSED);

    await scoreEveryone(scoring);

    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), [
      'att_ace',
      'att_middle',
      'att_last',
    ]);
  });

  it('reports a score card that carries the rank and no answer key', async () => {
    const { scoring, reports } = platform(CLOSED);
    await scoreEveryone(scoring);

    const card = await reports.scoreCard('stu_att_middle', 'att_middle', NOW);

    assert.equal(card.score, 3.5);
    assert.equal(card.rank, 2);
    assert.equal(card.cohortSize, 3);
    assert.equal(card.provisional, false);
    // The one they missed: their own answer is there, and what was right is not.
    const missed = card.questions.find((row) => row.isCorrect === false);
    assert.equal(missed?.selectedOptionId, 'o1');
    // No question on a score card carries options at all, which is where a key would have to ride.
    assert.ok(card.questions.every((row) => !('options' in row)));
  });

  it('refuses the solutions while the test can still be sat, and serves them once it cannot', async () => {
    const shut = platform(OPEN);
    const open = platform(CLOSED);
    await scoreEveryone(shut.scoring);
    await scoreEveryone(open.scoring);

    await assert.rejects(
      () => shut.reports.solutions('stu_att_middle', 'att_middle', NOW),
      (error: AppException) => error.code === ErrorCodes.FORBIDDEN,
    );

    const report = await open.reports.solutions('stu_att_middle', 'att_middle', NOW);
    assert.equal(report.questions[0]?.options.find((option) => option.isCorrect)?.id, 'o2');
  });

  /** The acceptance for the whole run: one dropped question moves every affected score AND rank. */
  it('moves every score and every rank when one question is dropped', async () => {
    const { scoring, redis, rows, attempts } = platform(CLOSED);
    await scoreEveryone(scoring);
    const before = redis.descending(redisKeys.testLeaderboard(TEST_ID));

    // What the admin's change does to the paper, on every row serving that question.
    for (const row of rows.filter((one) => one.questionId === 'q1')) {
      row.paperItem = { marks: 2, negativeMarks: 0.5, status: PAPER_QUESTION_STATUS.DROPPED };
    }
    await scoreEveryone(scoring);

    // Everyone who ATTEMPTED it is paid; nobody left it, so all three move.
    assert.deepEqual(
      attempts.map((row) => [row.id, row.score]),
      [
        ['att_ace', 6],
        ['att_middle', 6],
        ['att_last', 1.5],
      ],
    );
    // The rank genuinely MOVES: level on marks, the board settles them on who finished sooner.
    assert.deepEqual(before, ['att_ace', 'att_middle', 'att_last']);
    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), [
      'att_middle',
      'att_ace',
      'att_last',
    ]);
  });

  it('scores the same cohort the same way however many times it runs', async () => {
    const { scoring, attempts } = platform(CLOSED);
    await scoreEveryone(scoring);
    const first = attempts.map((row) => [row.score, row.correctCount, row.evaluatedAt]);

    await scoreEveryone(scoring);

    assert.deepEqual(
      attempts.map((row) => [row.score, row.correctCount, row.evaluatedAt]),
      first,
    );
  });
});
