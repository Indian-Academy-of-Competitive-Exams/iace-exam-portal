/**
 * Tells whoever reaches a test that it has opened. A test opens by the CLOCK, so nothing writes at
 * the moment it happens and there is no event to hang this off — a sweep is the only shape that
 * works. Stamping `Test.announcedAt` IS the bell entry: the bell lists an announced test to every
 * student whose catalog holds its series, so nothing is written per student. The push follows it.
 */
import { Injectable, Logger } from '@nestjs/common';
import { TEST_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../reach';
import { PushService } from './push.service';

/** How many students' devices one push page reads. */
const CHUNK = 1000;

/** What the bell and the push call a test with no title yet. */
export const OPENED_TITLE = 'A new test is open';
export const OPENED_LINE = 'It is open now. Tap to see it in your tests.';

/** A sweep speaks about a handful of tests, never a backlog — the watermark keeps it that way. */
const TESTS_PER_SWEEP = 20;

@Injectable()
export class TestOpeningService {
  private readonly logger = new Logger(TestOpeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly push: PushService,
  ) {}

  /** Returns how many tests it spoke about, so a caller can tell a quiet sweep from a stuck one. */
  async sweep(now: Date = new Date()): Promise<number> {
    const opened = await this.prisma.test.findMany({
      where: {
        status: TEST_STATUS.ACTIVE,
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
    // Stamped first: a crash before the push costs the push, never a second one.
    await this.prisma.test.update({ where: { id: test.id }, data: { announcedAt: now } });
    const recipients = await this.access.studentsReaching(test.testSeriesId);
    const message = { broadcastId: test.id, title: test.title ?? OPENED_TITLE, body: OPENED_LINE };
    for (const batch of chunked(recipients)) await this.push.broadcast(batch, message);
  }
}

function* chunked<T>(rows: readonly T[]): Generator<T[]> {
  for (let at = 0; at < rows.length; at += CHUNK) yield rows.slice(at, at + CHUNK);
}
