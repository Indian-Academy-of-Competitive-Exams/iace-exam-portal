import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PAPER_QUESTION_STATUS, TEST_SCOPE, type TestScope } from '@iace/contracts';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { ROLLUP_TYPE } from '../src/attempts/rollup-fold';
import { ROLLUP_REQUEST, RollupOutbox } from '../src/attempts/rollup-outbox';
import { cohortShapeOf, curveBandsOf, flagYours } from '../src/attempts/performance-analytics';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FOLD_PENDING_JOB_ID, RELAY_BATCH, ROLLUP_JOBS } from '../src/queue/queues';
import { FakeEventBus, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  disposeQuestion,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
} from './support/database';

const RIGHT = RIGHT_OPTION;
const WRONG = 'o2';

/** Four questions: two Reasoning, two Maths, each worth 2 with 0.5 negative. */
const SUBJECTS = ['Reasoning', 'Reasoning', 'Maths', 'Maths'];

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(rollupClient: PrismaService = prisma) {
  const queue = new FakeQueue();
  const outbox = new RollupOutbox(queue.asQueue());
  return {
    queue,
    outbox,
    scoring: new ScoringProcessor(
      prisma,
      outbox,
      new FakeEventBus().asService(),
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
    ),
    rollup: new RollupService(rollupClient),
  };
}

type World = ReturnType<typeof build>;

const paperOf = (scope: TestScope = TEST_SCOPE.FULL) =>
  makePaper(prisma, { questions: SUBJECTS, scope });

/** A sitting of the paper, by a new student unless one is named. */
async function sat(
  paper: Paper,
  chosen: readonly (string | null)[],
  over: { studentId?: string; attemptNo?: number; isGraded?: boolean } = {},
) {
  const studentId = over.studentId ?? (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, { paper, studentId, chosen, ...over });
  return { attemptId: attempt.id, studentId };
}

/** What the queue holds, run the way the worker would run it. */
async function drain(built: World): Promise<number> {
  const jobs = built.queue.jobs.splice(0);
  for (const job of jobs) {
    const data = job.data as { testId?: string };
    if (job.name === ROLLUP_JOBS.FOLD_PENDING) await built.rollup.foldPending();
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

/** Decimals and BigInts as JSON reads them, so two snapshots compare by value. */
const plain = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_key, held: unknown) =>
      typeof held === 'bigint' ? Number(held) : held,
    ),
  ) as T;

/** When a rollup last looked is not part of what it says. */
const withoutStamps = <T extends { computedAt: Date }>(rows: readonly T[]) =>
  plain(rows.map(({ computedAt: _computedAt, ...row }) => ({ ...row, computedThrough: null })));

const testStat = (testId: string) => prisma.testStat.findUnique({ where: { testId } });
const studentStat = (studentId: string) => prisma.studentStat.findUnique({ where: { studentId } });
const num = (value: unknown) => (value === null || value === undefined ? value : Number(value));

async function cohortRows(testId: string) {
  return {
    test: withoutStamps(await prisma.testStat.findMany({ where: { testId } })),
    sections: withoutStamps(
      await prisma.testSectionStat.findMany({
        where: { testId },
        orderBy: { baseConfigSectionId: 'asc' },
      }),
    ),
    questions: withoutStamps(
      await prisma.testQuestionStat.findMany({
        where: { testId },
        orderBy: { paperQuestionId: 'asc' },
      }),
    ),
  };
}

const rollupRequests = () =>
  prisma.outboxEvent.findMany({ where: { eventType: ROLLUP_REQUEST.EVENT_TYPE } });

