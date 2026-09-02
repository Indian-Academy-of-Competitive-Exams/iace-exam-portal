import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  EVALUATION_MODE,
  PAPER_QUESTION_STATUS,
  TEST_SCOPE,
} from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { ROLLUP_TYPE } from '../src/attempts/rollup-fold';
import { cohortShapeOf, curveBandsOf, flagYours } from '../src/attempts/performance-analytics';
import { ROLLUP_JOBS } from '../src/queue/queues';
import {
  FakeEventBus,
  FakeQueue,
  FakeRedis,
  FakeRollupPrisma,
  fakeRollupOutbox,
  makeAttempt,
  makeRollupTest,
  makeServedAnswer,
  mcqOptions,
  type FakeAttemptRow,
  type FakeRollupTest,
  type FakeServedAnswerRow,
} from './support/fakes';

/** `o1` is the right answer on every question, so a choice reads as right, wrong or untouched. */
const RIGHT = 'o1';
const WRONG = 'o2';

/** Four questions on one paper: two Reasoning, two Maths, each worth 2 with 0.5 negative. */
function paper(attemptId: string, chosen: readonly (string | null)[]): FakeServedAnswerRow[] {
  return chosen.map((selectedOptionId, index) =>
    makeServedAnswer({
      attemptId,
      questionId: `q${index + 1}`,
      paperQuestionId: `pq${index + 1}`,
      subjectId: index < 2 ? 'sub_reasoning' : 'sub_maths',
      subjectName: index < 2 ? 'Reasoning' : 'Maths',
      order: index + 1,
      options: mcqOptions(1),
      selectedOptionId,
      timeSpentSec: 30,
    }),
  );
}

function sitting(id: string, overrides: Partial<FakeAttemptRow> = {}): FakeAttemptRow {
  return makeAttempt({
    id,
    status: ATTEMPT_STATUS.SUBMITTED,
    submittedAt: new Date('2026-08-24T05:00:00.000Z'),
    lastPercentile: 80,
    ...overrides,
  });
}

function world(
  attempts: FakeAttemptRow[],
  served: FakeServedAnswerRow[],
  tests: FakeRollupTest[] = [makeRollupTest()],
) {
  const prisma = new FakeRollupPrisma(attempts, served, tests);
  const queue = new FakeQueue();
  const outbox = fakeRollupOutbox(prisma, queue);
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    new FakeRedis().asService(),
    new FakeQueue().asQueue(),
  );
  return {
    prisma,
    queue,
    outbox,
    scoring: new ScoringProcessor(
      prisma.asService(),
      leaderboard,
      outbox,
      new FakeEventBus().asService(),
    ),
    rollup: new RollupService(prisma.asService()),
  };
}

type World = ReturnType<typeof world>;

/** What the queue holds, run the way the worker would run it. */
async function drain(built: World): Promise<number> {
  const jobs = built.queue.jobs.splice(0);
  for (const job of jobs) {
    const data = job.data as { attemptId?: string; testId?: string };
    if (job.name === ROLLUP_JOBS.FOLD && data.attemptId !== undefined) {
      await built.rollup.fold(data.attemptId);
    }
    if (job.name === ROLLUP_JOBS.REBUILD_TEST && data.testId !== undefined) {
      await built.rollup.rebuildForTest(data.testId);
    }
  }
  return jobs.length;
}

/** Everything one submitted sitting goes through: scored, handed on, and folded by the worker. */
async function counted(built: World, attemptId: string): Promise<void> {
  await built.scoring.score(attemptId);
  await drain(built);
}

/** When a rollup last looked is not part of what it says. */
function withoutStamps<T extends { computedAt: Date | null }>(rows: readonly T[]) {
  return rows.map(({ computedAt: _computedAt, ...row }) => ({ ...row, computedThrough: null }));
}

