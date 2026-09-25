import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, PAPER_QUESTION_STATUS, TEST_SCOPE, type TestScope } from '@iace/contracts';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { cohortShapeOf, flagYours } from '../src/attempts/performance-analytics';
import { cohortCurveOf } from '../src/attempts/cohort-curve';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { type PrismaService } from '../src/prisma/prisma.service';
import { COHORT_SWEEP_JOB_ID, ROLLUP_JOBS } from '../src/queue/queues';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
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
  const outbox = new RollupQueue(queue.asQueue());
  return {
    queue,
    outbox,
    scoring: new ScoringProcessor(
      prisma,
      outbox,
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
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
    const data = job.data as { testId?: string; studentId?: string };
    if (job.name === ROLLUP_JOBS.SWEEP_COHORTS) await built.rollup.sweepCohorts();
    if (job.name === ROLLUP_JOBS.REBUILD_TEST && data.testId !== undefined) {
      await built.rollup.rebuildTest(data.testId);
    }
    if (job.name === ROLLUP_JOBS.REBUILD_STUDENT && data.studentId !== undefined) {
      await built.rollup.rebuildStudent(data.studentId);
    }
  }
  return jobs.length;
}

/** Everything one submitted sitting goes through: scored, then counted by the periodic sweep. */
async function counted(built: World, attemptId: string): Promise<void> {
  await built.scoring.score(attemptId);
  await drain(built);
  await built.rollup.sweepCohorts();
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

/** How many answers the item rows have counted, which is what a pass they skipped leaves behind. */
async function attemptedOn(testId: string): Promise<number> {
  const rows = await prisma.testQuestionStat.findMany({
    where: { testId },
    select: { attemptedCount: true },
  });
  return rows.reduce((total, row) => total + row.attemptedCount, 0);
}

/** The 15 minutes, without waiting them out: the pass reads the stamp and nothing else. */
const ageTheItems = (testId: string) =>
  prisma.testQuestionStat.updateMany({ where: { testId }, data: { computedAt: new Date(0) } });
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

describe('RollupService — counting one sitting in', () => {
  it('counts one sitting into every aggregate it belongs to', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await counted(built, attemptId);

    const rolled = await testStat(paper.testId);
    assert.equal(rolled?.evaluatedCount, 1);
    assert.equal(num(rolled?.sumScore), 3.5);
    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
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

describe('RollupService — sweeping the cohorts that changed', () => {
  /** The failure this prevents: a hall's recount reading the paper, or a sheet, once per sitting. */
  it('counts a test’s totals without reading a sitting or a paper', async () => {
    const scorer = build();
    const paper = await paperOf();
    for (const chosen of [
      [RIGHT, RIGHT, WRONG, null],
      [RIGHT, WRONG, WRONG, null],
      [WRONG, WRONG, null, null],
    ]) {
      await scorer.scoring.score((await sat(paper, chosen)).attemptId);
    }
    const reads: Record<string, number> = {};

    await new RollupService(countingFindMany(prisma, reads)).recountTest(paper.testId);

    assert.deepEqual(reads, {});
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 3);
  });

  /** The failure this prevents: a student's totals moved, and the marks behind them rolled back. */
  it('writes none of a sitting when its own tables fail partway', async () => {
    const scoring = new ScoringProcessor(
      failingOnceOnStatWrite(prisma),
      new RollupQueue(new FakeQueue().asQueue()),
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
    );
    const paper = await paperOf();
    const { attemptId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);

    await assert.rejects(() => scoring.score(attemptId));

    assert.equal(await prisma.studentStat.count(), 0);
    const held = await prisma.attempt.findUnique({ where: { id: attemptId } });
    assert.equal(held?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(held?.evaluatedAt, null);
  });

  /** What replaces the guard ledger: the pass writes an answer, so running it twice writes the same one. */
  it('lands on the same numbers however many times the sweep runs', async () => {
    const built = build();
    const paper = await paperOf();
    for (const chosen of [
      [RIGHT, RIGHT, WRONG, null],
      [RIGHT, WRONG, WRONG, null],
    ]) {
      await built.scoring.score((await sat(paper, chosen)).attemptId);
    }

    await built.rollup.sweepCohorts();
    const once = await cohortRows(paper.testId);

    await built.rollup.sweepCohorts();
    await built.rollup.sweepCohorts();

    assert.deepEqual(await cohortRows(paper.testId), once);
  });

  it('counts a test the sweep could not write on the pass after it', async () => {
    const paper = await paperOf();
    const { attemptId } = await sat(paper, [RIGHT, null, null, null]);
    await build().scoring.score(attemptId);
    const rollup = new RollupService(failingOnceOnStatWrite(prisma));

    assert.equal(await rollup.sweepCohorts(), 0);
    assert.equal(await prisma.testStat.count(), 0);

    assert.equal(await rollup.sweepCohorts(), 1);
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 1);
  });
});

describe('RollupService — who the cohort is', () => {
  it('keeps a retake out of the cohort and inside the student it belongs to', async () => {
    const built = build();
    const paper = await paperOf(TEST_SCOPE.SECTIONAL);
    const retake = await sat(paper, [RIGHT, WRONG, null, RIGHT], { attemptNo: 2, isGraded: false });

    await counted(built, retake.attemptId);

    // A pass counts every test something landed on, so the row exists and says nobody is in it.
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 0);
    assert.equal(await prisma.testSectionStat.count(), 0);
    assert.equal(await prisma.testQuestionStat.count(), 0);
    const student = await studentStat(retake.studentId);
    assert.equal(student?.retakeCount, 1);
    assert.equal(student?.testsEvaluated, 0);
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

  it('counts the bands the report reads off the same sittings the fold counted', async () => {
    const { paper } = await cohort();
    const sittings = await prisma.attempt.findMany({ where: { testId: paper.testId } });
    const scores = sittings.map((row) => ({ score: Number(row.score ?? 0), count: 1 }));

    const bands = flagYours((await cohortCurveOf(prisma, paper.testId)).bands, 8);

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
    const scored = new Map(sittings.map((row) => [row.studentId, Number(row.score ?? 0)]));
    const students = await prisma.studentStat.findMany();
    assert.equal(
      students.every((row) => row.testsAttempted === 1),
      true,
    );
    // The drop moved every student's marks too, so their own totals must have followed.
    assert.deepEqual(
      students.map((row) => Number(row.sumScore)).sort(),
      [...scored.values()].sort(),
    );
    assert.equal(await prisma.testQuestionStat.count(), 4);
  });

  it('asks for one rebuild of the test, and one of each student whose marks moved', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, null, null]);
    const second = await sat(paper, [WRONG, WRONG, null, null]);
    for (const { attemptId } of [first, second]) await counted(built, attemptId);

    for (const { attemptId } of [first, second]) await built.scoring.score(attemptId);

    assert.deepEqual(
      built.queue.jobs.map((job) => [job.name, job.jobId]),
      [
        [ROLLUP_JOBS.REBUILD_TEST, `rollup-rebuild-${paper.testId}`],
        [ROLLUP_JOBS.REBUILD_STUDENT, `rollup-rebuild-student-${first.studentId}`],
        [ROLLUP_JOBS.REBUILD_STUDENT, `rollup-rebuild-student-${second.studentId}`],
      ],
    );
  });

  /** Sittings scored before the worker existed are evaluated and never counted, which rebuildAll owns. */
  it('backfills a cohort nothing counted, and a student the deltas never reached', async () => {
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
    const counting = await studentRows();

    await prisma.$transaction([
      prisma.testQuestionStat.deleteMany(),
      prisma.testSectionStat.deleteMany(),
      prisma.testStat.deleteMany(),
      prisma.studentSubjectStat.deleteMany(),
      prisma.studentStat.deleteMany(),
    ]);
    await built.rollup.rebuildAll();

    // The student side is the one still counted as a delta, so a replay of it has to agree.
    assert.deepEqual(await studentRows(), counting);
    const rolled = await testStat(paper.testId);
    const scored = await prisma.attempt.findMany({ where: { testId: paper.testId } });
    assert.equal(rolled?.evaluatedCount, 3);
    assert.equal(
      num(rolled?.sumScore),
      scored.reduce((total, row) => total + Number(row.score ?? 0), 0),
    );
    assert.equal(await prisma.testQuestionStat.count(), 4);
  });
});

describe('RollupService — the slower clock the item analysis runs on', () => {
  /** The hole this closes: a test goes quiet two minutes in, and its items stay at the first pass. */
  it('counts the items of a test that stopped changing before they were due', async () => {
    const built = build();
    const paper = await paperOf();
    const first = await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT]);
    const second = await sat(paper, [WRONG, null, null, null]);
    await counted(built, first.attemptId);
    await counted(built, second.attemptId);
    // Counted on the first pass and not since: the second sitting is in the totals, not the items.
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 2);
    assert.equal(await attemptedOn(paper.testId), 4);

    await ageTheItems(paper.testId);
    await built.rollup.sweepCohorts();

    assert.equal(await attemptedOn(paper.testId), 5);
  });

  it('leaves the items alone on a pass that is not yet due', async () => {
    const built = build();
    const paper = await paperOf();
    await counted(built, (await sat(paper, [RIGHT, RIGHT, RIGHT, RIGHT])).attemptId);
    await counted(built, (await sat(paper, [WRONG, null, null, null])).attemptId);

    await built.rollup.sweepCohorts();

    assert.equal(await attemptedOn(paper.testId), 4);
  });
});

