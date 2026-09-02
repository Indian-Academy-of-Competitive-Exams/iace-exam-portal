import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { HealthController } from '../src/health/health.controller';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';
import type { StorageService } from '../src/storage/storage.service';

const up = async (): Promise<void> => undefined;
const down = (what: string) => async (): Promise<void> => {
  throw new Error(`${what} is unreachable`);
};

interface Deps {
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
  storage?: () => Promise<void>;
  queue?: () => Promise<void>;
}

function controller(deps: Deps = {}): HealthController {
  const queue = { getJobCounts: deps.queue ?? up };
  return new HealthController(
    { ping: deps.database ?? up } as unknown as PrismaService,
    { ping: deps.redis ?? up } as unknown as RedisService,
    { ping: deps.storage ?? up } as unknown as StorageService,
    queue as never,
  );
}

describe('GET /health', () => {
  it('reports every dependency, including the queue on its own connection', async () => {
    const body = await controller().check();

    assert.equal(body.status, 'ok');
    assert.deepEqual(Object.keys(body.dependencies).sort(), [
      'database',
      'queue',
      'redis',
      'storage',
    ]);
  });

  /** Liveness must not fail on a dependency: a Redis blip would otherwise restart every pod. */
  it('stays answerable while a dependency is down, and says which', async () => {
    const body = await controller({ redis: down('redis') }).check();

    assert.equal(body.status, 'degraded');
    assert.equal(body.dependencies.redis.status, 'down');
    assert.match(body.dependencies.redis.error ?? '', /unreachable/);
  });
});

describe('GET /health/ready', () => {
  it('is ready when the database, Redis and the queue all answer', async () => {
    const dependencies = await controller().ready();

    assert.equal(dependencies.database.status, 'up');
    assert.equal(dependencies.queue.status, 'up');
  });

  /** 503 is what stops the orchestrator routing a sitting at a pod that cannot hold it. */
  it('refuses with 503 when the queue is unreachable', async () => {
    await assert.rejects(controller({ queue: down('queue') }).ready(), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.SERVICE_UNAVAILABLE);
      assert.equal(error.httpStatus, 503);
      assert.match(error.message, /queue/);
      return true;
    });
  });

  /** Images are signed on a read path, not the sitting itself — storage down is degraded, not out. */
  it('stays ready when only storage is down', async () => {
    const dependencies = await controller({ storage: down('storage') }).ready();

    assert.equal(dependencies.storage.status, 'down');
  });

  it('names every dependency that is down, not just the first', async () => {
    await assert.rejects(
      controller({ redis: down('redis'), database: down('postgres') }).ready(),
      /database, redis/,
    );
  });
});
