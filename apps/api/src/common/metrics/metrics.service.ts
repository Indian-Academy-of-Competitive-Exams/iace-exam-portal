/**
 * The signals 6B will set thresholds against. 6A only emits them, and every one
 * of them names a way a live test goes wrong: a queue that stops draining, a
 * Redis that starts evicting, a submit spike, a pool with nothing left in it.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { redisKeys } from '../../redis/redis.keys';
import { QUEUE_NAMES, type QueueName } from '../../queue/queues';

/** Seconds, not milliseconds: everything downstream of a Prometheus scrape assumes seconds. */
const LATENCY_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const PREFIX = 'iace_';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  private readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  private readonly submits: Counter<'outcome'>;
  private readonly queueDepth: Gauge<'queue'>;
  private readonly queueOldestWait: Gauge<'queue'>;
  private readonly redisMemory: Gauge<string>;
  private readonly redisEvictions: Gauge<string>;
  private readonly liveAttempts: Gauge<string>;
  private readonly dbConnections: Gauge<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_NAMES.SCORING) private readonly scoring: Queue,
    @InjectQueue(QUEUE_NAMES.ROLLUP) private readonly rollup: Queue,
    @InjectQueue(QUEUE_NAMES.ATTEMPT_FLUSH) private readonly flush: Queue,
    @InjectQueue(QUEUE_NAMES.ATTEMPT_SWEEP) private readonly sweep: Queue,
  ) {
    this.httpDuration = new Histogram({
      name: `${PREFIX}http_request_duration_seconds`,
      help: 'API latency, and the error rate by count over the status label',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });

    this.submits = new Counter({
      name: `${PREFIX}attempt_submits_total`,
      help: 'Sittings handed in — the spike everything downstream is sized for',
      labelNames: ['outcome'] as const,
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: `${PREFIX}queue_depth`,
      help: 'Jobs waiting, delayed or running. A number that only climbs is a worker that stopped',
      labelNames: ['queue'] as const,
      registers: [this.registry],
    });

    this.queueOldestWait = new Gauge({
      name: `${PREFIX}queue_oldest_waiting_seconds`,
      help: 'How long the oldest waiting job has waited — depth says how many, this says how bad',
      labelNames: ['queue'] as const,
      registers: [this.registry],
    });

    this.redisMemory = new Gauge({
      name: `${PREFIX}redis_memory_bytes`,
      help: 'Redis memory in use. Live attempt state, sessions and OTP are all here',
      registers: [this.registry],
    });

    this.redisEvictions = new Gauge({
      name: `${PREFIX}redis_evicted_keys_total`,
      help: 'Keys Redis has dropped. Under noeviction this is 0 forever, and any other number is an incident',
      registers: [this.registry],
    });

    this.liveAttempts = new Gauge({
      name: `${PREFIX}live_attempts`,
      help: 'Sittings holding state Postgres has not seen yet — what is actually in the hall',
      registers: [this.registry],
    });

    this.dbConnections = new Gauge({
      name: `${PREFIX}db_connections`,
      help: 'Backends open against our database, which a submit spike is capable of exhausting',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: PREFIX });
  }

  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.httpDuration.observe({ method, route, status: String(status) }, seconds);
  }

  countSubmit(outcome: 'accepted' | 'refused'): void {
    this.submits.inc({ outcome });
  }

  /** Everything that has to be asked for rather than counted, gathered on the scrape itself. */
  async scrape(): Promise<string> {
    await Promise.all([this.readQueues(), this.readRedis(), this.readDatabase()]);
    return this.registry.metrics();
  }

  private async readQueues(): Promise<void> {
    const queues: [QueueName, Queue][] = [
      [QUEUE_NAMES.SCORING, this.scoring],
      [QUEUE_NAMES.ROLLUP, this.rollup],
      [QUEUE_NAMES.ATTEMPT_FLUSH, this.flush],
      [QUEUE_NAMES.ATTEMPT_SWEEP, this.sweep],
    ];

    await Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
          const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
          this.queueDepth.set({ queue: name }, depth);
          this.queueOldestWait.set({ queue: name }, await this.oldestWait(queue));
        } catch (error) {
          this.logger.warn(`Queue metrics unavailable for ${name}: ${String(error)}`);
        }
      }),
    );
  }

  /** The head of the waiting list is the oldest, so one job answers it. */
  private async oldestWait(queue: Queue): Promise<number> {
    const [oldest] = await queue.getJobs(['waiting'], 0, 0, true);
    if (!oldest?.timestamp) return 0;
    return Math.max(0, (Date.now() - oldest.timestamp) / 1000);
  }

  private async readRedis(): Promise<void> {
    try {
      const info = await this.redis.client.info('memory');
      const stats = await this.redis.client.info('stats');
      this.redisMemory.set(fieldOf(info, 'used_memory'));
      this.redisEvictions.set(fieldOf(stats, 'evicted_keys'));
      this.liveAttempts.set(await this.redis.client.scard(redisKeys.attemptsDirty));
    } catch (error) {
      this.logger.warn(`Redis metrics unavailable: ${String(error)}`);
    }
  }

  private async readDatabase(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`;
      this.dbConnections.set(Number(rows[0]?.count ?? 0));
    } catch (error) {
      this.logger.warn(`Database metrics unavailable: ${String(error)}`);
    }
  }
}

/** One `field:value` line out of a Redis INFO section. */
function fieldOf(info: string, field: string): number {
  const match = new RegExp(String.raw`^${field}:(\d+)`, 'm').exec(info);
  return match ? Number(match[1]) : 0;
}