describe('RollupService — the student watermark a re-score can leave behind', () => {
  /** The failure this prevents: a lost `REBUILD_STUDENT` job leaving StudentStat wrong for ever. */
  it('recounts a student whose watermark fell behind a re-score nobody drained', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [WRONG, RIGHT, RIGHT, RIGHT]);
    await counted(built, attemptId);
    const before = await studentStat(studentId);

    // The drop moves the marks; the rebuild it asks for is left queued, never drained.
    await disposeQuestion(prisma, paper, 0, PAPER_QUESTION_STATUS.DROPPED);
    await built.scoring.score(attemptId);

    await built.rollup.sweepCohorts();

    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    const after = await studentStat(studentId);
    assert.notEqual(num(after?.sumScore), num(before?.sumScore));
    assert.equal(num(after?.sumScore), Number(attempt.score));
  });

  /** Bounded like the cohort arm: a student who is not behind must not be replayed every pass. */
  it('leaves a student whose watermark already covers their last mark alone', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, WRONG, null, RIGHT]);
    await counted(built, attemptId);
    const before = await studentStat(studentId);

    // Backdated so the sweep reads it as long settled, not freshly landed.
    await prisma.attempt.update({ where: { id: attemptId }, data: { updatedAt: new Date(0) } });

    await built.rollup.sweepCohorts();

    const after = await studentStat(studentId);
    assert.equal(after?.computedAt.getTime(), before?.computedAt.getTime());
  });
});

