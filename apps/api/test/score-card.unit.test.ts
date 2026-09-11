import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, ErrorCodes, type AppException } from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import {
  FakeLeaderboard,
  FakeScoringPrisma,
  FakeStorage,
  makeAttempt,
  makeStanding,
  makeScoredTest,
  makeServedAnswer,
  type FakeAttemptRow,
  type FakeScoredTest,
  type FakeServedAnswerRow,
} from './support/fakes';

const STUDENT = 'stu_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');

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

function report(attempts: FakeAttemptRow[], leaderboard = new FakeLeaderboard()) {
  const prisma = new FakeScoringPrisma(attempts, answers(), SHAPE);
  return {
    prisma,
    service: new AttemptReportService(
      prisma.asService(),
      leaderboard.asService(),
      new FakeStorage() as never,
    ),
  };
}

describe('the Score Card', () => {
  /** The invariant the whole payload exists to protect. */
  it('never says what the right answer was, on a question they missed', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id);
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

    const card = await service.scoreCard(STUDENT, attempt.id);

    assert.equal(card.score, 1.5);
    assert.equal(card.maxMarks, 8);
    assert.equal(card.percentage, 18.75);
    assert.deepEqual([card.correctCount, card.wrongCount, card.unattemptedCount], [1, 1, 2]);
    assert.equal(card.timeTakenSec, 1200);
  });

  it('lays this sitting over every section, and prices each from the paper', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id);

    assert.deepEqual(
      card.sections.map((section) => [section.name, section.score, section.unattemptedCount]),
      [
        ['Section A', 1.5, 0],
        ['Section B', 0, 2],
      ],
    );
    assert.equal(card.sections[1]?.maxMarks, 4);
  });

  it('reads the rank, the percentile and the cohort off the live standing', async () => {
    const attempt = scored();
    const leaderboard = new FakeLeaderboard([
      makeStanding({ attemptId: attempt.id, rank: 2, percentile: 25, cohortSize: 2 }),
    ]);
    const { service } = report([attempt], leaderboard);

    const card = await service.scoreCard(STUDENT, attempt.id);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [2, 25, 2]);
  });

  /** The failure this prevents: a retake quoting a rank, when only the ranked sitting has a standing. */
  it('shows no rank for a sitting outside the cohort', async () => {
    const attempt = scored({ isGraded: false, attemptNo: 2 });
    const { service } = report([attempt]);

    const card = await service.scoreCard(STUDENT, attempt.id);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [null, null, null]);
  });

  it('refuses a paper nobody has marked yet, and says why', async () => {
    const attempt = scored({ status: ATTEMPT_STATUS.SUBMITTED, score: null });
    const { service } = report([attempt]);

    await assert.rejects(
      () => service.scoreCard(STUDENT, attempt.id),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
  });

  it('reads another student’s sitting as missing rather than as refused', async () => {
    const attempt = scored();
    const { service } = report([attempt]);

    await assert.rejects(
      () => service.scoreCard('stu_someone_else', attempt.id),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});
