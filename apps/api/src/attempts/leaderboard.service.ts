/**
 * The live ranking, in Redis. Rank and percentile are READ from the sorted set on every request
 * and never regenerated on a schedule. Postgres holds the durable marks the board is built from
 * and the last snapshot, so a wiped Redis costs one rebuild — off the request path, in a job.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { QUEUE_NAMES, type LeaderboardRebuildJobData } from '../queue/queues';
import { bandOf, compositeScore, percentileOf, timeTakenSec } from './leaderboard-score';

/** One sitting's place in its cohort, as of this read. */
export interface Standing {
  rank: number;
  percentile: number;
  cohortSize: number;
}

/** What one row of the board needs. Only a GRADED, scored sitting is ever on it. */
export interface RankedAttempt {
  id: string;
  testId: string;
  isGraded: boolean;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
}

/** How many sittings one rebuild page reads. A 5K cohort is five round trips, not five thousand. */
const REBUILD_PAGE = 1000;

/** Long enough that a board is never rebuilt in practice; short enough that a dead one goes away. */
const BOARD_TTL_SEC = 30 * 24 * 60 * 60;

/** One rebuild at a time per test, and long enough for the biggest cohort to finish. */
const REBUILD_LOCK_SEC = 120;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_NAMES.LEADERBOARD_REBUILD)
    private readonly rebuilds: Queue<LeaderboardRebuildJobData>,
  ) {}

  /** Idempotent: the composite is a function of the marks and the clock the row already holds. */
  async record(attempt: RankedAttempt): Promise<void> {
    if (!attempt.isGraded || attempt.score === null) return;
    const key = redisKeys.testLeaderboard(attempt.testId);
    await this.redis.client.zadd(
      key,
      compositeScore(attempt.score, timeTakenSec(attempt.startedAt, attempt.submittedAt)),
      attempt.id,
    );
    await this.redis.client.expire(key, BOARD_TTL_SEC);
  }

  /** Null when this sitting is not on the board — ungraded, unscored, or a board being rebuilt. */
  async standing(testId: string, attemptId: string): Promise<Standing | null> {
    const key = redisKeys.testLeaderboard(testId);
    if (await this.askForRebuildIfCold(testId)) return null;

    // The member's OWN composite decides its band, so rank and percentile are never two facts.
    const composite = await this.redis.client.zscore(key, attemptId);
    if (composite === null) return null;
    const band = bandOf(Number(composite));

    const [seat, cohortSize, outscored, tied] = await Promise.all([
      this.redis.client.zrevrank(key, attemptId),
      this.redis.client.zcard(key),
      this.redis.client.zcount(key, '-inf', `(${band.floor}`),
      this.redis.client.zcount(key, band.floor, band.ceiling),
    ]);
    if (seat === null) return null;

    return { rank: seat + 1, percentile: percentileOf(outscored, tied, cohortSize), cohortSize };
  }

  /** For a SCREEN: a Redis nobody can reach costs the live standing, never the whole page. */
  async liveStanding(testId: string, attemptId: string): Promise<Standing | null> {
    return this.standing(testId, attemptId).catch((error: unknown) => {
      this.logger.error(`Reading the standing for ${attemptId} failed; the snapshot stands`, error);
      return null;
    });
  }

  /** Built aside and swapped in: a rebuild that dies half-way leaves the board cold, not wrong. */
  async rebuild(testId: string): Promise<number> {
    const key = redisKeys.testLeaderboard(testId);
    const held = await this.redis.acquireLock(
      redisKeys.testLeaderboardRebuild(testId),
      REBUILD_LOCK_SEC,
    );
    if (!held) return 0;

    const staging = `${key}:building`;
    await this.redis.del(staging);
    let written = 0;
    let after: string | undefined;

    for (;;) {
      const page = await this.prisma.attempt.findMany({
        where: { testId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED, score: { not: null } },
        orderBy: { id: 'asc' },
        // Keyset, not offset: an OFFSET page re-walks every row before it, once per page.
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        take: REBUILD_PAGE,
        select: { id: true, score: true, startedAt: true, submittedAt: true },
      });
      if (page.length > 0) {
        await this.redis.client.zadd(staging, ...page.flatMap(toMember));
        written += page.length;
        after = page.at(-1)?.id;
      }
      if (page.length < REBUILD_PAGE) break;
    }

    if (written === 0) {
      await this.redis.del(key);
      return 0;
    }
    await this.redis.client.rename(staging, key);
    await this.redis.client.expire(key, BOARD_TTL_SEC);
    return written;
  }

  /** A second write, not part of scoring: the board cannot be read until the marks are durable. */
  async snapshot(attemptId: string, standing: Standing): Promise<void> {
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { lastRank: standing.rank, lastPercentile: standing.percentile },
    });
  }

  /** Marks are durable and a rank is a cache, so a Redis that is down must not fail the scoring. */
  async rank(attempt: RankedAttempt): Promise<Standing | null> {
    if (!attempt.isGraded || attempt.score === null) return null;
    try {
      // A board mid-rebuild would report a cohort of one, so this run records and takes no reading.
      const cold = await this.askForRebuildIfCold(attempt.testId);
      await this.record(attempt);
      if (cold) return null;

      const standing = await this.standing(attempt.testId, attempt.id);
      if (standing) await this.snapshot(attempt.id, standing);
      return standing;
    } catch (error) {
      this.logger.error(`Ranking attempt ${attempt.id} failed; its marks are still durable`, error);
      return null;
    }
  }

  /** True when the board was empty — a wiped or expired Redis, repaired by a job and not by a read. */
  private async askForRebuildIfCold(testId: string): Promise<boolean> {
    if ((await this.redis.client.zcard(redisKeys.testLeaderboard(testId))) > 0) return false;
    await this.rebuilds.add(QUEUE_NAMES.LEADERBOARD_REBUILD, { testId });
    return true;
  }
}

/** ZADD takes score and member in pairs, so a whole page goes over the wire as one command. */
function toMember(row: {
  id: string;
  score: unknown;
  startedAt: Date;
  submittedAt: Date | null;
}): [number, string] {
  return [compositeScore(Number(row.score), timeTakenSec(row.startedAt, row.submittedAt)), row.id];
}