describe('RollupService — folding one sitting in', () => {
  it('counts one sitting into every aggregate it belongs to, and guards each', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await counted(built, attemptId);

    const rolled = await testStat(paper.testId);
    assert.equal(rolled?.evaluatedCount, 1);
    assert.equal(num(rolled?.sumScore), 3.5);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
    assert.equal(await prisma.processedRollup.count(), 5);
  });

  it('writes the marks the scorer worked out, not a second opinion of them', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await counted(built, attemptId);

    const student = await studentStat(studentId);
    assert.deepEqual(
      [student?.totalCorrect, student?.totalWrong, student?.totalUnattempted],
      [2, 1, 1],
    );
    assert.equal(student?.totalAnswered, 3);
    assert.equal(num(student?.sumTimeSec), 120);
    assert.notEqual(student?.computedThrough, null);
  });

  it('measures each question, and leaves discrimination for the pass that earns it', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await counted(built, attemptId);

    const rows = await prisma.testQuestionStat.findMany({ where: { testId: paper.testId } });
    const measured = paper.items.map((item) =>
      rows.find((row) => row.paperQuestionId === item.paperQuestionId),
    );
    assert.equal(rows.length, 4);
    assert.deepEqual(
      measured.map((row) => [
        row?.attemptedCount,
        row?.correctCount,
        row?.skippedCount,
        num(row?.pValue),
      ]),
      [
        [1, 1, 0, 1],
        [1, 0, 0, 0],
        [0, 0, 1, null],
        [1, 1, 0, 1],
      ],
    );
    assert.deepEqual(measured[0]?.optionCounts, { [RIGHT]: 1 });
    assert.equal(
      measured.every((row) => row?.pValue === null || Number(row?.pValue) <= 1),
      true,
    );
  });

  it('splits a sitting across the subjects it served', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await counted(built, attemptId);

    const rows = await prisma.studentSubjectStat.findMany({ where: { studentId } });
    const tallyOf = (subjectId: string | undefined) => {
      const row = rows.find((held) => held.subjectId === subjectId);
      return [row?.attempted, row?.correct, row?.wrong];
    };
    assert.equal(rows.length, 2);
    assert.deepEqual(tallyOf(paper.items[0]?.subjectId), [2, 1, 1]);
    assert.deepEqual(tallyOf(paper.items[2]?.subjectId), [1, 1, 0]);
  });
});

describe('RollupService — folding a pending batch', () => {
  it('lands on the same aggregates a rebuild would compute', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, WRONG, null]);
    const second = await sat(paper, [RIGHT, WRONG, WRONG, null]);
    await built.scoring.score(first.attemptId);
    await built.scoring.score(second.attemptId);

    assert.equal(await built.rollup.foldPending(), 2);
    const batched = await cohortRows(paper.testId);

    await built.rollup.rebuildTest(paper.testId);

    assert.deepEqual(await cohortRows(paper.testId), batched);

    // A second page lands on a populated TestStat, where the batched curve is really moved.
    const third = await sat(paper, [RIGHT, WRONG, null, null]);
    const fourth = await sat(paper, [RIGHT, RIGHT, WRONG, WRONG]);
    await built.scoring.score(third.attemptId);
    await built.scoring.score(fourth.attemptId);

    await built.rollup.foldPending();
    const moved = await cohortRows(paper.testId);

    await built.rollup.rebuildTest(paper.testId);

    assert.deepEqual((await cohortRows(paper.testId)).test, moved.test);
  });

  /** Stamped only once counted, and a stamped row is never claimed again: the second pass idles. */
  it('claims nothing from a page it has already stamped', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    await built.scoring.score(attemptId);

    assert.equal(await built.rollup.foldPending(), 1);
    const once = await cohortRows(paper.testId);

    assert.equal(await built.rollup.foldPending(), 0);

    assert.deepEqual(await cohortRows(paper.testId), once);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
    assert.equal(await prisma.processedRollup.count(), 5);
  });

  /** Two passes run at once at concurrency 2, so a later page can hold a sitting already counted. */
  it('counts a sitting once when a redelivered request lands in a later page', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    const second = await sat(paper, [RIGHT, WRONG, null, null]);
    await built.scoring.score(first.attemptId);
    assert.equal(await built.rollup.foldPending(), 1);

    await prisma.outboxEvent.create({
      data: {
        aggregateType: ROLLUP_REQUEST.AGGREGATE_TYPE,
        aggregateId: first.attemptId,
        eventType: ROLLUP_REQUEST.EVENT_TYPE,
        payload: {},
      },
    });
    await built.scoring.score(second.attemptId);

    assert.equal(await built.rollup.foldPending(), 2);

    const rolled = await testStat(paper.testId);
    assert.equal(rolled?.evaluatedCount, 2);
    assert.equal(num(rolled?.sumScore), 9.5);
    assert.equal((await studentStat(first.studentId))?.testsAttempted, 1);
    assert.equal(await prisma.processedRollup.count(), 10);
  });

  /** Asking for another pass from inside one is a no-op, so the backlog is drained here or not at all. */
  it('drains a backlog wider than one page without waiting for the next sweep', async () => {
    const built = build();
    const paper = await paperOf();
    for (let at = 1; at <= RELAY_BATCH + 1; at += 1) {
      const { attemptId } = await sat(paper, [at % 2 === 0 ? RIGHT : WRONG, null, null, null]);
      await built.scoring.score(attemptId);
    }

    assert.equal(await built.rollup.foldPending(), RELAY_BATCH + 1);

    assert.equal((await testStat(paper.testId))?.evaluatedCount, RELAY_BATCH + 1);
    assert.equal(await built.rollup.foldPending(), 0);
  });

  it('folds a retake in the page into the student and never into the cohort', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    const retake = await sat(paper, [RIGHT, WRONG, null, null], {
      studentId: first.studentId,
      attemptNo: 2,
      isGraded: false,
    });
    await built.scoring.score(first.attemptId);
    await built.scoring.score(retake.attemptId);

    assert.equal(await built.rollup.foldPending(), 2);

    const rolled = await testStat(paper.testId);
    assert.equal(rolled?.evaluatedCount, 1);
    assert.equal(num(rolled?.sumScore), 8);
    const student = await studentStat(first.studentId);
    assert.equal(student?.testsAttempted, 2);
    assert.equal(student?.retakeCount, 1);
  });

  /** The hole this closes: a row marked when the job was QUEUED left a sitting nobody ever counted. */
  it('leaves the outbox row pending when the fold throws, and counts it on the next pass', async () => {
    const built = build(failingOnceOnTestStatUpsert(prisma));
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, null, null, null]);
    await built.scoring.score(attemptId);

    await assert.rejects(() => built.rollup.foldPending());

    assert.equal((await rollupRequests())[0]?.processedAt, null);
    assert.equal(await prisma.testStat.count(), 0);

    assert.equal(await built.rollup.foldPending(), 1);

    assert.equal((await testStat(paper.testId))?.evaluatedCount, 1);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
    assert.notEqual((await rollupRequests())[0]?.processedAt, null);
  });
});

