import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redisKeys, EDIT_LOCK_TTL_SEC } from '../src/redis/redis.keys';
import { FakeRedis } from './support/fakes';

const KEY = redisKeys.testEditLock('tst_1');
const PRIYA = 'adm_priya';
const RAVI = 'adm_ravi';

const take = (redis: FakeRedis, adminId: string, steal = false) =>
  redis.asService().holdLock(KEY, adminId, EDIT_LOCK_TTL_SEC, steal);

describe('the test edit lock', () => {
  it('names the admin already editing rather than just refusing', async () => {
    const redis = new FakeRedis();

    assert.equal(await take(redis, PRIYA), null);
    assert.equal(await take(redis, RAVI), PRIYA);
  });

  /** A refusal reads the key and nothing else: the loser must not push the holder's window out. */
  it('leaves the lock exactly where it was when it refuses', async () => {
    const redis = new FakeRedis();
    await take(redis, PRIYA);
    redis.advanceSeconds(EDIT_LOCK_TTL_SEC - 60);

    await take(redis, RAVI);

    assert.equal(redis.snapshot()[KEY], PRIYA);
    redis.advanceSeconds(120);
    assert.equal(redis.snapshot()[KEY], undefined);
  });

  it('lets the holder back in, and their fifteen minutes start again', async () => {
    const redis = new FakeRedis();
    await take(redis, PRIYA);
    redis.advanceSeconds(EDIT_LOCK_TTL_SEC - 60);

    assert.equal(await take(redis, PRIYA), null);

    redis.advanceSeconds(EDIT_LOCK_TTL_SEC - 60);
    assert.equal(redis.snapshot()[KEY], PRIYA);
  });

  /** The laptop closed on a held lock is the fifteen-minute lockout the override exists for. */
  it('hands it to a super admin, who then holds it themselves', async () => {
    const redis = new FakeRedis();
    await take(redis, PRIYA);

    assert.equal(await take(redis, RAVI, true), null);

    assert.equal(redis.snapshot()[KEY], RAVI);
    assert.equal(await take(redis, PRIYA), RAVI);
  });

  it('lapses once nobody has edited for fifteen minutes', async () => {
    const redis = new FakeRedis();
    await take(redis, PRIYA);

    redis.advanceSeconds(EDIT_LOCK_TTL_SEC + 1);

    assert.equal(await take(redis, RAVI), null);
  });
});
