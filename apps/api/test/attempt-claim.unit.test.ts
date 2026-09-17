import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCodes, type AppException } from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { holdsSitting, type HeldState } from '../src/attempts/attempt-state';
import { type PrismaService } from '../src/prisma/prisma.service';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeRedis } from './support/fakes';

const ENDS_AT = '2099-01-01T00:00:00.000Z';

const held = (over: Partial<HeldState> = {}): HeldState => ({
  attemptId: 'att_1',
  studentId: 'stu_1',
  testId: 'test_1',
  startedAt: '2026-01-01T00:00:00.000Z',
  endsAt: ENDS_AT,
  revision: 0,
  answers: {},
  sections: {},
  ...over,
});

const sitting = (id: string) => ({
  id,
  studentId: 'stu_1',
  testId: 'test_1',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  endsAt: new Date(ENDS_AT),
});

const serviceOn = (redis: FakeRedis) =>
  new AttemptStateService({} as PrismaService, redis.asService());

const tabOf = async (redis: FakeRedis, attemptId: string): Promise<string | null | undefined> => {
  const state = await redis.getJson<HeldState>(redisKeys.attemptState(attemptId));
  return state?.tab;
};

describe('holdsSitting — who may answer', () => {
  it('lets the tab holding it answer', () => {
    assert.equal(holdsSitting(held({ tab: 'tab_a' }), 'tab_a'), true);
  });

  it('refuses a tab that is not the one holding it', () => {
    assert.equal(holdsSitting(held({ tab: 'tab_a' }), 'tab_b'), false);
  });

  it('refuses a tab stood down when the student opened another sitting', () => {
    assert.equal(holdsSitting(held({ tab: null }), 'tab_a'), false);
  });

  /** A key rebuilt from Postgres is held by nobody, so the first tab back may carry on. */
  it('lets any tab adopt a sitting nobody holds', () => {
    assert.equal(holdsSitting(held(), 'tab_a'), true);
  });

  it('checks nothing for a caller that names no tab', () => {
    assert.equal(holdsSitting(held({ tab: null }), undefined), true);
  });
});

describe('AttemptStateService — one sitting at a time, across tabs and devices', () => {
  it('stands the previous sitting down when the student opens another', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);

    await state.open(sitting('att_1'), 'tab_a');
    await state.open(sitting('att_2'), 'tab_b');

    assert.equal(await tabOf(redis, 'att_1'), null);
    assert.equal(await tabOf(redis, 'att_2'), 'tab_b');
  });

  /** The failure this prevents: two tabs answering one paper, each dropping the other's batches. */
  it('hands the same sitting to the tab that opened it last', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);

    await state.open(sitting('att_1'), 'tab_a');
    await state.open(sitting('att_1'), 'tab_b');

    assert.equal(await tabOf(redis, 'att_1'), 'tab_b');
  });

  it('refuses a save from the tab that was stood down', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    await state.open(sitting('att_2'), 'tab_b');

    const refused = await state
      .save('stu_1', 'att_1', { revision: 1, answers: [], tab: 'tab_a' })
      .then(() => null)
      .catch((error: AppException) => error);

    assert.equal(refused?.code, ErrorCodes.SITTING_TAKEN_OVER);
  });

  it('takes the sitting back when the student returns to it', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    await state.open(sitting('att_2'), 'tab_b');

    await state.open(sitting('att_1'), 'tab_a');

    assert.equal(await tabOf(redis, 'att_1'), 'tab_a');
    assert.equal(await tabOf(redis, 'att_2'), null);
  });

  it('keeps the answers a stood-down sitting already held', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    await state.save('stu_1', 'att_1', {
      revision: 1,
      answers: [
        { questionId: 'q1', state: 'ANSWERED', selectedOptionId: 'opt_a', timeSpentSec: 12 },
      ],
      tab: 'tab_a',
    });

    await state.open(sitting('att_2'), 'tab_b');

    const stood = await redis.getJson<HeldState>(redisKeys.attemptState('att_1'));
    assert.equal(stood?.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(stood?.tab, null);
  });
});
