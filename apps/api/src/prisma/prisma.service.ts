import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';

/** Prisma's interactive defaults (2s/5s) are a cliff a real query plan can miss; these name the two shapes a body here takes. */
export const TX_LIMITS = {
  SHORT: { maxWait: 5_000, timeout: 10_000 },
  BULK: { maxWait: 10_000, timeout: 120_000 },
} as const;

/** A query slower than this is worth a line in the log; the parameters are not — they carry student data. */
const SLOW_QUERY_MS = 500;

/** The single PrismaClient for the process. Postgres is deliberately kept OFF the hot path during live tests — in-progress answers live in Redis and land here only via the scoring workers. */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    this.$on('query', (event) => {
      if (event.duration >= SLOW_QUERY_MS) {
        this.logger.warn(`Slow query (${event.duration}ms): ${event.query}`);
      }
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by /health. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
