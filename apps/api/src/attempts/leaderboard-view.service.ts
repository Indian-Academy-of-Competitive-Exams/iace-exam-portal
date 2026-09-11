/**
 * The board a signed-in student reads, counted live from Postgres with no regenerate step. ONE
 * paper ranks on marks; two or more rank on percentile, because papers do not compare on marks.
 * Every read is a graded sitting. No select here reaches a mobile, an email or a question.
 */
import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LEADERBOARD_MEASURE_BY_SCOPE,
  LEADERBOARD_SCOPES,
  LEADERBOARD_SCOPE_FIELD,
  type Leaderboard,
  type LeaderboardQuery,
  type LeaderboardRow,
  type LeaderboardScope,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService } from './leaderboard.service';
import { boardName, deltaOf, splitBoard } from './leaderboard-board';
import { pointsBoardSql, testBoardSql, type PointsRow, type TestBoardRow } from './ranking-sql';

const NO_BOARD = 'No such leaderboard';
const NO_SERIES = 'No such test series';

@Injectable()
export class LeaderboardViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  async board(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    if (query.scope === LEADERBOARD_SCOPES.TEST) {
      return this.paperBoard(studentId, query.testId ?? '');
    }
    return this.pointsBoard(studentId, query);
  }

  /** One paper. No places-moved arrow: it would need a rank saved from some earlier read. */
  private async paperBoard(studentId: string, testId: string): Promise<Leaderboard> {
    // Reading somebody else's cohort starts with having sat it yourself.
    const mine = await this.prisma.attempt.findFirst({
      where: { testId, studentId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED },
      select: { id: true, test: { select: { title: true } } },
    });
    if (!mine) throw new AppException(ErrorCodes.NOT_FOUND, NO_BOARD);

    const frame = emptyBoard(LEADERBOARD_SCOPES.TEST, testId, mine.test.title);
    const [standing, seats] = await Promise.all([
      this.leaderboard.standing(testId, mine.id),
      this.prisma.$queryRaw<TestBoardRow[]>(testBoardSql(testId, mine.id)),
    ]);
    if (standing === null) return frame;

    const rows: LeaderboardRow[] = seats.map((seat) => ({
      rank: seat.rank,
      name: boardName(seat.name),
      branch: seat.branch,
      value: seat.score,
      percentile: seat.is_you ? standing.percentile : null,
      sittings: 1,
      deltaRank: null,
      isYou: seat.is_you,
    }));

    const cohortSize = seats[0]?.cohort ?? standing.cohortSize;
    return { ...frame, ...splitBoard(rows), cohortSize, you: yours(rows) };
  }

  /** Two or more papers. Percentile points, never marks. */
  private async pointsBoard(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    const series =
      query.scope === LEADERBOARD_SCOPES.SERIES
        ? await this.series(studentId, query.seriesId ?? '')
        : null;

    const found = await this.prisma.$queryRaw<PointsRow[]>(
      pointsBoardSql(studentId, series?.testIds ?? null),
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

const yours = (rows: readonly LeaderboardRow[]): LeaderboardRow | null =>
  rows.find((row) => row.isYou) ?? null;

function scopeIdOf(query: LeaderboardQuery): string | null {
  const field = LEADERBOARD_SCOPE_FIELD[query.scope];
  return field === null ? null : (query[field] ?? null);
}

/** A board with nobody on it yet — an unscored sitting, or a series nobody has finished. */
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
