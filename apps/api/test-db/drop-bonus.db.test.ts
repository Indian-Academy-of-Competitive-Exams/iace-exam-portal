import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type AppException,
  type PaperQuestionStatus,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptSweeperProcessor } from '../src/attempts/attempt-sweeper.processor';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { RollupService } from '../src/attempts/rollup.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { ScoringQueue } from '../src/attempts/scoring-queue';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { QuestionsService } from '../src/questions/questions.service';
import { ROLLUP_JOBS, rescoreJobId, scoringJobId } from '../src/queue/queues';
import { PaperService } from '../src/tests/paper.service';
import {
  FakeEventBus,
  FakeMetrics,
  FakeQueue,
  FakeRedis,
  FakeStorage,
  fakeQueueFailures,
} from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const A_REASON = 'Answer key was wrong';
const WRONG = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function paperService(audit = new AuditContext()): PaperService {
  const stages = new ExamStagesService(prisma, audit, new FakeEventBus().asService());
  return new PaperService(
    prisma,
    new BaseConfigsService(
      prisma,
      stages,
      audit,
      new FakeRedis().asService(),
      new FakeEventBus().asService(),
    ),
    audit,
    new FakeRedis().asService(),
    new QuestionsService(prisma, audit, new FakeStorage() as never),
  );
}

/** A frozen two-question paper; two sittings ended and one still running, all served the first row. */
async function bench({ offered = true, sat = true } = {}) {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  await prisma.test.update({
    where: { id: paper.testId },
    data: { finalizedAt: offered ? new Date() : null },
  });
  if (sat) {
    for (const status of [
      ATTEMPT_STATUS.EVALUATED,
      ATTEMPT_STATUS.SUBMITTED,
      ATTEMPT_STATUS.IN_PROGRESS,
    ]) {
      await sitPaper(prisma, {
        paper,
        studentId: (await makeStudent(prisma)).id,
        chosen: [null, null],
        status,
        ...(status === ATTEMPT_STATUS.IN_PROGRESS ? { submittedAt: null } : {}),
      });
    }
  }
  const audit = new AuditContext();
  const service = paperService(audit);
  const [dropped, kept] = paper.items.map((item) => item.paperQuestionId);
  const set = (status: PaperQuestionStatus, row = dropped ?? '') =>
    service.setQuestionStatus(paper.testId, row, { status, reason: A_REASON });
  return { paper, audit, set, dropped: dropped ?? '', kept: kept ?? '' };
}

const statusOf = async (id: string) =>
  (await prisma.paperQuestion.findUniqueOrThrow({ where: { id } })).status;

const revisionOf = async (testId: string) =>
  (await prisma.test.findUniqueOrThrow({ where: { id: testId } })).paperRevision;

