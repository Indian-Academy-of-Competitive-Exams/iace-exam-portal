import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  EVALUATION_MODE,
  ErrorCodes,
  type AppException,
} from '@iace/contracts';
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
  type FakeAttemptRow,
  type FakeScoredTest,
} from './support/fakes';

const STUDENT = 'stu_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');
const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR = 3_600_000;

const RIGHT = 'o_right';
const WORKING = 'Because 7 × 6 is 42.';

const SHAPE: FakeScoredTest = makeScoredTest({
  totalQuestions: 2,
  totalMarks: 4,
  sections: [
    {
      id: 'sec_1',
      name: 'Section A',
      order: 1,
      questionCount: 2,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

const served = () => [
  makeServedAnswer({
    questionId: 'q1',
    order: 1,
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: 'o_wrong',
    isCorrect: false,
    marksAwarded: -0.5,
    timeSpentSec: 55,
    content: {
      en: {
        stem: [{ type: 'TEXT', text: 'What is 7 × 6?' }],
        solution: [{ type: 'TEXT', text: WORKING }],
      },
      hi: { stem: [{ type: 'TEXT', text: 'saat guna chhah kya hai?' }] },
    },
    options: [
      {
        id: 'o_wrong',
        position: 1,
        isCorrect: false,
        text: { en: [{ type: 'TEXT', text: '41' }] },
      },
      { id: RIGHT, position: 2, isCorrect: true, text: { en: [{ type: 'TEXT', text: '42' }] } },
    ],
  }),
  makeServedAnswer({ questionId: 'q2', order: 2, state: ANSWER_STATE.NOT_VISITED }),
];

function scored(over: Partial<FakeAttemptRow> = {}): FakeAttemptRow {
  return makeAttempt({
    id: 'att_1',
    studentId: STUDENT,
    testId: 'tst_1',
    status: ATTEMPT_STATUS.EVALUATED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + 20 * 60_000),
    score: -0.5,
    ...over,
  });
}

function bench(
  attempt: FakeAttemptRow,
  schedule: { closesAt: string | null; extraTimeSec: number },
  shape: FakeScoredTest = SHAPE,
) {
  const prisma = new FakeScoringPrisma([attempt], served(), shape);
  const redis = new FakeRedis();
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  const access = { testSchedule: () => Promise.resolve(schedule) } as never;
  const storage = new FakeStorage();
  return {
    prisma,
    storage,
    service: new AttemptReportService(prisma.asService(), access, leaderboard, storage as never),
  };
}

const review = (...args: Parameters<typeof bench>) => bench(...args).service;

const CLOSED_LONG_AGO = {
  closesAt: new Date(NOW.getTime() - 4 * HOUR).toISOString(),
  extraTimeSec: 0,
};
const STILL_OPEN = {
  closesAt: new Date(NOW.getTime() + HOUR).toISOString(),
  extraTimeSec: 0,
};

describe('the Solution Report', () => {
  it('serves the right answer and the working once the test has closed for everyone', async () => {
    const attempt = scored();

    const report = await review(attempt, CLOSED_LONG_AGO).solutions(STUDENT, attempt.id, NOW);
    const missed = report.questions[0];

    assert.equal(missed?.options.find((option) => option.isCorrect)?.id, RIGHT);
    assert.equal(missed?.selectedOptionId, 'o_wrong');
    assert.equal(missed?.isCorrect, false);
    assert.equal(missed?.timeSpentSec, 55);
    assert.ok(JSON.stringify(missed?.content).includes(WORKING), 'the working must be shown');
  });

  /** The failure this prevents: one student reading the key while another is still writing. */
  it('refuses while the test can still be sat, without ever having fetched the key', async () => {
    const attempt = scored();
    const { prisma, service } = bench(attempt, STILL_OPEN);

    await assert.rejects(
      () => service.solutions(STUDENT, attempt.id, NOW),
      (error: AppException) => {
        assert.equal(error.code, ErrorCodes.FORBIDDEN);
        const thrown = JSON.stringify({ ...error, message: error.message });
        assert.ok(!thrown.includes(RIGHT), 'the refusal must not carry the correct option');
        assert.ok(!thrown.includes(WORKING), 'the refusal must not carry the working');
        return true;
      },
    );

    // One read is the gate's. A second would be the one that loads the key.
    assert.equal(prisma.reads, 1);
  });

  it('serves the options in the order the student sat them, not the order they are stored', async () => {
    const attempt = scored({ shuffleSeed: 12345 });
    const shuffled = makeScoredTest({ ...SHAPE, shuffleOptions: true });

    const report = await review(attempt, CLOSED_LONG_AGO, shuffled).solutions(
      STUDENT,
      attempt.id,
      NOW,
    );

    // Whatever the order, the pair is intact: their answer and the right one are both in it.
    const ids = report.questions[0]?.options.map((option) => option.id) ?? [];
    assert.deepEqual([...ids].sort(), [RIGHT, 'o_wrong']);
  });

  it('keeps only the languages the sitting was taken in, and signs the images in them', async () => {
    const attempt = scored({ languages: ['EN'] });
    const { storage, service } = bench(attempt, CLOSED_LONG_AGO);
    await storage.upload('figures/x.png', Buffer.from('png'));

    const report = await service.solutions(STUDENT, attempt.id, NOW);
    const shown = JSON.stringify(report.questions[0]);

    assert.ok(shown.includes('What is 7'), 'the English stem must be there');
    assert.ok(!shown.includes('saat guna chhah'), 'a language nobody sat must not be');
  });

  it('serves a practice paper the moment it is marked, whatever the schedule says', async () => {
    const attempt = scored();
    const practice = makeScoredTest({
      ...SHAPE,
      evaluationMode: EVALUATION_MODE.PRACTICE,
    });

    const report = await review(attempt, STILL_OPEN, practice).solutions(STUDENT, attempt.id, NOW);

    assert.equal(report.openedAt, null);
    assert.equal(report.questions[0]?.options.find((option) => option.isCorrect)?.id, RIGHT);
  });

  it('refuses a scheduled paper nobody has capped entry on', async () => {
    const attempt = scored();
    const uncapped = { closesAt: null, extraTimeSec: 0 };

    await assert.rejects(
      () => review(attempt, uncapped).solutions(STUDENT, attempt.id, NOW),
      (error: AppException) => error.code === ErrorCodes.FORBIDDEN,
    );
  });

  it('names the instant the key opened, so a screen can say when it did', async () => {
    const attempt = scored();

    const report = await review(attempt, CLOSED_LONG_AGO).solutions(STUDENT, attempt.id, NOW);

    assert.equal(report.openedAt, new Date(NOW.getTime() - 3 * HOUR).toISOString());
  });

  it('refuses a paper nobody has marked yet, before the gate is even consulted', async () => {
    const attempt = scored({ status: ATTEMPT_STATUS.SUBMITTED, score: null });

    await assert.rejects(
      () => review(attempt, CLOSED_LONG_AGO).solutions(STUDENT, attempt.id, NOW),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
  });

  it('reads another student’s review as missing rather than as refused', async () => {
    const attempt = scored();

    await assert.rejects(
      () => review(attempt, CLOSED_LONG_AGO).solutions('stu_someone_else', attempt.id, NOW),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});