describe('RollupService — folding one sitting in', () => {
  it('counts a sitting once however many times its job is delivered', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, WRONG, null, RIGHT]));

    await counted(built, 'att_1');
    await built.rollup.fold('att_1');
    await built.rollup.fold('att_1');

    assert.equal(built.prisma.testStat.rows[0]?.evaluatedCount, 1);
    assert.equal(built.prisma.testStat.rows[0]?.sumScore, 3.5);
    assert.equal(built.prisma.studentStat.rows[0]?.testsAttempted, 1);
    assert.equal(built.prisma.processedRollups.length, 5);
  });

  it('writes the marks the scorer worked out, not a second opinion of them', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, WRONG, null, RIGHT]));

    await counted(built, 'att_1');

    const student = built.prisma.studentStat.rows[0];
    assert.deepEqual(
      [student?.totalCorrect, student?.totalWrong, student?.totalUnattempted],
      [2, 1, 1],
    );
    assert.equal(student?.totalAnswered, 3);
    assert.equal(student?.sumTimeSec, 120);
    assert.equal(student?.bestPercentile, 80);
    assert.notEqual(student?.computedThrough, null);
  });

  it('measures each question, and leaves discrimination for the pass that earns it', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, WRONG, null, RIGHT]));

    await counted(built, 'att_1');

    const measured = built.prisma.testQuestionStat.rows;
    assert.equal(measured.length, 4);
    assert.deepEqual(
      measured.map((row) => [row.attemptedCount, row.correctCount, row.skippedCount, row.pValue]),
      [
        [1, 1, 0, 1],
        [1, 0, 0, 0],
        [0, 0, 1, null],
        [1, 1, 0, 1],
      ],
    );
    assert.deepEqual(measured[0]?.optionCounts, { [RIGHT]: 1 });
    assert.equal(
      measured.every((row) => row.pValue === null || row.pValue <= 1),
      true,
    );
  });

  it('splits a sitting across the subjects it served', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, WRONG, null, RIGHT]));

    await counted(built, 'att_1');

    const subjects = built.prisma.studentSubjectStat.rows;
    assert.deepEqual(
      subjects.map((row) => [row.subjectId, row.attempted, row.correct, row.wrong]),
      [
        ['sub_reasoning', 2, 1, 1],
        ['sub_maths', 1, 1, 0],
      ],
    );
    assert.equal(
      subjects.every((row) => row.evaluationMode === EVALUATION_MODE.RANKED),
      true,
    );
  });
});

describe('RollupService — who the cohort is', () => {
  /** The flag is set per sitting, and a row written before it knew about retakes can still lie. */
  it('takes one sitting per student into the cohort and every one into their own totals', async () => {
    const first = sitting('att_1', { evaluatedAt: null });
    const again = sitting('att_2', { attemptNo: 2, isGraded: true, evaluatedAt: null });
    const built = world(
      [first, again],
      [
        ...paper('att_1', [RIGHT, RIGHT, RIGHT, RIGHT]),
        ...paper('att_2', [RIGHT, WRONG, null, null]),
      ],
    );

    await counted(built, 'att_1');
    await counted(built, 'att_2');

    assert.equal(built.prisma.testStat.rows[0]?.evaluatedCount, 1);
    assert.equal(built.prisma.testStat.rows[0]?.sumScore, 8);
    assert.equal(built.prisma.studentStat.rows[0]?.testsAttempted, 2);
    assert.equal(built.prisma.studentStat.rows[0]?.testsEvaluated, 2);
  });

  it('keeps a practice sitting out of the cohort and inside the student it belongs to', async () => {
    const built = world(
      [sitting('att_1', { isGraded: false })],
      paper('att_1', [RIGHT, WRONG, null, RIGHT]),
      [makeRollupTest({ evaluationMode: EVALUATION_MODE.PRACTICE, scope: TEST_SCOPE.SECTIONAL })],
    );

    await counted(built, 'att_1');

    assert.equal(built.prisma.testStat.rows.length, 0);
    assert.equal(built.prisma.testSectionStat.rows.length, 0);
    assert.equal(built.prisma.testQuestionStat.rows.length, 0);
    assert.equal(built.prisma.studentStat.rows[0]?.practiceAttempts, 1);
    assert.equal(built.prisma.studentStat.rows[0]?.testsEvaluated, 0);
    assert.equal(
      built.prisma.studentSubjectStat.rows.every(
        (row) => row.evaluationMode === EVALUATION_MODE.PRACTICE,
      ),
      true,
    );
    assert.deepEqual(
      built.prisma.processedRollups.map((row) => row.rollupType),
      [ROLLUP_TYPE.STUDENT, ROLLUP_TYPE.STUDENT_SUBJECT],
    );
  });
});

