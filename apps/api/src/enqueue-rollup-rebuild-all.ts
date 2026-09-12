/**
 * Queues the rollup worker's `rebuild-all` job, which recomputes every aggregate from the Attempt
 * rows and reads no outbox at all. Nothing else produces this job, and the deploy notes on this
 * branch prescribe it: run it once AFTER the last old instance is gone, never at the start of a
 * rolling deploy. Run: pnpm --filter @iace/api rollup:rebuild-all
 */
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, ROLLUP_JOBS, jobOptionsFor } from './queue/queues';

const logger = new Logger('rollup-rebuild-all');

async function run(): Promise<void> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    logger.error('REDIS_URL is unset, so there is no queue to ask');
    process.exitCode = 1;
    return;
  }

  const connection = new Redis(url, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAMES.ROLLUP, {
    connection,
    defaultJobOptions: jobOptionsFor(QUEUE_NAMES.ROLLUP),
  });

  try {
    const job = await queue.add(ROLLUP_JOBS.REBUILD_ALL, {});
    logger.log(
      `Queued ${ROLLUP_JOBS.REBUILD_ALL} on ${QUEUE_NAMES.ROLLUP} as job ${job.id ?? '?'}`,
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

void run();
