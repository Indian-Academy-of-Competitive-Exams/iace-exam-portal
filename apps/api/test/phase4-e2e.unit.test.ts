import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, PAPER_QUESTION_STATUS } from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import {
  FakeEventBus,
  FakeLeaderboard,
  FakeQueue,
  fakeRollupOutbox,
  FakeScoringPrisma,
  FakeStorage,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  makeStanding,
  mcqOptions,
  type FakeAttemptRow,
  type FakeServedAnswerRow,
  fakeNotificationOutbox,
} from './support/fakes';

const TEST_ID = 'tst_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');

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

function platform() {
  const attempts = Object.keys(COHORT).map(sitting);
  const rows = served();
  const prisma = new FakeScoringPrisma(attempts, rows, SHAPE);
  const leaderboard = new FakeLeaderboard([
    makeStanding({
      attemptId: 'att_middle',
      studentId: 'stu_att_middle',
      rank: 2,
      percentile: 50,
      cohortSize: 3,
    }),
  ]);
  return {
    prisma,
    rows,
    attempts,
    scoring: new ScoringProcessor(
      prisma.asService(),
      fakeRollupOutbox(prisma, new FakeQueue()),
      new FakeEventBus().asService(),
      fakeNotificationOutbox(),
    ),
    reports: new AttemptReportService(
      prisma.asService(),
      leaderboard.asService(),
      new FakeStorage() as never,
    ),
  };
}

/** What the relay and the worker do between them, with the queue taken out of the middle. */
async function scoreEveryone(scoring: ScoringProcessor): Promise<void> {
  for (const attemptId of Object.keys(COHORT)) await scoring.score(attemptId);
}

describe('a cohort, end to end: scored, ranked, reported', () => {
  it('scores every sitting exactly as the paper says', async () => {
    const { scoring, attempts } = platform();

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

  it('reports a score card that carries the rank and no answer key', async () => {
    const { scoring, reports } = platform();
    await scoreEveryone(scoring);

    const card = await reports.scoreCard('stu_att_middle', 'att_middle');

    assert.equal(card.score, 3.5);
    assert.equal(card.rank, 2);
    assert.equal(card.cohortSize, 3);
    // The one they missed: their own answer is there, and what was right is not.
    const missed = card.questions.find((row) => row.isCorrect === false);
    assert.equal(missed?.selectedOptionId, 'o1');
    // No question on a score card carries options at all, which is where a key would have to ride.
    assert.ok(card.questions.every((row) => !('options' in row)));
  });

  /** A test never shuts, so the key rides on the student's own marked sitting and nothing else. */
  it('serves the solutions off the student’s own evaluated sitting', async () => {
    const open = platform();
    await scoreEveryone(open.scoring);

    const report = await open.reports.solutions('stu_att_middle', 'att_middle');

    assert.equal(report.questions[0]?.options.find((option) => option.isCorrect)?.id, 'o2');
  });

  /** The acceptance for the whole run: one dropped question rescores every sitting that attempted it. */
  it('moves every affected score, and keeps each sitting’s time, when one question is dropped', async () => {
    const { scoring, rows, attempts } = platform();
    await scoreEveryone(scoring);

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
    // Level on marks now, so the time written beside each score is what ranking separates them on.
    assert.deepEqual(
      attempts.map((row) => [row.id, row.timeTakenSec]),
      [
        ['att_ace', 1500],
        ['att_middle', 1200],
        ['att_last', 1800],
      ],
    );
  });

  it('scores the same cohort the same way however many times it runs', async () => {
    const { scoring, attempts } = platform();
    await scoreEveryone(scoring);
    const first = attempts.map((row) => [row.score, row.correctCount, row.evaluatedAt]);

    await scoreEveryone(scoring);

    assert.deepEqual(
      attempts.map((row) => [row.score, row.correctCount, row.evaluatedAt]),
      first,
    );
  });
});