describe('RollupService — the curve it draws', () => {
  /** Three students, three scores, and the bands a report reads off the column. */
  async function cohort(): Promise<World> {
    const built = world(
      [
        sitting('att_1', { studentId: 'stu_1' }),
        sitting('att_2', { studentId: 'stu_2' }),
        sitting('att_3', { studentId: 'stu_3' }),
      ],
      [
        ...paper('att_1', [RIGHT, RIGHT, RIGHT, RIGHT]),
        ...paper('att_2', [RIGHT, RIGHT, WRONG, null]),
        ...paper('att_3', [WRONG, WRONG, WRONG, null]),
      ],
    );
    for (const id of ['att_1', 'att_2', 'att_3']) await counted(built, id);
    return built;
  }

  it('writes the bands the report reads, and the same ones counting the sittings would', async () => {
    const built = await cohort();
    const rolled = built.prisma.testStat.rows[0];
    const scores = built.prisma.attempts.map((row) => ({ score: row.score ?? 0, count: 1 }));

    const bands = curveBandsOf(rolled?.scoreHistogram, 8);

    assert.notEqual(bands.length, 0);
    assert.deepEqual(bands, flagYours(cohortShapeOf(scores).bands, 8));
    assert.equal(
      bands.reduce((total, band) => total + band.count, 0),
      3,
    );
    assert.equal(bands.filter((band) => band.isYours).length, 1);
  });

  it('keeps the extremes and the topper the curve is cut between', async () => {
    const built = await cohort();
    const rolled = built.prisma.testStat.rows[0];

    assert.equal(rolled?.maxScore, 8);
    assert.equal(rolled?.minScore, -1.5);
    assert.equal(rolled?.topperAttemptId, 'att_1');
    assert.equal(rolled?.evaluatedCount, 3);
  });
});

