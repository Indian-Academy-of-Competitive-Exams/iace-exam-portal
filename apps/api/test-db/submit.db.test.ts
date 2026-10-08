import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type AnswerChange,
  type AttemptStatus,
} from '@iace/contracts';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptSweeperProcessor } from '../src/attempts/attempt-sweeper.processor';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringQueue } from '../src/attempts/scoring-queue';
import { SubmitService } from '../src/attempts/submit.service';
import { AuditContext } from '../src/audit';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_NAMES, scoringJobId } from '../src/queue/queues';
import { FakeMetrics, FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeAdmin,
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const LATE = new Date(Date.now() - HOUR_MS);
/** A deadline still ahead on the real clock, which is what a batch riding a submit is judged by. */
const SOON = new Date(Date.now() + HOUR_MS);
const WRONG_OPTION = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface Hooks {
  /** Runs before the sheet write lands; throwing refuses the write. */
  beforeWrite?: () => Promise<void>;
  /** Runs just before the UPDATE that ends the sitting. */
  beforeClaim?: () => Promise<void>;
}

/** The real client, with submit's sheet write and its claim each open to a hook. */
function hooked(hooks: Hooks): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key === '$executeRaw') {
        return async (...args: unknown[]) => {
          await hooks.beforeWrite?.();
          return (target.$executeRaw as (...values: unknown[]) => Promise<number>)(...args);
        };
      }
      if (key !== 'attempt') return Reflect.get(target, key) as unknown;
      return new Proxy(target.attempt, {
        get(delegate, method: string | symbol) {
          if (method !== 'updateMany') return Reflect.get(delegate, method) as unknown;
          return async (args: Prisma.AttemptUpdateManyArgs) => {
            await hooks.beforeClaim?.();
            return delegate.updateMany(args);
          };
        },
      });
    },
  });
}

async function build(over: { endsAt?: Date; status?: AttemptStatus; submittedAt?: Date } = {}) {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  const student = (await makeStudent(prisma)).id;
  const endsAt = over.endsAt ?? ENDS_AT;
  const startedAt = new Date(endsAt.getTime() - HOUR_MS);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student,
    chosen: [null, null],
    timeSpent: [0, 0],
    status: over.status ?? ATTEMPT_STATUS.IN_PROGRESS,
    startedAt,
    submittedAt: over.submittedAt ?? null,
  });
  const [q1 = '', q2 = ''] = paper.items.map((item) => item.questionId);
  const hooks: Hooks = {};
  const client = hooked(hooks);
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma, redis.asService(), new PaperSheetService(prisma));
  const queue = new FakeQueue();
  const scoring = new ScoringQueue(queue.asQueue());
  const sheets = new AttemptSheetService(client, new PaperSheetService(client));
  const submit = new SubmitService(client, state, scoring, new FakeMetrics().asService(), sheets);
  const change = (questionId = q1): AnswerChange => ({
    questionId,
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: RIGHT_OPTION,
    typedAnswer: null,
    timeSpentSec: 30,
  });
  return {
    attemptId: attempt.id,
    testId: paper.testId,
    student,
    q1,
    q2,
    hooks,
    redis,
    state,
    queue,
    scoring,
    sheets,
    submit,
    change,
    live: { id: attempt.id, studentId: student, testId: paper.testId, startedAt, endsAt },
    sweeper: new AttemptSweeperProcessor(
      prisma,
      state,
      submit,
      scoring,
      new RollupQueue(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new FakeMetrics().asService(),
    ),
  };
}

type Built = Awaited<ReturnType<typeof build>>;

const answered = async ({ state, live, student, attemptId, change }: Built) => {
  await state.open(live);
  await state.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);
};

const attemptRow = (id: string) => prisma.attempt.findUniqueOrThrow({ where: { id } });

const chosenOn = async (attemptId: string, questionId: string) =>
  (await servedAnswers(prisma, attemptId)).find((row) => row.questionId === questionId)
    ?.selectedOptionId ?? null;