describe('RollupQueue — asking for the counting nobody else will', () => {
  it('collapses every ask for a pass onto the one job the sweep runs as', async () => {
    const built = build();

    await built.outbox.sweep();
    await built.outbox.sweep();

    assert.deepEqual(
      built.queue.jobs.map((job) => [job.name, job.jobId]),
      [[ROLLUP_JOBS.SWEEP_COHORTS, COHORT_SWEEP_JOB_ID]],
    );
  });

  /** A queue that refuses must not fail a score that committed: the sweep counts it either way. */
  it('leaves a re-scored sitting counted when the queue refuses the rebuild', async () => {
    const built = build();
    const paper = await paperOf();
    const { attemptId, studentId } = await sat(paper, [RIGHT, RIGHT, null, null]);
    await counted(built, attemptId);
    built.queue.failNext = true;

    await built.scoring.score(attemptId);

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

/** The real client, counting the top-level `findMany` calls a fold page makes on each table. */
function countingFindMany(client: PrismaService, counts: Record<string, number>): PrismaService {
  const COUNTED = ['attempt', 'paperQuestion'];
  return new Proxy(client, {
    get(target, key) {
      const held = Reflect.get(target, key) as unknown;
      if (typeof key !== 'string' || !COUNTED.includes(key)) return held;
      return new Proxy(held as object, {
        get(delegate, method) {
          const call = Reflect.get(delegate, method) as unknown;
          if (method !== 'findMany') return call;
          return (...args: unknown[]) => {
            counts[key] = (counts[key] ?? 0) + 1;
            return (call as (...a: unknown[]) => unknown)(...args);
          };
        },
      });
    },
  });
}

/** The real client, with the first stat write inside any transaction refused. */
function failingOnceOnStatWrite(client: PrismaService): PrismaService {
  let armed = true;
  const refuseWrite = (tx: object) =>
    new Proxy(tx, {
      get(target, key) {
        if (key !== '$executeRaw' || !armed) return Reflect.get(target, key) as unknown;
        return () => {
          armed = false;
          return Promise.reject(new Error('the stat tables are unavailable'));
        };
      },
    });
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: object) => Promise<unknown>, options?: object) =>
        target.$transaction((tx) => work(refuseWrite(tx)), options);
    },
  });
}