describe('RollupService — rebuilding a scope', () => {
  it('leaves a dropped question counted once, at the marks the re-score left', async () => {
    const built = world(
      [sitting('att_1', { studentId: 'stu_1' }), sitting('att_2', { studentId: 'stu_2' })],
      [
        ...paper('att_1', [WRONG, RIGHT, RIGHT, RIGHT]),
        ...paper('att_2', [WRONG, WRONG, null, null]),
      ],
    );
    for (const id of ['att_1', 'att_2']) await counted(built, id);
    assert.equal(built.prisma.testStat.rows[0]?.sumScore, 4.5);

    // What a drop does: q1 pays everyone who attempted it, and every sitting is re-scored.
    for (const row of built.prisma.served) {
      if (row.questionId !== 'q1' || row.paperItem === null) continue;
      row.paperItem = { ...row.paperItem, status: PAPER_QUESTION_STATUS.DROPPED };
    }
    for (const id of ['att_1', 'att_2']) await built.scoring.score(id);
    await drain(built);

    const after = built.prisma.testStat.rows[0];
    assert.equal(after?.evaluatedCount, 2);
    assert.equal(after?.sumScore, 9.5);
    assert.equal(
      after?.sumScore,
      built.prisma.attempts.reduce((total, row) => total + (row.score ?? 0), 0),
    );
    assert.equal(
      built.prisma.studentStat.rows.every((row) => row.testsAttempted === 1),
      true,
    );
    assert.equal(built.prisma.testQuestionStat.rows.length, 4);
  });

  it('asks for one rebuild of the test rather than one per sitting re-scored', async () => {
    const built = world(
      [sitting('att_1', { studentId: 'stu_1' }), sitting('att_2', { studentId: 'stu_2' })],
      [
        ...paper('att_1', [RIGHT, RIGHT, null, null]),
        ...paper('att_2', [WRONG, WRONG, null, null]),
      ],
    );
    for (const id of ['att_1', 'att_2']) await counted(built, id);

    for (const id of ['att_1', 'att_2']) await built.scoring.score(id);

    assert.deepEqual(
      built.queue.jobs.map((job) => [job.name, job.jobId]),
      [
        [ROLLUP_JOBS.REBUILD_TEST, 'rollup-rebuild-tst_1'],
        [ROLLUP_JOBS.REBUILD_TEST, 'rollup-rebuild-tst_1'],
      ],
    );
    assert.equal(built.prisma.outboxEvents.length, 2, 'a re-score writes no fold event of its own');
  });

  it('backfills to exactly what folding each sitting as it landed would have written', async () => {
    const sittings = () => [
      sitting('att_1', { studentId: 'stu_1' }),
      sitting('att_2', { studentId: 'stu_2' }),
      sitting('att_3', { studentId: 'stu_3' }),
    ];
    const papers = () => [
      ...paper('att_1', [RIGHT, RIGHT, RIGHT, null]),
      ...paper('att_2', [RIGHT, WRONG, null, RIGHT]),
      ...paper('att_3', [WRONG, null, null, null]),
    ];

    const folded = world(sittings(), papers());
    for (const id of ['att_1', 'att_2', 'att_3']) await counted(folded, id);

    // The sittings that were scored before any of this existed: evaluated, and never counted.
    const backfilled = world(sittings(), papers());
    for (const id of ['att_1', 'att_2', 'att_3']) await backfilled.scoring.score(id);
    backfilled.queue.jobs.length = 0;
    await backfilled.rollup.rebuildAll();

    assert.deepEqual(
      withoutStamps(backfilled.prisma.testStat.rows),
      withoutStamps(folded.prisma.testStat.rows),
    );
    assert.deepEqual(
      withoutStamps(backfilled.prisma.testSectionStat.rows),
      withoutStamps(folded.prisma.testSectionStat.rows),
    );
    assert.deepEqual(
      withoutStamps(backfilled.prisma.testQuestionStat.rows),
      withoutStamps(folded.prisma.testQuestionStat.rows),
    );
    assert.deepEqual(
      withoutStamps(backfilled.prisma.studentStat.rows),
      withoutStamps(folded.prisma.studentStat.rows),
    );
    assert.equal(backfilled.prisma.processedRollups.length, 15);
  });

  it('stops counting a practice paper that an older rule had marked graded', async () => {
    const built = world(
      [sitting('att_1', { isGraded: true })],
      paper('att_1', [RIGHT, RIGHT, RIGHT, RIGHT]),
      [makeRollupTest({ evaluationMode: EVALUATION_MODE.PRACTICE })],
    );
    await built.scoring.score('att_1');
    built.queue.jobs.length = 0;

    await built.rollup.rebuildAll();

    assert.equal(built.prisma.attempts[0]?.isGraded, false);
    assert.equal(built.prisma.testStat.rows.length, 0);
    assert.equal(built.prisma.studentStat.rows[0]?.practiceAttempts, 1);
  });
});

describe('RollupOutbox — getting the fold asked for', () => {
  it('leaves the event pending when the queue refuses it, and hands it on next sweep', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, RIGHT, null, null]));
    built.queue.failNext = true;

    await built.scoring.score('att_1');

    assert.equal(built.queue.jobs.length, 0);
    assert.equal(built.prisma.outboxEvents[0]?.processedAt, null);

    await built.outbox.relay();

    assert.equal(built.queue.jobs.length, 1);
    assert.notEqual(built.prisma.outboxEvents[0]?.processedAt, null);
  });

  /** Queued before it is marked, so the crash between the two costs a redelivery, never a count. */
  it('redelivers an event whose stamp never landed, and still folds it once', async () => {
    const built = world([sitting('att_1')], paper('att_1', [RIGHT, RIGHT, null, null]));
    const stamp = built.prisma.outboxEvent.update;
    built.prisma.outboxEvent.update = () => Promise.reject(new Error('gone before the stamp'));

    await built.scoring.score('att_1');
    assert.equal(built.queue.jobs.length, 1);
    assert.equal(built.prisma.outboxEvents[0]?.processedAt, null);

    built.prisma.outboxEvent.update = stamp;
    await built.outbox.relay();
    const delivered = await drain(built);

    assert.equal(delivered, 2);
    assert.equal(built.prisma.testStat.rows[0]?.evaluatedCount, 1);
    assert.equal(built.prisma.studentStat.rows[0]?.testsAttempted, 1);
  });
});
