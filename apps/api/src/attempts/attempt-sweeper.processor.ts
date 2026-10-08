import { Processor } from '@nestjs/bullmq';
import { ReportingWorkerHost } from '../queue/reporting-worker-host';
import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_NAMES,
  QUEUE_POLICY,
  SCORING_RETRY_AFTER_MS,
  SUBMIT_QUEUE_GRACE_SEC,
} from '../queue/queues';
import { isAbandoned, SAVE_GRACE_SEC } from './attempt-state';
import { AttemptStateService } from './attempt-state.service';
import { RollupQueue } from './rollup-queue';
import { ScoringQueue } from './scoring-queue';
import { SubmitService } from './submit.service';
import { QueueFailures } from '../common/metrics/queue-failures';
import { MetricsService } from '../common/metrics/metrics.service';
import { MS_PER_SECOND } from '../common/time/units';

/** Ends the sittings nobody ended, and hands on the scoring and counting nobody enqueued. */
@Processor(QUEUE_NAMES.ATTEMPT_SWEEP, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_SWEEP].concurrency,
})
export class AttemptSweeperProcessor extends ReportingWorkerHost {
  private readonly logger = new Logger(AttemptSweeperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly submit: SubmitService,
    private readonly scoring: ScoringQueue,
    private readonly rollup: RollupQueue,
    failures: QueueFailures,
    private readonly metrics: MetricsService,
  ) {
    super(QUEUE_NAMES.ATTEMPT_SWEEP, failures);
  }

  async process(): Promise<void> {
    await this.endStranded();
    await this.rollup.sweep().catch((error: unknown) => {
      this.logger.error('Asking for the cohort counting pass failed', error);
    });
    await this.askAgainForUnscored().catch((error: unknown) => {
      this.logger.error('Asking again for the sittings nobody scored failed', error);
    });
    await this.askForRescores().catch((error: unknown) => {
      this.logger.error('Asking for the sittings marked against an older paper failed', error);
    });
  }

  /** One sweep reads every expired sitting once, a page at a time: the cap bounds a read, not a sweep. */
  private async endStranded(now: Date = new Date()): Promise<void> {
    // The same grace a save gets, so the sweeper never ends a sitting a save could still reach.
    const cutoff = new Date(now.getTime() - SAVE_GRACE_SEC * MS_PER_SECOND);
    let after: Expired | null = null;
    for (;;) {
      const page = await this.expired(cutoff, after);
      const stranded = await this.abandoned(page, now);
      for (let at = 0; at < stranded.length; at += SWEEP_LANES) {
        await Promise.all(
          stranded.slice(at, at + SWEEP_LANES).map((attempt) => this.end(attempt.id, cutoff)),
        );
      }
      const last = page.at(-1);
      // Paged past the last row, not re-read: a paused or refused sitting comes back unchanged.
      if (last === undefined || page.length < SWEEP_BATCH) return;
      after = last;
    }
  }

  /** A live key is a paper put down, and its TTL is the limit: having no key is the whole decision. */
  private async abandoned(candidates: readonly Expired[], now: Date): Promise<Expired[]> {
    const held = await this.state.readMany(candidates.map((row) => row.id));
    // A key still owed a flush waits a sweep, so what it holds is in the sheet before the sitting ends.
    const unflushed = new Set(held.size > 0 ? await this.state.dirtyIds() : []);
    return candidates.filter((row) => {
      const paused = held.get(row.id);
      return paused === undefined || (isAbandoned(paused, now) && !unflushed.has(row.id));
    });
  }

  /** Through the gate the student uses, by the deadline the page was read by: time given since leaves it open. */
  private async end(attemptId: string, cutoff: Date): Promise<void> {
    try {
      await this.submit.expire(attemptId, cutoff);
    } catch (error: unknown) {
      this.logger.error(`Sweeping attempt ${attemptId} failed`, error);
    }
  }

  /** An ended sitting never scored: its own submit's job was lost, or is still in the queue. */
  private async askAgainForUnscored(now: Date = new Date()): Promise<void> {
    const settled = new Date(now.getTime() - SCORING_RETRY_AFTER_MS);
    this.metrics.setScoringBacklog(await this.unscoredCount(settled));
    const unscored = await this.neverScored(now);
    await this.scoring.queue(unscored);
    // Most are a job still in the queue, swallowed by its id; a count that stays up is a lost one.
    if (unscored.length > 0)
      this.logger.log(`Queued ${unscored.length} ended, unscored sittings again`);
  }