describe('SubmitService', () => {
  it('writes what Redis held, ends the sitting, and enqueues one scoring job', async () => {
    const built = await build();
    await answered(built);

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.submittedByThisCall, true);
    assert.equal(result.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    assert.deepEqual(built.queue.jobs, [
      {
        name: QUEUE_NAMES.SCORING,
        data: { attemptId: built.attemptId, testId: built.testId },
        jobId: scoringJobId(built.attemptId),
        // The key only holds while nothing is kept under it: a retained failure swallows the retry.
        removeOnFail: true,
      },
    ]);
  });

  /** One request at the deadline: the last answers the screen had not saved ride the submit itself. */
  it('applies the last answers it carries, and ends the sitting in the one request', async () => {
    const built = await build({ endsAt: SOON });
    await built.state.open(built.live);

    const result = await built.submit.submit(built.student, built.attemptId, {
      last: { revision: 1, answers: [built.change()] },
    });

    assert.equal(result.submittedByThisCall, true);
    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
  });

  /** Late is late at submit too; the sitting still ends rather than waiting for the sweeper. */
  it('drops a batch that comes in past the deadline, and still ends the sitting', async () => {
    const built = await build({ endsAt: LATE });
    await built.state.open(built.live);

    const result = await built.submit.submit(built.student, built.attemptId, {
      last: { revision: 1, answers: [built.change()] },
    });

    assert.equal(result.submittedByThisCall, true);
    assert.equal(await chosenOn(built.attemptId, built.q1), null);
  });

  /** A retry of a submit that did land must not fail on the batch it carries again. */
  it('answers a retried submit with the first outcome, batch and all', async () => {
    const built = await build({ endsAt: SOON });
    await built.state.open(built.live);
    const body = { last: { revision: 1, answers: [built.change()] } };

    const first = await built.submit.submit(built.student, built.attemptId, body);
    const second = await built.submit.submit(built.student, built.attemptId, body);

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
  });

  /** The failure this prevents: a reloaded screen's counter restarting below the server's, so its last batch was dropped as stale. */
  it('applies the last batch even under a revision the server has moved past', async () => {
    const built = await build({ endsAt: SOON });
    await built.state.open(built.live);
    await built.state.save(built.student, built.attemptId, {
      revision: 40,
      answers: [built.change(built.q2)],
    });

    await built.submit.submit(built.student, built.attemptId, {
      last: { revision: 1, answers: [built.change()] },
    });

    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
    assert.equal(await chosenOn(built.attemptId, built.q2), RIGHT_OPTION);
  });

  /** A late sitting whose key is gone is ended with what it holds, not refused with a 409. */
  it('ends a late sitting whose live state is gone, dropping the batch it carries', async () => {
    const built = await build({ endsAt: LATE });

    const result = await built.submit.submit(built.student, built.attemptId, {
      last: { revision: 1, answers: [built.change()] },
    });

    assert.equal(result.submittedByThisCall, true);
    assert.equal(await chosenOn(built.attemptId, built.q1), null);
  });

  /** A retry racing the submit that landed: the batch meets an ended sitting, and the answer is the first outcome. */
  it('answers a submit whose batch met a sitting another call just ended', async () => {
    const built = await build({ endsAt: SOON });
    await built.state.open(built.live);
    const first = await built.submit.submit(built.student, built.attemptId);
    await prisma.attempt.update({
      where: { id: built.attemptId },
      data: { status: ATTEMPT_STATUS.IN_PROGRESS },
    });
    const save = built.state.save.bind(built.state);
    built.state.save = async (...args: Parameters<typeof save>) => {
      await prisma.attempt.update({
        where: { id: built.attemptId },
        data: { status: ATTEMPT_STATUS.SUBMITTED },
      });
      return save(...args);
    };

    const second = await built.submit.submit(built.student, built.attemptId, {
      last: { revision: 1, answers: [built.change()] },
    });

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
  });

  /** The failure this prevents: a double-click scoring one sitting twice. */
  it('reports the first outcome on a second submit, and enqueues nothing more', async () => {
    const built = await build();
    await answered(built);

    const first = await built.submit.submit(built.student, built.attemptId);
    const second = await built.submit.submit(built.student, built.attemptId);

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
    assert.equal(built.queue.jobs.length, 1);
  });

  /** Taking the state shuts the door: nothing can be saved into a sitting that has ended. */
  it('leaves no live state behind, so a later save is refused', async () => {
    const built = await build();
    await answered(built);

    await built.submit.submit(built.student, built.attemptId);

    assert.equal(await built.state.read(built.attemptId), null);
    await assert.rejects(
      () =>
        built.state.save(
          built.student,
          built.attemptId,
          { revision: 9, answers: [built.change()] },
          NOW,
        ),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.SITTING_ENDED,
    );
  });

  it('submits an empty paper for a student who answered nothing', async () => {
    const built = await build();
    await built.state.open(built.live);

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 0);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
  });

  /** The failure this prevents: a database error losing the answers AND ending the sitting. */
  it('keeps the live state and the sitting open when the write fails', async () => {
    const built = await build();
    await answered(built);
    built.hooks.beforeWrite = () => Promise.reject(new Error('write refused'));

    await assert.rejects(() => built.submit.submit(built.student, built.attemptId));

    assert.ok(
      await built.state.read(built.attemptId),
      'the answers must survive to be written again',
    );
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(await chosenOn(built.attemptId, built.q1), null);

    delete built.hooks.beforeWrite;
    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
  });

  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const built = await build();
    await answered(built);

    await assert.rejects(
      () => built.submit.submit(uid(), built.attemptId),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('AttemptSweeperProcessor', () => {
  it('ends a sitting nobody came back to, and has nothing to do twice over', async () => {
    const built = await build({ endsAt: LATE });
    // Last seen past the limit: a paper still within it is put down, not abandoned.
    await built.state.open(built.live, undefined, new Date(Date.now() - 49 * HOUR_MS));

    await built.sweeper.process();
    await built.sweeper.process();

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(built.queue.jobs.length, 1);
  });

  /** The grace a save gets is the grace the sweeper gives: it must not end one still reachable. */
  it('leaves a sitting still inside its clock alone', async () => {
    const built = await build({ endsAt: new Date(Date.now() + HOUR_MS) });

    await built.sweeper.process();

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  /** The failure this prevents: a sweep and a student's own submit both scoring the same sitting. */
  it('produces one submission when it races a manual submit', async () => {
    const built = await build({ endsAt: LATE });
    await built.state.open(built.live);

    await Promise.all([
      built.sweeper.process(),
      built.submit.submit(built.student, built.attemptId),
    ]);

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(built.queue.jobs.length, 1);
  });
});

describe('SubmitService — an end asked for by the deadline', () => {
  /** The failure this prevents: time given after the sweep listed a sitting, swallowed by its end. */
  it('leaves a sitting whose deadline has moved past the one it was listed by', async () => {
    const built = await build({ endsAt: LATE });
    await answered(built);
    const listedBy = new Date();
    built.hooks.beforeClaim = async () => {
      delete built.hooks.beforeClaim;
      await prisma.attempt.update({ where: { id: built.attemptId }, data: { endsAt: SOON } });
    };

    const result = await built.submit.expire(built.attemptId, listedBy);

    assert.equal(result.submittedByThisCall, false);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.ok(await built.state.read(built.attemptId), 'the key it is answered through stays');
    assert.equal(built.queue.jobs.length, 0);
  });
});

describe('a queue that is down at submit', () => {
  /** The failure this prevents: a submit that committed while the queue was unreachable, scored by nobody. */
  it('still ends with the sitting scored, queued again under its own id', async () => {
    const built = await build();
    await answered(built);
    built.queue.failNext = true;

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.submittedByThisCall, true);
    assert.equal(built.queue.jobs.length, 0);
    await prisma.attempt.update({ where: { id: built.attemptId }, data: { submittedAt: LATE } });
    await built.sweeper.process();

    assert.deepEqual(
      built.queue.jobs.map((job) => job.jobId),
      [scoringJobId(built.attemptId)],
    );
  });

  it('does not queue twice a sitting whose job the queue still holds', async () => {
    const built = await build();
    await answered(built);

    await built.submit.submit(built.student, built.attemptId);
    await prisma.attempt.update({ where: { id: built.attemptId }, data: { submittedAt: LATE } });
    await built.sweeper.process();

    assert.equal(built.queue.jobs.length, 1);
  });
});

describe('a save that races the submit', () => {
  /** The failure this prevents: an autosave accepted with a 200 and then thrown away by the take. */
  it('writes an answer that landed while the claim was in flight', async () => {
    const built = await build();
    await answered(built);
    built.hooks.beforeClaim = async () => {
      delete built.hooks.beforeClaim;
      // The student's last answer lands between the read and the take, as an autosave would.
      await built.state.save(
        built.student,
        built.attemptId,
        { revision: 2, answers: [built.change(built.q2)] },
        NOW,
      );
    };

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 2);
    assert.equal(await chosenOn(built.attemptId, built.q2), RIGHT_OPTION);
  });

  /** The failure this prevents: a flush that read an older revision landing after submit's write. */
  it('keeps the last answer when a stale flush lands between the write and the claim', async () => {
    const built = await build();
    await built.state.open(built.live);
    const first = { ...built.change(), selectedOptionId: WRONG_OPTION };
    await built.state.save(built.student, built.attemptId, { revision: 1, answers: [first] }, NOW);
    const stale = await built.state.read(built.attemptId);
    assert.ok(stale);
    await built.state.save(
      built.student,
      built.attemptId,
      { revision: 2, answers: [built.change()] },
      NOW,
    );
    built.hooks.beforeClaim = async () => {
      delete built.hooks.beforeClaim;
      await built.sheets.write(stale, true);
    };

    await built.submit.submit(built.student, built.attemptId);

    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
  });

  /** The failure this prevents: the one caller that can still write those answers dropping them. */
  it('writes the live state it finds behind an attempt that has already ended', async () => {
    const built = await build();
    await answered(built);
    await prisma.attempt.update({
      where: { id: built.attemptId },
      data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: NOW },
    });

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.submittedByThisCall, false);
    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
    // A key outliving its sitting would go on accepting saves for the whole 12h TTL.
    assert.equal(await built.state.read(built.attemptId), null);
  });
});

