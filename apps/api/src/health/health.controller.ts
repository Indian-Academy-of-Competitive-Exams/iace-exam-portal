import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import {
  AppException,
  ErrorCodes,
  READINESS_DEPENDENCIES,
  type DependencyHealth,
  type HealthDependencies,
  type HealthResponse,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { QUEUE_NAMES } from '../queue/queues';
import { Public } from '../common/security';

/** Long enough for a slow round trip, short enough that a probe answers before the orchestrator gives up. */
const PROBE_TIMEOUT_MS = 2000;

/** Liveness at `/health`, readiness at `/health/ready` — an orchestrator restarts on one and stops routing on the other. */
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.SCORING) private readonly scoring: Queue,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    const dependencies = await this.probeAll();
    const allUp = Object.values(dependencies).every((d) => d.status === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  /** 503 until every dependency a request needs is answering, so nothing is routed here too early. */
  @Public()
  @Get('ready')
  async ready(): Promise<HealthDependencies> {
    const dependencies = await this.probeAll();
    const down = READINESS_DEPENDENCIES.filter((name) => dependencies[name].status === 'down');
    if (down.length > 0) {
      throw new AppException(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `Not ready: ${down.join(', ')} unreachable`,
        { details: dependencies },
      );
    }

    return dependencies;
  }

  private async probeAll(): Promise<HealthDependencies> {
    const [database, redis, storage, queue] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.storage.ping()),
      // A real round trip on the queue's OWN connection, which can be down while the app client is up.
      probe(() => this.scoring.getJobCounts('waiting')),
    ]);

    return { database, redis, storage, queue };
  }
}

async function probe(check: () => Promise<unknown>): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await withTimeout(check());
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/** A queue client waits forever by design, and a probe that never answers is a probe that never says down. */
function withTimeout(work: Promise<unknown>): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer in ${PROBE_TIMEOUT_MS}ms`)),
      PROBE_TIMEOUT_MS,
    );
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
