import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type AnswerChange,
} from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { sheetOf } from '../src/attempts/answer-sheet';
import { SHEET_ROW_SELECT } from '../src/attempts/paper-sheet.service';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeRedis } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');
const NOW = new Date('2026-09-01T05:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A live two-question sitting ending at ENDS_AT; its first answer already flushed when `durable`. */
async function build(durable = false) {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  const student = (await makeStudent(prisma)).id;
  const startedAt = new Date(ENDS_AT.getTime() - HOUR_MS);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student,
    chosen: durable ? [RIGHT_OPTION, null] : [null, null],
    timeSpent: [durable ? 20 : 0, 0],
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt,
    submittedAt: null,
  });
  const [q1 = '', q2 = ''] = paper.items.map((item) => item.questionId);
  if (durable) {
    const held = {
      [q1]: {
        state: ANSWER_STATE.ANSWERED,
        selectedOptionId: RIGHT_OPTION,
        typedAnswer: null,
        timeSpentSec: 20,
        answeredAt: '2026-09-01T05:01:00.000Z',
        firstActionAt: null,
      },
    };
    const paperRows = await prisma.paperQuestion.findMany({
      where: { testId: paper.testId },
      orderBy: { order: 'asc' },
      select: SHEET_ROW_SELECT,
    });
    await prisma.attemptSheet.update({
      where: { attemptId: attempt.id },
      data: { answers: sheetOf(held, paperRows, new Date(ENDS_AT.getTime() - HOUR_MS)) },
    });
  }
  const redis = new FakeRedis();
  const service = new AttemptStateService(prisma, redis.asService());
  const live = {
    id: attempt.id,
    studentId: student,
    testId: paper.testId,
    startedAt,
    endsAt: ENDS_AT,
  };
  const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
    questionId: q1,
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: RIGHT_OPTION,
    typedAnswer: null,
    timeSpentSec: 10,
    ...over,
  });
  return { service, redis, student, attemptId: attempt.id, live, q1, q2, change };
}

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