describe('a key put back from Postgres while the sitting is being ended', () => {
  /** The live key as a state service sees it when `ending` lands right after it has read the sitting as live. */
  function rebuilding(built: Built, ending: () => Promise<unknown>): AttemptStateService {
    let pending = true;
    const client = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== 'attempt') return Reflect.get(target, key) as unknown;
        return new Proxy(target.attempt, {
          get(delegate, method: string | symbol) {
            if (method !== 'findUnique') return Reflect.get(delegate, method) as unknown;
            return async (args: Prisma.AttemptFindUniqueArgs) => {
              const row = await delegate.findUnique(args);
              if (pending) {
                pending = false;
                await ending();
              }
              return row;
            };
          },
        });
      },
    });
    return new AttemptStateService(client, built.redis.asService(), new PaperSheetService(prisma));
  }

  const submitting = (built: Built) => () => built.submit.submit(built.student, built.attemptId);

  const voiding = (built: Built) => async () => {
    const support = new AttemptResolutionService(
      prisma,
      built.state,
      built.sheets,
      built.submit,
      new RollupQueue(new FakeQueue().asQueue()),
      new AuditContext(),
    );
    const adminId = (await makeAdmin(prisma)).id;
    await support.void(
      built.attemptId,
      { reason: 'Sat by someone else', regrantRanked: false },
      adminId,
    );
  };

  const saving = (state: AttemptStateService, built: Built) =>
    state.save(built.student, built.attemptId, { revision: 1, answers: [built.change()] }, NOW);

  const rebuilds: Record<string, (state: AttemptStateService, built: Built) => Promise<unknown>> = {
    'a save': saving,
    'a reloaded screen reading its state': (state, built) =>
      state.current(built.student, built.attemptId, NOW),
    'a resume': (state, built) => state.resume(built.live, 'tab_a', NOW),
    'a support reset': (state, built) => state.reestablish(built.student, built.attemptId),
  };

  const refusedAsEnded = (error: unknown) =>
    AppException.is(error) && error.code === ErrorCodes.SITTING_ENDED;

  for (const [what, rebuild] of Object.entries(rebuilds)) {
    /** The failure this prevents: a fresh key behind a handed-in sitting, taking saves nobody will ever write. */
    it(`refuses ${what} that put the key back as the submit landed, and leaves no key`, async () => {
      const built = await build();

      await assert.rejects(
        () => rebuild(rebuilding(built, submitting(built)), built),
        refusedAsEnded,
      );

      assert.equal(await built.state.read(built.attemptId), null);
      assert.deepEqual(await built.state.dirtyIds(), []);
    });
  }

  it('refuses a save that put the key back as a void landed, and leaves no key', async () => {
    const built = await build();

    await assert.rejects(() => saving(rebuilding(built, voiding(built)), built), refusedAsEnded);

    assert.equal(await built.state.read(built.attemptId), null);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.VOIDED);
  });

  for (const status of [ATTEMPT_STATUS.EVALUATED, ATTEMPT_STATUS.VOIDED]) {
    /** The failure this prevents: a late submit writing a stray key over answers the scorer already marked. */
    it(`drops a stray key behind a sitting that is ${status} rather than writing it over the sheet`, async () => {
      const built = await build();
      await answered(built);
      await prisma.attempt.update({
        where: { id: built.attemptId },
        data: { status, submittedAt: NOW },
      });
      const sheet = () =>
        prisma.attemptSheet.findUniqueOrThrow({
          where: { attemptId: built.attemptId },
          select: { answers: true },
        });
      const marked = await sheet();

      const result = await built.submit.submit(built.student, built.attemptId);

      assert.equal(result.submittedByThisCall, false);
      assert.deepEqual(await sheet(), marked);
      assert.equal(await built.state.read(built.attemptId), null);
    });
  }
});

describe('a sitting the scorer never scored', () => {
  const unscored = () => build({ status: ATTEMPT_STATUS.SUBMITTED, submittedAt: LATE });

  /** The failure this prevents: a job that exhausted its retries leaving a result nobody owns. */
  it('queues a score again under the sitting’s own id', async () => {
    const { attemptId, queue, sweeper } = await unscored();

    await sweeper.process();

    assert.deepEqual(
      queue.jobs.map((job) => job.jobId),
      [scoringJobId(attemptId)],
    );
  });

  it('does not stack a second ask on top of a job the queue still holds', async () => {
    const { attemptId, testId, queue, scoring, sweeper } = await unscored();
    await scoring.queue([{ id: attemptId, testId }]);

    await sweeper.process();

    assert.equal(queue.jobs.length, 1);
  });

  it('leaves a scored sitting alone, and one that has only just ended', async () => {
    const { attemptId, queue, sweeper } = await build({
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: new Date(),
    });

    await sweeper.process();
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: LATE, score: 0 },
    });
    await sweeper.process();

    assert.equal(queue.jobs.length, 0);
  });
});
