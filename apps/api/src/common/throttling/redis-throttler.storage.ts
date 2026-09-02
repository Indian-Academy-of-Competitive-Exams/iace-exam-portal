import { Logger } from '@nestjs/common';
import { type ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../../redis/redis.service';
import { redisKeys } from '../../redis/redis.keys';
import { ALLOWED, windowRecord, type ThrottlerRecord } from './rate-limit';

/** Counting in Redis rather than in one process's memory: four API containers are one limit, not four. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const counter = redisKeys.rateLimit(throttlerName, key);
    try {
      const replies = await this.redis.client.multi().incr(counter).pttl(counter).exec();
      const hits = Number(replies?.[0]?.[1] ?? 0);
      const remainingMs = Number(replies?.[1]?.[1] ?? -1);

      // A counter with no expiry is the first hit of a window, or one a restart left behind.
      if (remainingMs < 0) await this.redis.client.pexpire(counter, ttl);

      return windowRecord(hits, limit, remainingMs, ttl);
    } catch (error) {
      // Fails open on purpose: a Redis blip must not turn every request into a 429 mid-test.
      this.logger.warn(`Rate limit not counted for ${throttlerName}: ${String(error)}`);
      return ALLOWED;
    }
  }
}