  /** A drop or a bonus only bumps the test's revision; every sitting marked before it is found here. */
  private async askForRescores(): Promise<void> {
    let queued = 0;
    let after: Behind | null = null;
    for (;;) {
      const page = await this.behindThePaper(after);
      await this.scoring.rescore(page);
      queued += page.length;
      const last = page.at(-1);
      // Paged past the last row, not re-read: a queued sitting stays behind until it is marked.
      if (last === undefined || page.length < RESCORE_PAGE) break;
      after = last;
    }
    if (queued > 0)
      this.logger.log(`Queued ${queued} sittings to be marked against a changed paper`);
  }

  /** Ordered and paged on Attempt_rescore_idx's own columns, so no page sorts the set it matched. */
  private behindThePaper(after: Behind | null) {
    const past =
      after === null
        ? Prisma.empty
        : Prisma.sql`AND (a."testId", a."scoredRevision", a."id") > (${after.testId}::uuid, ${after.stamp}::int, ${after.id}::uuid)`;
    return this.prisma.$queryRaw<Behind[]>`
      SELECT a."id", a."testId", a."scoredRevision" AS stamp, t."paperRevision" AS revision
      FROM "Test" t
      JOIN "Attempt" a
        ON a."testId" = t."id"
       AND ${EVALUATED}
       AND a."scoredRevision" < t."paperRevision"
      WHERE t."paperRevision" > 0 ${past}
      ORDER BY a."testId", a."scoredRevision", a."id"
      LIMIT ${RESCORE_PAGE}`;
  }

  /** The gauge queue depth cannot show: sittings ended this long ago and still unscored. */
  private async unscoredCount(settled: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "Attempt"
      WHERE ${UNSCORED} AND "submittedAt" < ${settled}`;
    return row?.count ?? 0;
  }

  /** Past the grace a submit gets to queue its own job; one the queue still holds is not queued twice. */
  private neverScored(now: Date): Promise<{ id: string; testId: string }[]> {
    const settling = new Date(now.getTime() - SUBMIT_QUEUE_GRACE_SEC * MS_PER_SECOND);
    // Caps one sweep's re-asks, not the scoring queue, which drains at its own pace.
    return this.prisma.$queryRaw<{ id: string; testId: string }[]>`
      SELECT "id", "testId" FROM "Attempt"
      WHERE ${UNSCORED} AND "submittedAt" < ${settling}
      ORDER BY "submittedAt" ASC
      LIMIT ${NEVER_SCORED_BATCH_CEILING}`;
  }

  /** Ordered and paged on Attempt_expiring_idx's own column, the id parting a shared deadline. */
  private expired(cutoff: Date, after: Expired | null): Promise<Expired[]> {
    const past =
      after === null
        ? Prisma.empty
        : Prisma.sql`AND ("endsAt", "id") > (${after.endsAt}::timestamptz, ${after.id}::uuid)`;
    return this.prisma.$queryRaw<Expired[]>`
      SELECT "id", "endsAt" FROM "Attempt"
      WHERE "status" = ${IN_PROGRESS} AND "endsAt" < ${cutoff} ${past}
      ORDER BY "endsAt", "id"
      LIMIT ${SWEEP_BATCH}`;
  }
}

/** Literal, not a parameter: a bound enum cannot prove Attempt_unscored_idx's predicate, so the planner skips it. */
const UNSCORED = Prisma.raw(`"status" = '${ATTEMPT_STATUS.SUBMITTED}' AND "score" IS NULL`);

/** Literal, not a parameter: a bound enum cannot prove Attempt_expiring_idx's predicate, so the planner skips it. */
const IN_PROGRESS = Prisma.raw(`'${ATTEMPT_STATUS.IN_PROGRESS}'`);

/** Literal, not a parameter: a bound enum cannot prove Attempt_rescore_idx's predicate, so the planner skips it. */
const EVALUATED = Prisma.raw(`a."status" = '${ATTEMPT_STATUS.EVALUATED}'`);

/** An expired sitting as a page reads it: its deadline and id are the sweep's keyset. */
interface Expired {
  id: string;
  endsAt: Date;
}

/** A sitting behind its paper: `stamp` is its own revision and the sweep's keyset, `revision` the test's. */
interface Behind {
  id: string;
  testId: string;
  stamp: number;
  revision: number;
}

/** The never-scored arm's own ceiling: wide enough to drain 6,000 in minutes, not hours. */
export const NEVER_SCORED_BATCH_CEILING = 1000;

/** Sittings behind their paper read at a time; one sweep keeps paging until a short page. */
export const RESCORE_PAGE = 1000;

/** How many expired sittings one read holds. A sweep keeps reading until a short page. */
export const SWEEP_BATCH = 200;

/** Ended side by side rather than one after another; the last student waited for all of them. */
export const SWEEP_LANES = 8;