describe('RollupService — who the cohort is', () => {
  it('keeps a retake out of the cohort and inside the student it belongs to', async () => {
    const built = build();
    const paper = await paperOf(TEST_SCOPE.SECTIONAL);
    const retake = await sat(paper, [RIGHT, WRONG, null, RIGHT], { attemptNo: 2, isGraded: false });

    await counted(built, retake.attemptId);

    assert.equal(await prisma.testStat.count(), 0);
    assert.equal(await prisma.testSectionStat.count(), 0);
    assert.equal(await prisma.testQuestionStat.count(), 0);
    const student = await studentStat(retake.studentId);
    assert.equal(student?.retakeCount, 1);
    assert.equal(student?.testsEvaluated, 0);
    const guards = await prisma.processedRollup.findMany();
    assert.deepEqual(
      guards.map((row) => row.rollupType).sort(),
      [ROLLUP_TYPE.STUDENT, ROLLUP_TYPE.STUDENT_SUBJECT].sort(),
    );
  });

  /** One subject tally per scope, so a retake's answers land beside the first sitting's. */
  it('adds a retake to the same subject tallies as the first sitting of the paper', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    const retake = await sat(paper, [RIGHT, WRONG, null, RIGHT], {
      studentId: first.studentId,
      attemptNo: 2,
      isGraded: false,
    });

    await counted(built, first.attemptId);
    await counted(built, retake.attemptId);

    assert.equal((await testStat(paper.testId))?.evaluatedCount, 1);
    const student = await studentStat(first.studentId);
    assert.equal(student?.testsAttempted, 2);
    assert.equal(student?.retakeCount, 1);
    const rows = await prisma.studentSubjectStat.findMany({
      where: { studentId: first.studentId },
    });
    const tallyOf = (subjectId: string | undefined) => {
      const row = rows.find((held) => held.subjectId === subjectId);
      return [row?.scope, row?.attempted, row?.correct];
    };
    assert.deepEqual(tallyOf(paper.items[0]?.subjectId), [TEST_SCOPE.FULL, 4, 3]);
    assert.deepEqual(tallyOf(paper.items[2]?.subjectId), [TEST_SCOPE.FULL, 3, 3]);
  });
});

