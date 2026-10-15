/**
 * The board a signed-in student reads. ONE paper, ranked on marks — papers do not compare on marks,
 * so no board spans more than one. The reader's own standing is always counted live, by the same
 * call the score card makes; the page of seats is cut from a ranking held per rollup. No select
 * here reaches a mobile, an email or a question.
 */
import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LEADERBOARD_PODIUM,
  leaderboardPageOf,
  type Leaderboard,
  type LeaderboardQuery,
  type LeaderboardRow,
} from '@iace/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { boardName, pageRanks, splitBoard } from './leaderboard-board';
import { LeaderboardService, type Standing } from './leaderboard.service';
import { hold } from '../paper-sheet.service';
import { rankedCohortSql, testBoardSql, type CohortSeatRow } from './ranking-sql';

const NO_BOARD = 'No such leaderboard';

/** A ranking is one row per sitting, where a held paper is one per question, so fewer are kept. */
const HELD_BOARDS = 8;

@Injectable()
export class LeaderboardViewService {
  private readonly rankings = new Map<string, Promise<CohortSeatRow[]>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** No places-moved arrow: it would need a rank saved from some earlier read, and none is. */
  async board(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    const { testId, page, pageSize } = query;
    // Reading somebody else's cohort starts with having sat it yourself.
    const mine = await this.prisma.attempt.findFirst({
      where: { testId, studentId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED },
      select: {
        id: true,
        // The watermark rides the gate, so holding the ranking costs no query of its own.
        test: { select: { title: true, stat: { select: { computedAt: true } } } },
      },
    });
    if (!mine) throw new AppException(ErrorCodes.NOT_FOUND, NO_BOARD);

    const frame = emptyBoard(query, mine.test.title);
    const ranks = pageRanks(page, pageSize);
    // Counted now, by the call the score card makes, so the two can never quote different ranks.
    const standing = await this.leaderboard.standing(testId, mine.id);
    // A sitting the cohort does not count has no standing, and reads a board with nobody on it.
    if (standing === null) return frame;

    const seats =
      (await this.heldSeats(testId, mine.id, standing, ranks, mine.test.stat?.computedAt)) ??
      (await this.prisma.$queryRaw<CohortSeatRow[]>(testBoardSql(testId, mine.id, ranks)));

    const rows: LeaderboardRow[] = seats.map((seat) => ({
      rank: seat.rank,
      name: boardName(seat.name),
      branch: seat.branch,
      score: seat.score,
      percentile: seat.attempt_id === mine.id ? standing.percentile : null,
      isYou: seat.attempt_id === mine.id,
    }));

    return {
      ...frame,
      ...splitBoard(rows, ranks),
      cohortSize: standing.cohortSize,
      total: Math.max(standing.cohortSize - LEADERBOARD_PODIUM, 0),
      you: yours(rows),
      yourPage: leaderboardPageOf(standing.rank, pageSize),
    };
  }

  /** Null where the held ranking disagrees with the live standing, so no board mixes the two. */
  private async heldSeats(
    testId: string,
    attemptId: string,
    standing: Standing,
    ranks: { from: number; to: number },
    countedAt: Date | undefined,
  ): Promise<CohortSeatRow[] | null> {
    if (countedAt === undefined) return null;

    const ranked = await hold(
      this.rankings,
      `${testId}:${countedAt.getTime()}`,
      () => this.prisma.$queryRaw<CohortSeatRow[]>(rankedCohortSql(testId)),
      HELD_BOARDS,
    );
    const seat = ranked.find((row) => row.attempt_id === attemptId);
    const agrees = seat?.rank === standing.rank && seat?.cohort === standing.cohortSize;
    return agrees && seat ? seatsOn(ranked, ranks, seat) : null;
  }
}

/** The same seats `testBoardSql` selects, cut from a ranking already in memory. */
function seatsOn(
  ranked: readonly CohortSeatRow[],
  ranks: { from: number; to: number },
  mine: CohortSeatRow,
): CohortSeatRow[] {
  const shown = [...ranked.slice(0, LEADERBOARD_PODIUM), ...ranked.slice(ranks.from - 1, ranks.to)];
  // The reader's own seat rides along wherever it is, so the board can pin it under any page.
  return shown.includes(mine) ? shown : [...shown, mine];
}

const yours = (rows: readonly LeaderboardRow[]): LeaderboardRow | null =>
  rows.find((row) => row.isYou) ?? null;

/** A board with nobody on it yet — an unscored sitting, or a paper nobody has finished. */
function emptyBoard(query: LeaderboardQuery, label: string | null): Leaderboard {
  return {
    testId: query.testId,
    label,
    cohortSize: 0,
    podium: [],
    rows: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0,
    you: null,
    yourPage: null,
    generatedAt: new Date().toISOString(),
  };
}
