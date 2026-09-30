/**
 * The board a signed-in student reads. ONE paper, ranked on marks — papers do not compare on marks,
 * so no board spans more than one. A paper's whole ranking is read once per rollup and every
 * reader's seats are cut from that copy; nothing is saved. No select here reaches a mobile, an
 * email or a question.
 */
import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LEADERBOARD_NEIGHBOURS,
  LEADERBOARD_PODIUM,
  type Leaderboard,
  type LeaderboardQuery,
  type LeaderboardRow,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { boardName, splitBoard } from './leaderboard-board';
import { hold } from './paper-sheet.service';
import { rankedCohortSql, testBoardSql, type CohortSeatRow } from './ranking-sql';

const NO_BOARD = 'No such leaderboard';

/** A ranking is one row per sitting, where a held paper is one per question, so fewer are kept. */
const HELD_BOARDS = 8;

@Injectable()
export class LeaderboardViewService {
  private readonly rankings = new Map<string, Promise<CohortSeatRow[]>>();

  constructor(private readonly prisma: PrismaService) {}

  /** No places-moved arrow: it would need a rank saved from some earlier read, and none is. */
  async board(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    const { testId } = query;
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

    const frame = emptyBoard(testId, mine.test.title);
    const seats =
      (await this.heldSeats(testId, mine.id, mine.test.stat?.computedAt)) ??
      (await this.prisma.$queryRaw<CohortSeatRow[]>(testBoardSql(testId, mine.id)));
    // A sitting the cohort does not count has no seat, and reads a board with nobody on it.
    const seated = seats.find((seat) => seat.attempt_id === mine.id);
    if (seated === undefined) return frame;

    const rows: LeaderboardRow[] = seats.map((seat) => ({
      rank: seat.rank,
      name: boardName(seat.name),
      branch: seat.branch,
      score: seat.score,
      percentile: seat.attempt_id === mine.id ? seat.percentile : null,
      isYou: seat.attempt_id === mine.id,
    }));

    return { ...frame, ...splitBoard(rows), cohortSize: seated.cohort, you: yours(rows) };
  }

  /** Null where the held ranking cannot answer this reader — no rollup yet, or a sitting it never counted. */
  private async heldSeats(
    testId: string,
    attemptId: string,
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
    return seat ? seatsNear(ranked, seat.rank) : null;
  }
}

/** The same seats `testBoardSql` selects, cut from a ranking already in memory. */
function seatsNear(ranked: readonly CohortSeatRow[], rank: number): CohortSeatRow[] {
  const podium = ranked.slice(0, LEADERBOARD_PODIUM);
  const from = Math.max(rank - LEADERBOARD_NEIGHBOURS, 1);
  const near = ranked.slice(from - 1, rank + LEADERBOARD_NEIGHBOURS);
  // A reader within the podium's reach sits in both slices, and no seat is drawn twice.
  return [...podium, ...near.filter((seat) => seat.rank > LEADERBOARD_PODIUM)];
}

const yours = (rows: readonly LeaderboardRow[]): LeaderboardRow | null =>
  rows.find((row) => row.isYou) ?? null;

/** A board with nobody on it yet — an unscored sitting, or a paper nobody has finished. */
function emptyBoard(testId: string, label: string | null): Leaderboard {
  return {
    testId,
    label,
    cohortSize: 0,
    podium: [],
    neighbourhood: [],
    you: null,
    generatedAt: new Date().toISOString(),
  };
}