describe('RollupService — the curve it draws', () => {
  /** Three students, three scores, and the bands a report reads off the column. */
  async function cohort() {
    const built = build();
    const paper = await paperOf();
    const top = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    const middle = await sat(paper, [RIGHT, RIGHT, WRONG, null]);
    const bottom = await sat(paper, [WRONG, WRONG, WRONG, null]);
    for (const { attemptId } of [top, middle, bottom]) await counted(built, attemptId);
    return { paper, top };
  }

  it('writes the bands the report reads, and the same ones counting the sittings would', async () => {
    const { paper } = await cohort();
    const rolled = await testStat(paper.testId);
    const sittings = await prisma.attempt.findMany({ where: { testId: paper.testId } });
    const scores = sittings.map((row) => ({ score: Number(row.score ?? 0), count: 1 }));

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
    const { paper, top } = await cohort();
    const rolled = await testStat(paper.testId);

    assert.equal(num(rolled?.maxScore), 8);
    assert.equal(num(rolled?.minScore), -1.5);
    assert.equal(rolled?.topperAttemptId, top.attemptId);
    assert.equal(rolled?.evaluatedCount, 3);
  });
});

describe('RollupService — rebuilding a scope', () => {
  it('leaves a dropped question counted once, at the marks the re-score left', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [WRONG, RIGHT, RIGHT, RIGHT]);
    const second = await sat(paper, [WRONG, WRONG, null, null]);
    for (const { attemptId } of [first, second]) await counted(built, attemptId);
    assert.equal(num((await testStat(paper.testId))?.sumScore), 4.5);

    // What a drop does: the question pays everyone who attempted it, and every sitting is re-scored.
    await disposeQuestion(prisma, paper, 0, PAPER_QUESTION_STATUS.DROPPED);
    for (const { attemptId } of [first, second]) await built.scoring.score(attemptId);
    await drain(built);

    const rolled = await testStat(paper.testId);
    const sittings = await prisma.attempt.findMany({ where: { testId: paper.testId } });
    assert.equal(rolled?.evaluatedCount, 2);
    assert.equal(num(rolled?.sumScore), 9.5);
    assert.equal(
      num(rolled?.sumScore),
      sittings.reduce((total, row) => total + Number(row.score ?? 0), 0),
    );
    const students = await prisma.studentStat.findMany();
    assert.equal(
      students.every((row) => row.testsAttempted === 1),
      true,
    );
    assert.equal(await prisma.testQuestionStat.count(), 4);
  });

  it('asks for one rebuild of the test rather than one per sitting re-scored', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, null, null]);
    const second = await sat(paper, [WRONG, WRONG, null, null]);
    for (const { attemptId } of [first, second]) await counted(built, attemptId);

    for (const { attemptId } of [first, second]) await built.scoring.score(attemptId);

    assert.deepEqual(
      built.queue.jobs.map((job) => [job.name, job.jobId]),
      [[ROLLUP_JOBS.REBUILD_TEST, `rollup-rebuild-${paper.testId}`]],
    );
    // By type: scoring writes a notification request into the same table, and that is not a fold.
    assert.equal((await rollupRequests()).length, 2, 'a re-score writes no fold event of its own');
  });

  /** Sittings scored before the worker existed are evaluated and never counted, which rebuildAll owns. */
  it('backfills to exactly what folding each sitting as it landed would have written', async () => {
    const built = build();
    const paper = await paperOf();
    const sittings = [
      await sat(paper, [RIGHT, RIGHT, RIGHT, null]),
      await sat(paper, [RIGHT, WRONG, null, RIGHT]),
      await sat(paper, [WRONG, null, null, null]),
    ];
    for (const { attemptId } of sittings) await counted(built, attemptId);
    const studentRows = async () =>
      withoutStamps(await prisma.studentStat.findMany({ orderBy: { studentId: 'asc' } }));
    const folded = { cohort: await cohortRows(paper.testId), students: await studentRows() };

    await prisma.$transaction([
      prisma.testQuestionStat.deleteMany(),
      prisma.testSectionStat.deleteMany(),
      prisma.testStat.deleteMany(),
      prisma.studentSubjectStat.deleteMany(),
      prisma.studentStat.deleteMany(),
      prisma.processedRollup.deleteMany(),
    ]);
    await built.rollup.rebuildAll();

    assert.deepEqual(await cohortRows(paper.testId), folded.cohort);
    assert.deepEqual(await studentRows(), folded.students);
    assert.equal(await prisma.processedRollup.count(), 15);
  });
});