describe('AttemptStateService', () => {
  it('saves to Redis and marks the attempt dirty', async () => {
    const { service, redis, student, attemptId, live, q1, change } = await build();
    await service.open(live);

    const ack = await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    assert.equal(ack.revision, 1);
    const state = await service.current(student, attemptId, NOW);
    assert.equal(state.answers[q1]?.state, ANSWER_STATE.ANSWERED);
    assert.deepEqual(await service.dirtyIds(), [attemptId]);
    assert.ok(redis.snapshot()[`attempt:state:${attemptId}`]);
  });

  /** An id is not a thing to confirm the existence of, so another student's reads as missing. */
  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const { service, attemptId, live } = await build();
    await service.open(live);

    await assert.rejects(
      () => service.save(uid(), attemptId, { revision: 1, answers: [] }, NOW),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('refuses a save that arrives after the clock and its grace', async () => {
    const { service, student, attemptId, live } = await build();
    await service.open(live);

    await assert.rejects(
      () =>
        service.save(
          student,
          attemptId,
          { revision: 1, answers: [] },
          new Date('2026-09-01T06:00:00.000Z'),
        ),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  /** Taking the state is what ends a sitting: with the key gone, Postgres is what a save rebuilds from. */
  it('rebuilds a save from Postgres once the sitting has been taken', async () => {
    const { service, student, attemptId, live, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    await service.take(attemptId);

    assert.deepEqual(await service.dirtyIds(), []);
    await service.save(student, attemptId, { revision: 2, answers: [] }, NOW);
    const rebuilt = await service.current(student, attemptId, NOW);
    assert.equal(Object.keys(rebuilt.answers).length, 0);
  });

  /** The failure this prevents: a support reset handing the student back an empty paper. */
  it('puts a lost live key back from the answers already written', async () => {
    const { service, student, attemptId, q1 } = await build(true);

    const rebuilt = await service.reestablish(student, attemptId);

    assert.deepEqual(Object.keys(rebuilt.answers), [q1]);
    assert.equal(rebuilt.answers[q1]?.state, ANSWER_STATE.ANSWERED);
    assert.equal(rebuilt.answers[q1]?.selectedOptionId, RIGHT_OPTION);
  });

  /** The key holds what landed since the last flush, so a reset must not roll the student back. */
  it('keeps whatever the key still holds over the durable copy', async () => {
    const { service, student, attemptId, live, q1, q2, change } = await build(true);
    await service.open(live);
    await service.save(
      student,
      attemptId,
      { revision: 4, answers: [change({ questionId: q2 })] },
      NOW,
    );

    const rebuilt = await service.reestablish(student, attemptId);

    assert.equal(rebuilt.revision, 4);
    assert.deepEqual(Object.keys(rebuilt.answers).sort(), [q1, q2].sort());
  });

  /** The bug this prevents: an extension rewriting the whole key and dropping the last autosave. */
  it('moves the deadline without touching what the sitting has answered', async () => {
    const { service, redis, student, attemptId, live, q1, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    const later = new Date('2026-09-01T06:00:00.000Z');
    await service.pushDeadline(attemptId, later);

    const state = await service.current(student, attemptId, NOW);
    assert.equal(state.endsAt, later.toISOString());
    assert.equal(state.revision, 1);
    assert.equal(state.answers[q1]?.state, ANSWER_STATE.ANSWERED);
    assert.ok(redis.snapshot()[`attempt:state:${attemptId}`]);
  });

  /** No key is no clock to move: the row carries the new deadline, and a rebuild reads it there. */
  it('does nothing to a deadline whose live key has gone', async () => {
    const { service, attemptId } = await build();

    await service.pushDeadline(attemptId, new Date('2026-09-01T06:00:00.000Z'));

    assert.deepEqual(await service.read(attemptId), null);
  });

  it('leaves the answers of a resumed sitting alone', async () => {
    const { service, student, attemptId, live, q1, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    await service.open(live);

    assert.equal((await service.read(attemptId))?.answers[q1]?.selectedOptionId, RIGHT_OPTION);
  });

  /** The bug this prevents: a Redis restart wiping 40 flushed answers back to nothing on reload. */
  it('rebuilds a resume from Postgres rather than seeding it empty when the key is gone', async () => {
    const { service, attemptId, live, q1 } = await build(true);

    await service.resume(live);

    const held = await service.read(attemptId);
    assert.deepEqual(Object.keys(held?.answers ?? {}), [q1]);
    assert.equal(held?.answers[q1]?.selectedOptionId, RIGHT_OPTION);
  });

  /** The bug this prevents: the key keeping the old deadline, so every save after a resume is refused. */
  it('admits saves against the deadline a resume credited, not the one it walked away from', async () => {
    const { service, student, attemptId, live, q1, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    const backAt = new Date('2026-09-01T07:00:00.000Z');
    const credited = await service.resume(live, undefined, backAt);

    assert.ok(credited.getTime() > ENDS_AT.getTime());
    assert.equal((await service.read(attemptId))?.endsAt, credited.toISOString());
    const ack = await service.save(
      student,
      attemptId,
      { revision: 2, answers: [change({ questionId: q1, selectedOptionId: 'o3' })] },
      backAt,
    );
    assert.equal(ack.applied, true);
    assert.equal(ack.endsAt, credited.toISOString());
  });

  it('leaves what a live key already holds alone when resuming', async () => {
    const { service, student, attemptId, live, q1, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

    await service.resume(live);

    assert.equal((await service.read(attemptId))?.answers[q1]?.selectedOptionId, RIGHT_OPTION);
  });

  /** A key from before testId/startedAt existed must not keep lacking them across a resume. */
  it('backfills testId and startedAt onto a key written before they existed', async () => {
    const { service, redis, student, attemptId, live } = await build();
    await redis.setJson(
      redisKeys.attemptState(attemptId),
      {
        attemptId,
        studentId: student,
        endsAt: ENDS_AT.toISOString(),
        revision: 0,
        answers: {},
        pending: [],
        sections: {},
      },
      60,
    );

    await service.open(live);

    const held = await service.read(attemptId);
    assert.equal(held?.testId, live.testId);
    assert.equal(held?.startedAt, live.startedAt.toISOString());
  });

  /** The failure this prevents: a flush clearing a mark whose answer changed again while it wrote. */
  it('keeps an answer pending when a save changes it while a flush is writing the old one', async () => {
    const { service, student, attemptId, live, q1, change } = await build();
    await service.open(live);
    await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);
    const read = await service.read(attemptId);

    await service.save(
      student,
      attemptId,
      { revision: 2, answers: [change({ selectedOptionId: 'o3' })] },
      NOW,
    );
    await service.clearPending(attemptId, read?.answers ?? {});

    assert.deepEqual((await service.read(attemptId))?.pending, [q1]);
  });

  describe('reading a sitting back', () => {
    /** The bug this prevents: a mid-test reload showing a blank palette while the answers are safe. */
    it('returns what the sitting holds, without changing it', async () => {
      const { service, student, attemptId, q1, change } = await build();
      await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

      const shown = await service.current(student, attemptId, NOW);

      assert.equal(shown.answers[q1]?.state, ANSWER_STATE.ANSWERED);
      assert.equal(shown.answers[q1]?.selectedOptionId, RIGHT_OPTION);
      assert.equal(shown.revision, 1, 'reading must not move the revision on');
    });

    it("reads another student's sitting as missing, never as refused", async () => {
      const { service, student, attemptId, change } = await build();
      await service.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);

      await assert.rejects(
        () => service.current(uid(), attemptId, NOW),
        refusedWith(ErrorCodes.NOT_FOUND),
      );
    });
  });
});
