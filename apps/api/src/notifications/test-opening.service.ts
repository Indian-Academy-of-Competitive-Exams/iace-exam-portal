/**
 * Tells whoever reaches a test that it has opened. A test opens by the CLOCK, so nothing writes at
 * the moment it happens and there is no event to hang this off — a sweep is the only shape that
 * works. `Test.announcedAt` is what makes it exactly-once: it is stamped in the same transaction as
 * the outbox rows, so a crash mid-fan-out replays and a finished one is never seen again.
 */
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { type AccessResolverService } from '../access';
import { NotificationOutbox } from './notification-outbox';

/** One student at a time would be one transaction each; this is the fan-out the announcer uses. */
const CHUNK = 500;

/** A sweep speaks about a handful of tests, never a backlog — the watermark keeps it that way. */
const TESTS_PER_SWEEP = 20;

@Injectable()
export class TestOpeningService {
  private readonly logger = new Logger(TestOpeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    // `require`, not a static import: `access` reads this barrel back, closing the cycle on load.
    @Inject(
      forwardRef(
        () =>
          (module.require('../access') as { AccessResolverService: typeof AccessResolverService })
            .AccessResolverService,
      ),
    )
    private readonly access: AccessResolverService,
    private readonly outbox: NotificationOutbox,
  ) {}

  /** Returns how many tests it spoke about, so a caller can tell a quiet sweep from a stuck one. */
  async sweep(now: Date = new Date()): Promise<number> {
    const opened = await this.prisma.test.findMany({
      where: {
        status: TestStatus.ACTIVE,
        announcedAt: null,
        OR: [{ opensAt: null }, { opensAt: { lte: now } }],
      },
      select: { id: true, title: true, testSeriesId: true },
      take: TESTS_PER_SWEEP,
    });

    let spoken = 0;
    for (const test of opened) {
      try {
        await this.announce(test, now);
        spoken += 1;
      } catch (error) {
        // One test's failure is its own: it stays unannounced, and the next sweep tries again.
        this.logger.error(`Test ${test.id} opened but could not be announced`, error);
      }
    }
    return spoken;
  }

  private async announce(
    test: { id: string; title: string | null; testSeriesId: string },
    now: Date,
  ): Promise<void> {
    const recipients = await this.access.studentsReaching(test.testSeriesId);

    await this.prisma.$transaction(async (tx) => {
      for (const batch of chunked(recipients)) {
        await this.outbox.requestMany(
          tx,
          batch.map((studentId) => ({
            studentId,
            type: NOTIFICATION_TYPE.TEST_ASSIGNED,
            title: test.title ?? 'A new test is open',
            body: 'It is open now, and stays open — sit it whenever you are ready.',
            // The natural key of the fact: this test opening, once, however often the sweep runs.
            dedupeKey: `test-open:${test.id}`,
            testId: test.id,
          })),
        );
      }
      // Stamped WITH the fan-out: a crash between them replays, and never half-tells a cohort.
      await tx.test.update({ where: { id: test.id }, data: { announcedAt: now } });
    });
  }
}

function* chunked<T>(rows: readonly T[]): Generator<T[]> {
  for (let at = 0; at < rows.length; at += CHUNK) yield rows.slice(at, at + CHUNK);
}
