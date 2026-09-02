import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { ALLOWED, trackerFor, windowRecord } from '../src/common/throttling/rate-limit';
import { RedisThrottlerStorage } from '../src/common/throttling/redis-throttler.storage';
import { RATE_LIMITS, notMarkedWith, RATE_LIMIT_KEY } from '../src/common/throttling/rate-limits';
import type { AuthenticatedUser } from '../src/common/security';
import type { RedisService } from '../src/redis/redis.service';

const student = (id: string): AuthenticatedUser =>
  ({ id, actor: ActorTypes.STUDENT }) as AuthenticatedUser;

/** Enough of ioredis for one window: a counter per key, and a TTL that is set once. */
function fakeRedis(over: { failing?: boolean } = {}) {
  const hits = new Map<string, number>();
  const ttls = new Map<string, number>();
  const client = {
    multi() {
      const keys: string[] = [];
      const chain = {
        incr(key: string) {
          keys.push(key);
          hits.set(key, (hits.get(key) ?? 0) + 1);
          return chain;
        },
        pttl(key: string) {
          keys.push(key);
          return chain;
        },
        exec: async () => {
          if (over.failing) throw new Error('redis is down');
          const key = keys[0]!;
          return [
            [null, hits.get(key)],
            [null, ttls.get(key) ?? -1],
          ];
        },
      };
      return chain;
    },
    pexpire: async (key: string, ms: number) => ttls.set(key, ms),
  };

  return { storage: new RedisThrottlerStorage({ client } as unknown as RedisService), hits, ttls };
}

describe('trackerFor', () => {
  /** A branch sits behind one NAT address: counting a signed-in student by IP would throttle the hall. */
  it('counts a signed-in caller as themselves, not as their address', () => {
    assert.equal(trackerFor(student('stu_1'), '10.0.0.1'), 'student:stu_1');
    assert.notEqual(
      trackerFor(student('stu_1'), '10.0.0.1'),
      trackerFor(student('stu_2'), '10.0.0.1'),
    );
  });

  it('falls back to the address when nobody is signed in', () => {
    assert.equal(trackerFor(undefined, '203.0.113.9'), 'ip:203.0.113.9');
  });

  it('still returns a tracker when there is no address either', () => {
    assert.equal(trackerFor(undefined, undefined), 'ip:unknown');
  });
});

describe('windowRecord', () => {
  it('is not blocked at the limit, and blocked one past it', () => {
    assert.equal(windowRecord(5, 5, 30_000, 60_000).isBlocked, false);
    assert.equal(windowRecord(6, 5, 30_000, 60_000).isBlocked, true);
  });

  it('reports the seconds left in the window, from milliseconds', () => {
    assert.equal(windowRecord(1, 5, 30_000, 60_000).timeToExpire, 30);
  });

  /** The first hit of a window: the counter exists but its expiry is being set in the same breath. */
  it('reports the whole window when the counter has no expiry yet', () => {
    assert.equal(windowRecord(1, 5, -1, 60_000).timeToExpire, 60);
  });
});

describe('RedisThrottlerStorage', () => {
  it('counts hits per key and expires the counter once', async () => {
    const { storage, ttls } = fakeRedis();

    const first = await storage.increment('ip:1', 60_000, 2, 0, 'auth');
    const second = await storage.increment('ip:1', 60_000, 2, 0, 'auth');
    const third = await storage.increment('ip:1', 60_000, 2, 0, 'auth');

    assert.equal(first.isBlocked, false);
    assert.equal(second.isBlocked, false);
    assert.equal(third.isBlocked, true);
    assert.deepEqual([...ttls.values()], [60_000]);
  });

  it('counts two throttlers over one tracker separately', async () => {
    const { storage, hits } = fakeRedis();

    await storage.increment('ip:1', 60_000, 2, 0, 'auth');
    await storage.increment('ip:1', 60_000, 2, 0, 'share');

    assert.deepEqual([...hits.values()], [1, 1]);
  });

  /** A Redis blip mid-exam must cost a rate limit, never a sitting. */
  it('fails open when Redis will not answer', async () => {
    const { storage } = fakeRedis({ failing: true });

    assert.deepEqual(await storage.increment('ip:1', 60_000, 1, 0, 'auth'), ALLOWED);
  });
});

describe('a named throttler only runs where its decorator is', () => {
  const contextFor = (name?: string) => {
    const handler = () => undefined;
    if (name) Reflect.defineMetadata(RATE_LIMIT_KEY, name, handler);
    return { getHandler: () => handler } as never;
  };

  it('skips a route that asked for a different limit', () => {
    assert.equal(notMarkedWith(RATE_LIMITS.AUTH)(contextFor(RATE_LIMITS.SITTING)), true);
  });

  it('skips a route that asked for none', () => {
    assert.equal(notMarkedWith(RATE_LIMITS.AUTH)(contextFor()), true);
  });

  it('runs on the route that asked for it', () => {
    assert.equal(notMarkedWith(RATE_LIMITS.AUTH)(contextFor(RATE_LIMITS.AUTH)), false);
  });
});
