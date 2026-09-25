import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { type PrismaService } from '../src/prisma/prisma.service';
import { ROLLUP_JOBS } from '../src/queue/queues';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const RIGHT = RIGHT_OPTION;
const WRONG = 'o2';
const ADMIN = uid();
const REASON = 'Reconciling a race with the scorer';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const studentStat = (studentId: string) => prisma.studentStat.findUnique({ where: { studentId } });

/** Doubles for everything a void touches besides the row and the rollup: irrelevant to this race. */
function support() {
  const state = { take: () => Promise.resolve(null) } as never;
  const access = { invalidateStudent: () => Promise.resolve() } as never;
  const audit = { setEntityId: () => undefined, setChanged: () => undefined } as never;
  return { state, access, audit };
}

/** The real client, held open right after the scorer's last write until the test lets it commit. */
function stallingScorer(
  client: PrismaService,
  gate: Promise<void>,
  markReached: () => void,
): PrismaService {
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: object) => Promise<unknown>, options?: object) =>
        target.$transaction(
          (tx) =>
            work(
              new Proxy(tx as object, {
                get(txTarget, txKey) {
                  if (txKey !== 'outboxEvent') return Reflect.get(txTarget, txKey) as unknown;
                  const delegate = Reflect.get(txTarget, txKey) as object;
                  return new Proxy(delegate, {
                    get(delTarget, method) {
                      const call = Reflect.get(delTarget, method) as unknown;
                      if (method !== 'create') return call;
                      return async (...args: unknown[]) => {
                        const result = await (call as (...a: unknown[]) => Promise<unknown>).apply(
                          delTarget,
                          args,
                        );
                        markReached();
                        await gate;
                        return result;
                      };
                    },
                  });
                },
              }),
            ),
          options,
        );
    },
  });
}

describe('AttemptResolutionService — voiding a sitting the scorer is mid-flight on', () => {
  /** The failure this prevents: a fold that committed after void's read judged safe to skip forever. */
  it('reverses the student rollup even off a snapshot read before the fold committed', async () => {
    const paper = await makePaper(prisma, {
      questions: ['Reasoning', 'Reasoning', 'Maths', 'Maths'],
    });
    const { id: studentId } = await makeStudent(prisma);
    const attempt = await sitPaper(prisma, {
      paper,
      studentId,
      chosen: [RIGHT, WRONG, null, RIGHT],
    });

    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markReached = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });

    const scoring = new ScoringProcessor(
      stallingScorer(prisma, gate, markReached),
      new RollupQueue(new FakeQueue().asQueue()),
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
    );
    const rollupQueue = new FakeQueue();
    const { state, access, audit } = support();
    const resolution = new AttemptResolutionService(
      prisma,
      state,
      {} as never,
      new RollupQueue(rollupQueue.asQueue()),
      access,
      audit,
    );

    const scored = scoring.score(attempt.id);
    await reached;
    // The scorer's fold is written but not committed: nothing outside its transaction can see it yet.
    assert.equal((await studentStat(studentId))?.testsAttempted ?? 0, 0);

    const voided = resolution.void(attempt.id, { reason: REASON, regrantRanked: false }, ADMIN);
    const raced = await Promise.race([
      voided.then(() => 'voided'),
      delay(200).then(() => 'blocked'),
    ]);
    assert.equal(raced, 'blocked', "the void must block on the scorer's row lock, not run past it");

    release();
    await scored;
    await voided;

    assert.equal((await studentStat(studentId))?.testsAttempted, 1, "the scorer's fold committed");
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(row.status, ATTEMPT_STATUS.VOIDED);

    const rebuildJob = rollupQueue.jobs.find((job) => job.name === ROLLUP_JOBS.REBUILD_STUDENT);
    assert.ok(rebuildJob, 'the void asked for the student to be recounted off its stale snapshot');

    await new RollupService(prisma).rebuildStudent(studentId);
    const reversed = await studentStat(studentId);
    assert.equal(
      reversed?.testsAttempted,
      0,
      'the voided sitting no longer counts toward the student',
    );
  });
});
