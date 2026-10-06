import { Logger } from '@nestjs/common';
import { type Queue } from 'bullmq';

const logger = new Logger('KeepScheduled');

/** Registers now and on every reconnect: a Redis that comes back empty has lost its schedulers. */
export async function keepScheduled(
  queue: Pick<Queue, 'backend'>,
  register: () => Promise<void>,
): Promise<void> {
  await register();
  // ponytail: a wipe with the connection held (FLUSHALL) is not seen; add a timer if that ever happens.
  queue.backend.on('ready', () => {
    void register().catch((error: unknown) => {
      logger.error('Registering the schedulers again after a reconnect failed', error);
    });
  });
}
