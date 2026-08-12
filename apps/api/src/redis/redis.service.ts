import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * The application Redis connection: OTP codes, sessions, device binding, rate
 * limiting, live test state and leaderboards. BullMQ gets its own connection
 * (it issues blocking commands), so nothing here contends with the queues.
 *
 * Nothing stored through this service is ever mirrored into Postgres.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    this.client.on('error', (error: Error) => this.logger.error(`Redis error: ${error.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  // --- thin typed helpers, so feature code never hand-rolls JSON + TTL ---

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt value is treated as absent rather than crashing the caller.
      await this.client.del(key);
      return null;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  /** Remaining TTL in seconds, or 0 when the key is gone / has no expiry. */
  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return Math.max(ttl, 0);
  }
}
