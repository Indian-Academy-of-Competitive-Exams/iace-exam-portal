import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, AppException, ErrorCodes } from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { RollupService } from '../src/attempts/rollup.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { TestAnalyticsService } from '../src/attempts/test-analytics.service';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { ROLLUP_JOBS } from '../src/queue/queues';
import { FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const queue = new FakeQueue();
  const outbox = new RollupQueue(queue.asQueue());
  const rollup = new RollupService(prisma);
  return {
    queue,
    rollup,
    analytics: new TestAnalyticsService(
      prisma,
      outbox,
      new AccessResolverService(prisma, new FakeRedis().asService()),
    ),
    scoring: new ScoringProcessor(
      prisma,
      outbox,
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
    ),
  };
}

type World = ReturnType<typeof build>;

/** A sitting of the paper, by a new student unless one is named. */
async function sat(
  paper: Paper,
  over: { studentId?: string; attemptNo?: number; isGraded?: boolean } = {},
) {
  const studentId = over.studentId ?? (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [RIGHT_OPTION, RIGHT_OPTION],
    ...over,
  });
  return { attemptId: attempt.id, studentId };
}

/** Scored, then counted by the periodic sweep — the whole road a submitted sitting takes. */
async function counted(world: World, attemptId: string): Promise<void> {
  await world.scoring.score(attemptId);
  world.queue.jobs.splice(0);
  await world.rollup.sweepCohorts();
}

describe('TestAnalyticsService — how fresh the counted figures are', () => {
  /** A retake, a voided sitting and an unscored one are left out of the count, so the live read leaves them out too. */
  it('counts only the sittings the cohort holds, and settles once a rebuild catches up', async () => {
    const world = build();
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Maths'] });

    const first = await sat(paper);
    await counted(world, first.attemptId);
    await counted(world, (await sat(paper)).attemptId);
    const retake = await sat(paper, { studentId: first.studentId, attemptNo: 2, isGraded: false });
    await counted(world, retake.attemptId);
    const voided = await sat(paper);
    await counted(world, voided.attemptId);
    await sat(paper);

    await prisma.attempt.update({
      where: { id: voided.attemptId },
      data: { status: ATTEMPT_STATUS.VOIDED, voidedAt: new Date() },
    });

    const behind = (await world.analytics.forTest(paper.testId)).summary;
    assert.equal(behind.evaluatedCount, 3);
    assert.equal(behind.liveEvaluatedCount, 2);
    assert.equal(behind.isSettling, true);

    await world.rollup.rebuildTest(paper.testId);

    const caughtUp = (await world.analytics.forTest(paper.testId)).summary;
    assert.equal(caughtUp.evaluatedCount, 2);
    assert.equal(caughtUp.liveEvaluatedCount, 2);
    assert.equal(caughtUp.isSettling, false);
  });

  it('queues an immediate rebuild for a test that exists, and refuses one that does not', async () => {
    const world = build();
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });

    await world.analytics.resync(paper.testId);
    const missing = await world.analytics.resync(randomUUID()).catch((error: unknown) => error);

    assert.deepEqual(
      world.queue.jobs.map((job) => [job.name, job.data, job.delay]),
      [[ROLLUP_JOBS.REBUILD_TEST, { testId: paper.testId }, 0]],
    );
    assert.ok(AppException.is(missing));
    assert.equal(missing.code, ErrorCodes.NOT_FOUND);
  });
});
