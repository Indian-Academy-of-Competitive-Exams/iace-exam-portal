import { Controller, Get } from '@nestjs/common';
import { type DependencyHealth, type HealthResponse } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { Public } from '../auth/decorators';

/**
 * Liveness + readiness in one. Always answers 200 so a load balancer can read
 * the body: `status` degrades to "degraded" when any dependency is down, which
 * is more useful during an incident than a connection refused.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    const [database, redis, storage] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.storage.ping()),
    ]);

    const dependencies = { database, redis, storage };
    const allUp = Object.values(dependencies).every((d) => d.status === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}

async function probe(check: () => Promise<unknown>): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await check();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
