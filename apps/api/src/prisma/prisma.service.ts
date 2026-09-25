import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma's interactive defaults (2s/5s) are a cliff a real query plan can miss; these name the two shapes a body here takes. */
export const TX_LIMITS = {
  SHORT: { maxWait: 5_000, timeout: 10_000 },
  BULK: { maxWait: 10_000, timeout: 120_000 },
} as const;

/** The single PrismaClient for the process. Postgres is deliberately kept OFF the hot path during live tests — in-progress answers live in Redis and land here only via the scoring workers. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

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