describe('RollupOutbox — getting the fold asked for', () => {
  it('asks for one fold pass however many sittings are evaluated', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, null, null, null]);
    const second = await sat(paper, [RIGHT, null, null, null]);

    await built.scoring.score(first.attemptId);
    await built.scoring.score(second.attemptId);

    const folds = built.queue.jobs.filter((job) => job.name === ROLLUP_JOBS.FOLD_PENDING);
    assert.equal(folds.length, 1);
    assert.equal(folds[0]?.jobId, FOLD_PENDING_JOB_ID);
  });

  /** A queue that refuses the hand-off leaves the sitting pending, not lost: the next ask still counts it. */
  it('folds the sitting once a later ask succeeds, after the first was refused', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, RIGHT, null, null]);
    built.queue.failNext = true;

    await built.scoring.score(attemptId);
    assert.equal(built.queue.jobs.length, 0);

    await built.outbox.relay();
    await drain(built);

    assert.equal((await testStat(paper.testId))?.evaluatedCount, 1);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
  });

  /** The scorer's hand-off and a sweep's re-ask share the pass's id, so they collapse onto one job. */
  it('folds a sitting once, whether the scorer or a sweep asked for the pass', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, RIGHT, null, null]);

    await built.scoring.score(attemptId);
    await built.outbox.relay();
    const delivered = await drain(built);

    assert.equal(delivered, 1);
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 1);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
  });
});

describe('RollupService — rebuilding a student who sits more than one kind of paper', () => {
  /** A full-length paper and a sectional one, sat by one student with opposite results. */
  async function twoKinds(fullChoices: (string | null)[], sectionalChoices: (string | null)[]) {
    const built = build();
    const full = await paperOf(TEST_SCOPE.FULL);
    const sectional = await paperOf(TEST_SCOPE.SECTIONAL);
    const onFull = await sat(full, fullChoices);
    const onSectional = await sat(sectional, sectionalChoices, { studentId: onFull.studentId });
    await counted(built, onFull.attemptId);
    await counted(built, onSectional.attemptId);
    return { built, full, studentId: onFull.studentId };
  }

  /** One totals map replays every sitting, so a subject-only key merges the kinds of paper. */
  it('keeps one row per scope rather than merging them into whichever came first', async () => {
    const { built, full, studentId } = await twoKinds(
      [RIGHT, RIGHT, RIGHT, RIGHT],
      [WRONG, WRONG, null, null],
    );

    await built.rollup.rebuildStudent(studentId);

    const reasoning = await prisma.studentSubjectStat.findMany({
      where: { studentId, subjectId: full.items[0]?.subjectId ?? '' },
    });
    assert.equal(reasoning.length, 2, 'one row for each kind of paper the subject was sat on');
    const tally = (scope: TestScope) => {
      const row = reasoning.find((held) => held.scope === scope);
      return { attempted: row?.attempted, correct: row?.correct, wrong: row?.wrong };
    };
    assert.deepEqual(tally(TEST_SCOPE.FULL), { attempted: 2, correct: 2, wrong: 0 });
    assert.deepEqual(tally(TEST_SCOPE.SECTIONAL), { attempted: 2, correct: 0, wrong: 2 });
  });

  /** A rebuild writes outright, so it must land on exactly what the incremental fold had built. */
  it('lands a rebuild on the same rows the fold left behind', async () => {
    const { built, studentId } = await twoKinds(
      [RIGHT, WRONG, RIGHT, null],
      [WRONG, RIGHT, null, RIGHT],
    );
    const rows = async () =>
      withoutStamps(
        await prisma.studentSubjectStat.findMany({
          where: { studentId },
          orderBy: [{ subjectId: 'asc' }, { scope: 'asc' }],
        }),
      );
    const folded = await rows();

    await built.rollup.rebuildStudent(studentId);

    assert.deepEqual(await rows(), folded);
  });
});

/** The real client, with the first `testStat.upsert` inside any transaction refused. */
function failingOnceOnTestStatUpsert(client: PrismaService): PrismaService {
  let armed = true;
  const refuseUpsert = (tx: object) =>
    new Proxy(tx, {
      get(target, key) {
        const held = Reflect.get(target, key) as unknown;
        if (key !== 'testStat' || !armed) return held;
        return new Proxy(held as object, {
          get(delegate, method) {
            if (method !== 'upsert' || !armed) return Reflect.get(delegate, method) as unknown;
            return () => {
              armed = false;
              return Promise.reject(new Error('testStat is unavailable'));
            };
          },
        });
      },
    });
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: object) => Promise<unknown>, options?: object) =>
        target.$transaction((tx) => work(refuseUpsert(tx)), options);
    },
  });
}
