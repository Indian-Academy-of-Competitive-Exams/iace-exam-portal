/**
 * The board a signed-in student reads. ONE paper comes off the live Redis ranking with no
 * regenerate step; two or more rank on percentile, because papers do not compare on marks.
 * Every read is a graded sitting. No select here reaches a mobile, an email or a question.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LEADERBOARD_MEASURE_BY_SCOPE,
  LEADERBOARD_NEIGHBOURS,
  LEADERBOARD_PODIUM,
  LEADERBOARD_SCOPES,
  LEADERBOARD_SCOPE_FIELD,
  type Leaderboard,
  type LeaderboardQuery,
  type LeaderboardRow,
  type LeaderboardScope,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { LeaderboardService } from './leaderboard.service';
import { boardName, deltaOf, neighbourhoodWindow, seatsOf, splitBoard } from './leaderboard-board';

const NO_BOARD = 'No such leaderboard';
const NO_SERIES = 'No such test series';

/** Name and branch, and deliberately nothing else that could identify a student. */
const ROW_STUDENT = {
  select: { fullName: true, currentBranch: { select: { name: true } } },
} as const;

@Injectable()
export class LeaderboardViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  async board(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    if (query.scope === LEADERBOARD_SCOPES.TEST) {
      return this.paperBoard(studentId, query.testId ?? '');
    }
    return this.pointsBoard(studentId, query);
  }

  /** One paper, read live off the sorted set the scoring job already writes. */
  private async paperBoard(studentId: string, testId: string): Promise<Leaderboard> {
    // Reading somebody else's cohort starts with having sat it yourself.
    const mine = await this.prisma.attempt.findFirst({
      where: { testId, studentId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED },
      select: {
        id: true,
        lastRank: true,
        test: { select: { title: true } },
      },
    });
    if (!mine) throw new AppException(ErrorCodes.NOT_FOUND, NO_BOARD);

    const frame = emptyBoard(LEADERBOARD_SCOPES.TEST, testId, mine.test.title);
    const standing = await this.leaderboard.liveStanding(testId, mine.id);
    if (standing === null) return frame;

    const key = redisKeys.testLeaderboard(testId);
    const window = neighbourhoodWindow(standing.rank, standing.cohortSize);
    const [top, near] = await Promise.all([
      this.redis.client.zrevrange(key, 0, LEADERBOARD_PODIUM - 1),
      this.redis.client.zrevrange(key, window.from, window.to),
    ]);

    const seats = seatsOf(top, near, window.from);
    const sittings = await this.prisma.attempt.findMany({
      where: { id: { in: [...seats.keys()] } },
      select: { id: true, score: true, lastRank: true, student: ROW_STUDENT },
    });
    const byId = new Map(sittings.map((row) => [row.id, row]));

    const rows = [...seats].flatMap(([id, rank]) => {
      const row = byId.get(id);
      if (row === undefined) return [];
      const isYou = id === mine.id;
      return [
        {
          rank,
          name: boardName(row.student.fullName),
          branch: row.student.currentBranch?.name ?? null,
          value: Number(row.score ?? 0),
          percentile: isYou ? standing.percentile : null,
          sittings: 1,
          deltaRank: deltaOf(row.lastRank, rank),
          isYou,
        },
      ];
    });

    return { ...frame, ...splitBoard(rows), cohortSize: standing.cohortSize, you: yours(rows) };
  }

  /** Two or more papers. Percentile points, never marks — and the rank is Postgres', not Redis'. */
  private async pointsBoard(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    const series =
      query.scope === LEADERBOARD_SCOPES.SERIES
        ? await this.series(studentId, query.seriesId ?? '')
        : null;

    const found = await this.prisma.$queryRaw<PointsRow[]>(
      pointsSql(studentId, series?.testIds ?? null),
    );
    const priorRank = found[0]?.prior_rank ?? null;
    const rows: LeaderboardRow[] = found.map((row) => ({
      rank: row.rank,
      name: boardName(row.name),
      branch: row.branch,
      value: row.points,
      percentile: null,
      sittings: row.sittings,
      deltaRank: row.is_you ? deltaOf(priorRank, row.rank) : null,
      isYou: row.is_you,
    }));

    const frame = emptyBoard(query.scope, scopeIdOf(query), series?.name ?? null);
    return { ...frame, ...splitBoard(rows), cohortSize: found[0]?.cohort ?? 0, you: yours(rows) };
  }

  /** A series they have never sat has no board of theirs to be in, so it reads as missing. */
  private async series(studentId: string, seriesId: string) {
    const row = await this.prisma.testSeries.findFirst({
      where: { id: seriesId, tests: { some: { attempts: { some: { studentId } } } } },
      select: { name: true, tests: { select: { id: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, NO_SERIES);
    return { name: row.name, testIds: row.tests.map((test) => test.id) };
  }
}

/** One returned seat. `cohort` and `prior_rank` repeat on every row — a window function's output. */
interface PointsRow {
  rank: number;
  points: number;
  sittings: number;
  cohort: number;
  name: string | null;
  branch: string | null;
  is_you: boolean;
  prior_rank: number | null;
}

/** Postgres ranks it: a board seat is a window function, and Node would need the whole cohort. */
function pointsSql(studentId: string, testIds: readonly string[] | null): Prisma.Sql {
  const inScope =
    testIds === null ? Prisma.empty : Prisma.sql`AND a."testId" = ANY(${[...testIds]}::text[])`;

  return Prisma.sql`
    WITH scoped AS (
      SELECT a."studentId"      AS student_id,
             a."lastPercentile" AS percentile,
             a."submittedAt"    AS submitted_at
      FROM "Attempt" a
      JOIN "Student" s ON s."id" = a."studentId"
      WHERE a."isGraded" = TRUE
        AND a."status" = 'EVALUATED'
        AND a."lastPercentile" IS NOT NULL
        AND s."deletedAt" IS NULL
        ${inScope}
    ),
    board AS (
      SELECT student_id,
             ROUND(AVG(percentile), 2)::float8 AS points,
             COUNT(*)::int AS sittings
      FROM scoped
      GROUP BY student_id
    ),
    ranked AS (
      SELECT b.*,
             (ROW_NUMBER() OVER (ORDER BY b.points DESC, b.sittings DESC, b.student_id))::int AS rank,
             (COUNT(*) OVER ())::int AS cohort
      FROM board b
    ),
    mine AS (
      SELECT rank FROM ranked WHERE student_id = ${studentId}
    ),
    -- Where the reader stood before their most recent sitting counted.
    before AS (
      SELECT ROUND(AVG(percentile), 2)::float8 AS points
      FROM (
        SELECT percentile FROM scoped
        WHERE student_id = ${studentId}
        ORDER BY submitted_at DESC NULLS LAST
        OFFSET 1
      ) earlier
    ),
    prior AS (
      SELECT CASE WHEN (SELECT points FROM before) IS NULL THEN NULL ELSE (
        SELECT COUNT(*)::int + 1 FROM ranked r
        WHERE r.points > (SELECT points FROM before) AND r.student_id <> ${studentId}
      ) END AS rank
    )
    SELECT r.rank,
           r.points,
           r.sittings,
           r.cohort,
           s."fullName" AS name,
           br."name" AS branch,
           (r.student_id = ${studentId}) AS is_you,
           (SELECT rank FROM prior) AS prior_rank
    FROM ranked r
    JOIN "Student" s ON s."id" = r.student_id
    LEFT JOIN "Branch" br ON br."id" = s."currentBranchId"
    WHERE r.rank <= ${LEADERBOARD_PODIUM}
       OR r.rank BETWEEN COALESCE((SELECT rank FROM mine), 0) - ${LEADERBOARD_NEIGHBOURS}
                     AND COALESCE((SELECT rank FROM mine), 0) + ${LEADERBOARD_NEIGHBOURS}
    ORDER BY r.rank
  `;
}

const yours = (rows: readonly LeaderboardRow[]): LeaderboardRow | null =>
  rows.find((row) => row.isYou) ?? null;

function scopeIdOf(query: LeaderboardQuery): string | null {
  const field = LEADERBOARD_SCOPE_FIELD[query.scope];
  return field === null ? null : (query[field] ?? null);
}

/** A board with nobody on it yet — a cold Redis, or a series nobody has finished. */
function emptyBoard(
  scope: LeaderboardScope,
  scopeId: string | null,
  label: string | null,
): Leaderboard {
  return {
    scope,
    scopeId,
    label,
    measure: LEADERBOARD_MEASURE_BY_SCOPE[scope],
    cohortSize: 0,
    podium: [],
    neighbourhood: [],
    you: null,
    generatedAt: new Date().toISOString(),
  };
}
