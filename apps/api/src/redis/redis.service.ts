import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { evictionRisk } from './eviction-policy';

/** Redis runs one script at a time, so the compare and the set cannot be interleaved. */
const REPLACE_IF_UNCHANGED = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

/** The same compare, for a lock: a run that outlived its TTL must not drop its successor's key. */
const DELETE_IF_HELD_BY = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

/** Reads an index and deletes it with every member's key in the same pass, so nothing added after the read outlives the delete. */
const DELETE_INDEXED_SET = `
local ids = redis.call('SMEMBERS', KEYS[1])
local keys = {KEYS[1]}
for i, id in ipairs(ids) do
  keys[i + 1] = ARGV[1] .. id
end
redis.call('DEL', unpack(keys))
return ids
`;

/** The take-over from holdLock, atomic: a lapsed lock cannot be read as free by two callers at once. */
const TAKE_OVER_LOCK = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then return false end
local holder = redis.call('GET', KEYS[1])
if holder == false or holder == ARGV[1] or ARGV[3] == '1' then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return false
end
return holder
`;

/** Reconnect backoff: quick enough for a restart, slow enough not to storm a Redis that is still down. */
const RETRY_STEP_MS = 200;
const RETRY_CEILING_MS = 5000;

/** The application Redis connection: OTP codes, sessions, device binding, rate limiting, live test state. */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly isProduction: boolean;
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.isProduction = config.isProduction;
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (attempt) => Math.min(attempt * RETRY_STEP_MS, RETRY_CEILING_MS),
    });
    this.client.on('error', (error: Error) => this.logger.error(`Redis error: ${error.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.guardEvictionPolicy();
    this.logger.log('Connected to Redis');
  }

  /** Refuses to boot production against a Redis that may evict, rather than losing sittings later. */
  private async guardEvictionPolicy(): Promise<void> {
    const risk = evictionRisk(await this.maxmemoryPolicy());
    if (!risk) return;
    if (risk.fatal && this.isProduction) throw new Error(risk.message);
    this.logger.warn(risk.message);
  }

  /** Null when the command is refused, which managed Redis often does — unknown, not safe. */
  private async maxmemoryPolicy(): Promise<string | null> {
    try {
      const reported: unknown = await this.client.config('GET', 'maxmemory-policy');
      return Array.isArray(reported) && typeof reported[1] === 'string' ? reported[1] : null;
    } catch {
      return null;
    }
  }

  /** Shutdown, not destroy: the workers close in this hook, and they still need the connection. */
  async onApplicationShutdown(): Promise<void> {
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

  /** One round trip for many keys. A corrupt value reads as absent and is LEFT: this never evicts. */
  async mgetJson<T>(keys: readonly string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const raw = await this.client.mget(...keys);
    return raw.map((value) => {
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    });
  }

  async getRaw(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Compare-and-set on the exact bytes read, null for no key, so a lost race changes nothing. */
  async replaceJson(
    key: string,
    was: string | null,
    value: unknown,
    ttlSec: number,
  ): Promise<boolean> {
    const applied = await this.client.eval(
      REPLACE_IF_UNCHANGED,
      1,
      key,
      // No JSON value is empty, so '' can stand for the key being absent.
      was ?? '',
      JSON.stringify(value),
      String(ttlSec),
    );
    return applied === 1;
  }

  /** Reads and removes in ONE command: whatever arrives after it finds nothing, which is the point. */
  async takeJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.getdel(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  /** Deletes an index and every `keyPrefix + member` key in one script — a member added after the read cannot outlive it. */
  async deleteIndexedSet(indexKey: string, keyPrefix: string): Promise<string[]> {
    return this.client.eval(DELETE_INDEXED_SET, 1, indexKey, keyPrefix) as Promise<string[]>;
  }

  /** True only for the caller that took it; everyone else is refused until the TTL runs out. */
  async acquireLock(key: string, holderId: string, ttlSec: number): Promise<boolean> {
    return (await this.client.set(key, holderId, 'EX', ttlSec, 'NX')) === 'OK';
  }

  /** Releases only what this holder still owns: past the TTL the key is somebody else's. */
  async releaseLock(key: string, holderId: string): Promise<boolean> {
    return (await this.client.eval(DELETE_IF_HELD_BY, 1, key, holderId)) === 1;
  }

  /** Null once the caller holds it, else who does. The holder re-enters; `steal` takes it over. */
  async holdLock(
    key: string,
    holderId: string,
    ttlSec: number,
    steal = false,
  ): Promise<string | null> {
    const holder = await this.client.eval(
      TAKE_OVER_LOCK,
      1,
      key,
      holderId,
      String(ttlSec),
      steal ? '1' : '0',
    );
    return (holder as string | null) ?? null;
  }

  /** Remaining TTL in seconds, or 0 when the key is gone / has no expiry. */
  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return Math.max(ttl, 0);
  }
}
