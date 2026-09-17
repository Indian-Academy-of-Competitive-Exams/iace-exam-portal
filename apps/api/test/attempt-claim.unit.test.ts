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
  endsAt: ENDS_AT,
  revision: 0,
  answers: {},
  sections: {},
  ...over,
});

const sitting = (id: string) => ({
  id,
  studentId: 'stu_1',
  endsAt: new Date(ENDS_AT),
});

const serviceOn = (redis: FakeRedis) =>
  new AttemptStateService({} as PrismaService, redis.asService());

const tabOf = async (redis: FakeRedis, attemptId: string): Promise<string | null | undefined> => {
  const state = await redis.getJson<HeldState>(redisKeys.attemptState(attemptId));
  return state?.tab;
};

const heldOf = (redis: FakeRedis): Promise<HeldState | null> =>
  redis.getJson<HeldState>(redisKeys.attemptState('att_1'));

const answer = (questionId: string) => ({
  questionId,
  state: 'ANSWERED' as const,
  selectedOptionId: 'opt_a',
  timeSpentSec: 12,
});

const refusal = (pending: Promise<unknown>): Promise<AppException | null> =>
  pending.then(() => null).catch((error: AppException) => error);

/** Runs `meanwhile` after a read of att_1's key and before its reader goes on, for `times` reads. */
function interleave(redis: FakeRedis, meanwhile: () => Promise<unknown>, times = 1): void {
  const key = redisKeys.attemptState('att_1');
  let left = times;
  const after = async <T>(read: Promise<T>, readKey: string): Promise<T> => {
    const value = await read;
    if (readKey === key && left > 0) {
      left -= 1;
      await meanwhile();
    }
    return value;
  };
  const getRaw = redis.getRaw.bind(redis);
  const getJson = redis.getJson.bind(redis);
  redis.getRaw = (readKey) => after(getRaw(readKey), readKey);
  redis.getJson = <T>(readKey: string) => after(getJson<T>(readKey), readKey);
}

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

describe('AttemptStateService — a handover racing a save', () => {
  /** The failure this prevents: an acknowledged answer erased by a resume that read before it landed. */
  it("keeps the answer a save landed while another device's resume was mid-handover", async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    interleave(redis, () =>
      state.save('stu_1', 'att_1', { revision: 1, answers: [answer('q1')], tab: 'tab_a' }),
    );

    await state.open(sitting('att_1'), 'tab_b');

    const after = await heldOf(redis);
    assert.equal(after?.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(after?.tab, 'tab_b');
  });

  /** The failure this prevents: a stale save putting its tab back, locking out the device that reclaimed. */
  it('refuses a save that read before another device reclaimed the sitting', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    interleave(redis, () => state.open(sitting('att_1'), 'tab_b'));

    const refused = await refusal(
      state.save('stu_1', 'att_1', { revision: 1, answers: [answer('q1')], tab: 'tab_a' }),
    );

    assert.equal(refused?.code, ErrorCodes.SITTING_TAKEN_OVER);
    assert.equal((await heldOf(redis))?.tab, 'tab_b');
    const ack = await state.save('stu_1', 'att_1', {
      revision: 2,
      answers: [answer('q2')],
      tab: 'tab_b',
    });
    assert.equal(ack.revision, 2);
  });

  /** Two starts both finding no key: the second must not seed over what the first already saved. */
  it('does not seed over a sitting another device opened and answered meanwhile', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    interleave(redis, async () => {
      await state.open(sitting('att_1'), 'tab_a');
      await state.save('stu_1', 'att_1', { revision: 1, answers: [answer('q1')], tab: 'tab_a' });
    });

    await state.open(sitting('att_1'), 'tab_b');

    const after = await heldOf(redis);
    assert.equal(after?.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(after?.tab, 'tab_b');
  });

  it('refuses a save that keeps losing the race, rather than writing over', async () => {
    const redis = new FakeRedis();
    const state = serviceOn(redis);
    await state.open(sitting('att_1'), 'tab_a');
    let written = held({ tab: 'tab_a' });
    let racing = true;
    interleave(
      redis,
      async () => {
        if (!racing) return;
        written = { ...written, revision: written.revision + 1 };
        await redis.setJson(redisKeys.attemptState('att_1'), written, 60);
      },
      Number.POSITIVE_INFINITY,
    );

    const refused = await refusal(
      state.save('stu_1', 'att_1', { revision: 99, answers: [answer('q1')], tab: 'tab_a' }),
    );
    racing = false;

    assert.equal(refused?.code, ErrorCodes.CONFLICT);
    assert.deepEqual(await heldOf(redis), written);
    assert.deepEqual(await state.dirtyIds(), []);
  });
});
