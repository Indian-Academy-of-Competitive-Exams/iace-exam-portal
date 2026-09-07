import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, ErrorCodes, type AppException } from '@iace/contracts';
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
  type FakeServedAnswerRow,
} from './support/fakes';

const STUDENT = 'stu_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');
const NOW = new Date('2026-09-01T09:00:00.000Z');

/** The option that WOULD have been right. It must not appear anywhere in a score card payload. */
const RIGHT_ANSWER = 'o_never_shown';

const SHAPE: FakeScoredTest = makeScoredTest({
  totalQuestions: 4,
  totalMarks: 8,
  durationSec: 3600,
  sections: [
    {
      id: 'sec_a',
      name: 'Section A',
      order: 1,
      questionCount: 2,
      marksPerQuestion: 2,
      durationSec: null,
    },
    {
      id: 'sec_b',
      name: 'Section B',
      order: 2,
      questionCount: 2,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

function answers(): FakeServedAnswerRow[] {
  return [
    makeServedAnswer({
      questionId: 'q1',
      order: 1,
      baseConfigSectionId: 'sec_a',
      selectedOptionId: 'o2',
      state: ANSWER_STATE.ANSWERED,
      isCorrect: true,
      marksAwarded: 2,
      timeSpentSec: 40,
    }),
    // Missed: they chose o1, and o_never_shown was right. The card must not say so.
    makeServedAnswer({
      questionId: 'q2',
      order: 2,
      baseConfigSectionId: 'sec_a',
      options: [{ id: RIGHT_ANSWER, position: 1, isCorrect: true }],
      selectedOptionId: 'o1',
      state: ANSWER_STATE.ANSWERED,
      isCorrect: false,
      marksAwarded: -0.5,
      timeSpentSec: 60,
    }),
    makeServedAnswer({
      questionId: 'q3',
      order: 3,
      baseConfigSectionId: 'sec_b',
      state: ANSWER_STATE.NOT_VISITED,
      isCorrect: null,
      marksAwarded: 0,
    }),
    makeServedAnswer({
      questionId: 'q4',
      order: 4,
      baseConfigSectionId: 'sec_b',
      state: ANSWER_STATE.NOT_ANSWERED,
      isCorrect: null,
      marksAwarded: 0,
      timeSpentSec: 15,
    }),
  ];
}

function scored(over: Partial<FakeAttemptRow> = {}): FakeAttemptRow {
  return makeAttempt({
    id: 'att_1',
    studentId: STUDENT,
    testId: 'tst_1',
    status: ATTEMPT_STATUS.EVALUATED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + 20 * 60_000),
    evaluatedAt: new Date(STARTED.getTime() + 21 * 60_000),
    score: 1.5,
    correctCount: 1,
    wrongCount: 1,
    unattemptedCount: 2,
    sectionScores: [
      {
        baseConfigSectionId: 'sec_a',
        score: 1.5,
        correctCount: 1,
        wrongCount: 1,
        unattemptedCount: 0,
        timeSpentSec: 100,
      },
      {
        baseConfigSectionId: 'sec_b',
        score: 0,
        correctCount: 0,
        wrongCount: 0,
        unattemptedCount: 2,
        timeSpentSec: 15,
      },
    ],
    ...over,
  });
}

/** How the test is offered institute-wide, which is what a final standing waits for. */
type Schedule = { closesAt: string | null; extraTimeSec: number };

const OPEN_ENDED: Schedule = { closesAt: null, extraTimeSec: 0 };

function report(attempts: FakeAttemptRow[], schedule: Schedule = OPEN_ENDED) {
  const prisma = new FakeScoringPrisma(attempts, answers(), SHAPE);
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
    leaderboard,
    service: new AttemptReportService(
      prisma.asService(),
      access,
      leaderboard,
      new FakeStorage() as never,
    ),
  };
}

describe('the Score Card', () => {
  /** The invariant the whole payload exists to protect. */
  it('never says what the right answer was, on a question they missed', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);
    const missed = card.questions.find((row) => row.questionId === 'q2');

    assert.equal(missed?.isCorrect, false);
    assert.equal(missed?.selectedOptionId, 'o1');
    assert.ok(
      !JSON.stringify(card).includes(RIGHT_ANSWER),
      'the correct option must not appear anywhere in a score card',
    );
  });

  it('reports the marks, the counts and the percentage the paper was worth', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);

    assert.equal(card.score, 1.5);
    assert.equal(card.maxMarks, 8);
    assert.equal(card.percentage, 18.75);
    assert.deepEqual([card.correctCount, card.wrongCount, card.unattemptedCount], [1, 1, 2]);
    assert.equal(card.timeTakenSec, 1200);
  });

  it('lays this sitting over every section, and prices each from the paper', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);

    assert.deepEqual(
      card.sections.map((section) => [section.name, section.score, section.unattemptedCount]),
      [
        ['Section A', 1.5, 0],
        ['Section B', 0, 2],
      ],
    );
    assert.equal(card.sections[1]?.maxMarks, 4);
  });

  it('reads a rank and a percentile off the live board', async () => {
    const attempt = scored();
    const rival = makeAttempt({
      id: 'att_2',
      studentId: 'stu_2',
      testId: 'tst_1',
      status: ATTEMPT_STATUS.EVALUATED,
      startedAt: STARTED,
      submittedAt: new Date(STARTED.getTime() + 30 * 60_000),
      score: 6,
    });
    const { service, leaderboard } = report([attempt, rival]);
    await leaderboard.record({ ...attempt, score: 1.5 });
    await leaderboard.record({ ...rival, score: 6 });

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);

    assert.equal(card.rank, 2);
    assert.equal(card.percentile, 25);
    assert.equal(card.cohortSize, 2);
  });

  /** The failure this prevents: a blank rank on screen while a wiped board is being put back. */
  it('falls back to the last snapshot when the live board cannot answer', async () => {
    const attempt = scored({ lastRank: 7, lastPercentile: 62.5 });
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);

    assert.equal(card.rank, 7);
    assert.equal(card.percentile, 62.5);
    assert.equal(card.cohortSize, null);
  });

  it('calls the standing provisional while anybody can still sit the paper', async () => {
    const attempt = scored();
    const open = report([attempt], {
      closesAt: new Date(NOW.getTime() + 60_000).toISOString(),
      extraTimeSec: 0,
    });
    const shut = report([attempt], {
      closesAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
      extraTimeSec: 0,
    });

    assert.equal((await open.service.scoreCard(STUDENT, attempt.id, NOW)).provisional, true);
    assert.equal((await shut.service.scoreCard(STUDENT, attempt.id, NOW)).provisional, false);
  });

  /** Entry closes, but whoever walked in at that instant still has the whole paper after it. */
  it('keeps it provisional until the last sitting that could have started has ended', async () => {
    const attempt = scored();
    const { service } = report([attempt], {
      closesAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
      extraTimeSec: 0,
    });

    assert.equal((await service.scoreCard(STUDENT, attempt.id, NOW)).provisional, true);
  });

  /** The failure this prevents: telling one branch a rank is final while another is still sitting. */
  it('never calls a standing final while entry is uncapped somewhere', async () => {
    const attempt = scored();
    const { service } = report([attempt], OPEN_ENDED);

    assert.equal((await service.scoreCard(STUDENT, attempt.id, NOW)).provisional, true);
  });

  /** The failure this prevents: a Redis outage taking the whole score card down with it. */
  it('still answers when the ranking cannot be reached, off the last snapshot', async () => {
    const attempt = scored({ lastRank: 4, lastPercentile: 80 });
    const { redis, service } = report([attempt]);
    redis.client.zcard = () => Promise.reject(new Error('redis unreachable'));

    const card = await service.scoreCard(STUDENT, attempt.id, NOW);

    assert.equal(card.rank, 4);
    assert.equal(card.percentile, 80);
  });

  it('refuses a paper nobody has marked yet, and says why', async () => {
    const attempt = scored({ status: ATTEMPT_STATUS.SUBMITTED, score: null });
    const { service } = report([attempt]);

    await assert.rejects(
      () => service.scoreCard(STUDENT, attempt.id, NOW),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
  });

  it('reads another student’s sitting as missing rather than as refused', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    await assert.rejects(
      () => service.scoreCard('stu_someone_else', attempt.id, NOW),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});