describe('dropping a question on a paper somebody has already sat', () => {
  /** The whole of the re-score a drop asks for: the sweep finds every sitting marked before it. */
  it('marks the row and moves the paper past every mark already given', async () => {
    const { set, dropped, paper } = await bench();
    const before = await revisionOf(paper.testId);

    await set(PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(await statusOf(dropped), PAPER_QUESTION_STATUS.DROPPED);
    assert.equal(await revisionOf(paper.testId), before + 1);
  });

  /** The failure this prevents: a worker's warm scoring terms marking the drop as though it never happened. */
  it('counts every change on the test, so a cached copy of the paper is unreachable', async () => {
    const { set, paper } = await bench();
    const before = await revisionOf(paper.testId);

    await set(PAPER_QUESTION_STATUS.DROPPED);
    await set(PAPER_QUESTION_STATUS.BONUS);

    assert.equal(await revisionOf(paper.testId), before + 2);
  });

  /** The failure this prevents: a second click re-scoring a whole cohort for no change at all. */
  it('leaves the count alone where nothing moved', async () => {
    const { set, paper } = await bench();
    await set(PAPER_QUESTION_STATUS.DROPPED);
    const counted = await revisionOf(paper.testId);

    await set(PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(await revisionOf(paper.testId), counted);
  });

  it('leaves every other question on the paper where it was', async () => {
    const { set, kept } = await bench();

    await set(PAPER_QUESTION_STATUS.BONUS);

    assert.equal(await statusOf(kept), PAPER_QUESTION_STATUS.ACTIVE);
  });

  it('takes a dropped question back, which is another change and another re-score', async () => {
    const { set, dropped, paper } = await bench();
    const before = await revisionOf(paper.testId);
    await set(PAPER_QUESTION_STATUS.DROPPED);

    await set(PAPER_QUESTION_STATUS.ACTIVE);

    assert.equal(await statusOf(dropped), PAPER_QUESTION_STATUS.ACTIVE);
    assert.equal(await revisionOf(paper.testId), before + 2);
  });

  it('refuses on a test nobody has offered, where the paper itself is still the thing to edit', async () => {
    const { set, paper } = await bench({ offered: false });
    const before = await revisionOf(paper.testId);

    await assert.rejects(
      () => set(PAPER_QUESTION_STATUS.DROPPED),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
    assert.equal(await revisionOf(paper.testId), before);
  });

  it('refuses a row that belongs to another paper', async () => {
    const { set } = await bench();

    await assert.rejects(
      () => set(PAPER_QUESTION_STATUS.DROPPED, uid()),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

/** A frozen three-question paper, four students' scored sittings, and what a drop runs through. */
async function scoredHall() {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning', 'Maths'] });
  await prisma.test.update({ where: { id: paper.testId }, data: { finalizedAt: new Date() } });
  const scoringJobs = new FakeQueue();
  const rollupJobs = new FakeQueue();
  const rollupQueue = new RollupQueue(rollupJobs.asQueue());
  const rollup = new RollupService(prisma);
  const scorer = new ScoringProcessor(
    prisma,
    rollupQueue,
    new NotificationsService(prisma),
    fakeQueueFailures(),
    new PaperSheetService(prisma),
    rollup,
  );
  const sweeper = new AttemptSweeperProcessor(
    prisma,
    new AttemptStateService(prisma, new FakeRedis().asService(), new PaperSheetService(prisma)),
    { expire: async () => {} } as never,
    new ScoringQueue(scoringJobs.asQueue()),
    rollupQueue,
    fakeQueueFailures(),
    new FakeMetrics().asService(),
  );
  const sit = async (chosen: readonly (string | null)[]) =>
    (
      await sitPaper(prisma, {
        paper,
        studentId: (await makeStudent(prisma)).id,
        chosen,
        status: ATTEMPT_STATUS.SUBMITTED,
      })
    ).id;
  const scored: string[] = [];
  for (const chosen of [
    [WRONG, RIGHT_OPTION, RIGHT_OPTION],
    [RIGHT_OPTION, WRONG, null],
    [WRONG, WRONG, WRONG],
    [null, RIGHT_OPTION, null],
  ]) {
    const id = await sit(chosen);
    await scorer.score(id);
    scored.push(id);
  }
  await rollup.rebuildTest(paper.testId);
  rollupJobs.jobs.splice(0);

  const ran: string[] = [];
  /** Every scoring job the sweep queued, run the way the worker would run it. */
  const drainScoring = async () => {
    for (const job of scoringJobs.jobs.splice(0)) {
      ran.push(job.jobId ?? '');
      await scorer.score((job.data as { attemptId: string }).attemptId);
    }
  };
  /** Every rebuild a re-score asked for, and the cohort pass the sweep asks for. */
  const drainRollups = async () => {
    for (const job of rollupJobs.jobs.splice(0)) {
      const data = job.data as { testId?: string; studentId?: string };
      if (job.name === ROLLUP_JOBS.SWEEP_COHORTS) await rollup.sweepCohorts();
      if (job.name === ROLLUP_JOBS.REBUILD_TEST && data.testId) {
        await rollup.rebuildTest(data.testId);
      }
      if (job.name === ROLLUP_JOBS.REBUILD_STUDENT && data.studentId) {
        await rollup.rebuildStudent(data.studentId);
      }
    }
  };
  const drop = () =>
    paperService().setQuestionStatus(paper.testId, paper.items[0]?.paperQuestionId ?? '', {
      status: PAPER_QUESTION_STATUS.DROPPED,
      reason: A_REASON,
    });
  return {
    testId: paper.testId,
    scored,
    sit,
    scorer,
    sweeper,
    scoringJobs,
    rollup,
    ran,
    drop,
    drainScoring,
    drainRollups,
  };
}

const sittingsOf = (ids: readonly string[]) =>
  prisma.attempt.findMany({ where: { id: { in: [...ids] } } });

describe('a drop, re-scored by the sweep', () => {
  /** The guarantee: every sitting marked before the drop is marked again, and none of them twice. */
  it('re-scores every ended sitting of the test exactly once', async () => {
    const hall = await scoredHall();
    const [first = ''] = hall.scored;
    const before = await sittingsOf([first]);

    await hall.drop();
    await hall.sweeper.process();
    await hall.drainScoring();
    // A finished job no longer holds its id, so a sitting still behind would be asked for again here.
    await hall.sweeper.process();

    assert.deepEqual(hall.scoringJobs.jobs, [], 'nothing is behind the paper once the sweep ran');
    assert.deepEqual([...hall.ran].sort(), hall.scored.map((id) => rescoreJobId(id, 1)).sort());
    const after = await sittingsOf(hall.scored);
    assert.ok(after.every((row) => row.scoredRevision === 1));
    // The first sat Q1 wrong: the drop pays its 2 and takes back the 0.5.
    const rescored = after.find((row) => row.id === first);
    assert.equal(Number(rescored?.score), Number(before[0]?.score) + 2.5);
  });

  /** Nothing is handed to a queue at the drop, so a dead queue can only cost the sweep a pass. */
  it('re-scores every sitting on the pass after one that found the queue down', async () => {
    const hall = await scoredHall();

    await hall.drop();
    hall.scoringJobs.failNext = true;
    await hall.sweeper.process();
    assert.deepEqual(hall.scoringJobs.jobs, []);

    await hall.sweeper.process();
    await hall.drainScoring();

    assert.ok((await sittingsOf(hall.scored)).every((row) => row.scoredRevision === 1));
  });

  /** The failure this prevents: a sitting first marked after the drop marked a second time for it. */
  it('leaves a sitting first scored after the drop alone', async () => {
    const hall = await scoredHall();
    await hall.drop();
    const late = await hall.sit([WRONG, RIGHT_OPTION, null]);
    await hall.scorer.score(late);

    await hall.sweeper.process();

    const asked = hall.scoringJobs.jobs.map((job) => job.jobId);
    assert.equal(asked.length, hall.scored.length);
    assert.ok(!asked.includes(rescoreJobId(late, 1)));
    assert.ok(!asked.includes(scoringJobId(late)));
  });

  /** A re-score is a correction, so it must leave the hall where a first score would have. */
  it('leaves every mark, standing and rollup where scoring the dropped paper afresh puts them', async () => {
    const hall = await scoredHall();
    await hall.drop();
    await hall.sweeper.process();
    await hall.drainScoring();
    await hall.drainRollups();
    await hall.rollup.rebuildTest(hall.testId);
    const rescored = await snapshotOf(hall.testId, hall.scored);

    await unscore(hall.testId);
    for (const id of hall.scored) await hall.scorer.score(id);
    await hall.rollup.rebuildTest(hall.testId);

    assert.deepEqual(rescored, await snapshotOf(hall.testId, hall.scored));
  });
});

/** Everything a re-score moves, less the instants that only say when it moved. */
async function snapshotOf(testId: string, attemptIds: readonly string[]) {
  const standings = await new LeaderboardService(prisma).standingsOf(attemptIds);
  const sittings = await prisma.attempt.findMany({
    where: { testId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      studentId: true,
      score: true,
      correctCount: true,
      wrongCount: true,
      unattemptedCount: true,
      sectionScores: true,
      scoredRevision: true,
    },
  });
  const students = { studentId: { in: sittings.map((row) => row.studentId) } };
  return plain({
    sittings: sittings.map((row) => ({ ...row, standing: standings.get(row.id) ?? null })),
    test: await prisma.testStat.findMany({ where: { testId }, omit: { computedAt: true } }),
    sections: await prisma.testSectionStat.findMany({
      where: { testId },
      orderBy: { baseConfigSectionId: 'asc' },
      omit: { computedAt: true },
    }),
    items: await prisma.testQuestionStat.findMany({
      where: { testId },
      orderBy: { paperQuestionId: 'asc' },
      omit: { computedAt: true },
    }),
    students: await prisma.studentStat.findMany({
      where: students,
      orderBy: { studentId: 'asc' },
      omit: { computedAt: true, computedThrough: true },
    }),
    subjects: await prisma.studentSubjectStat.findMany({
      where: students,
      orderBy: [{ studentId: 'asc' }, { subjectId: 'asc' }],
      omit: { computedAt: true },
    }),
  });
}

/** Back to handed in and never marked, with no rollup left, so the next score is a first one. */
async function unscore(testId: string): Promise<void> {
  await prisma.attempt.updateMany({
    where: { testId },
    data: {
      status: ATTEMPT_STATUS.SUBMITTED,
      evaluatedAt: null,
      score: null,
      correctCount: null,
      wrongCount: null,
      unattemptedCount: null,
      sectionScores: Prisma.DbNull,
      timeTakenSec: null,
      scoredRevision: 0,
    },
  });
  await prisma.attemptSheet.updateMany({
    where: { attempt: { testId } },
    data: { verdicts: Prisma.DbNull },
  });
  await prisma.$transaction([
    prisma.testQuestionStat.deleteMany(),
    prisma.testSectionStat.deleteMany(),
    prisma.testStat.deleteMany(),
    prisma.studentSubjectStat.deleteMany(),
    prisma.studentStat.deleteMany(),
  ]);
}

/** Decimals and BigInts as JSON reads them, so two snapshots compare by value. */
const plain = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_key, held: unknown) =>
      typeof held === 'bigint' ? Number(held) : held,
    ),
  ) as T;

describe('the audit row a disposition change leaves behind', () => {
  it('carries the row, the move it made, and the reason the admin gave for it', async () => {
    const { audit, set, dropped } = await bench();

    const store = await audit.run(async () => {
      await set(PAPER_QUESTION_STATUS.DROPPED);
      return audit.current();
    });

    // Against the ROW, not the test: "test updated" cannot settle a dispute about one question.
    assert.equal(store?.entityId, dropped);
    assert.deepEqual(store?.changed, {
      status: { from: PAPER_QUESTION_STATUS.ACTIVE, to: PAPER_QUESTION_STATUS.DROPPED },
      reason: { from: null, to: A_REASON },
    });
  });

  /** The failure this prevents: a re-click logging a change that moved nothing and re-scored nothing. */
  it('is not written when the status asked for is the one the row already has', async () => {
    const { audit, set } = await bench();
    await set(PAPER_QUESTION_STATUS.DROPPED);

    const store = await audit.run(async () => {
      await set(PAPER_QUESTION_STATUS.DROPPED);
      return audit.current();
    });

    assert.equal(store?.entityId, null);
    assert.equal(store?.changed, null);
  });
});
