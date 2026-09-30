/**
 * The board a signed-in student reads, counted live from Postgres with no regenerate step. ONE
 * paper, ranked on marks — papers do not compare on marks, so no board spans more than one.
 * Every read is a graded sitting. No select here reaches a mobile, an email or a question.
 */
import { Injectable } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type Leaderboard,
  type LeaderboardQuery,
  type LeaderboardRow,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { boardName, splitBoard } from './leaderboard-board';
import { testBoardSql, type TestBoardRow } from './ranking-sql';

const NO_BOARD = 'No such leaderboard';

@Injectable()
export class LeaderboardViewService {
  constructor(private readonly prisma: PrismaService) {}

  /** No places-moved arrow: it would need a rank saved from some earlier read, and none is. */
  async board(studentId: string, query: LeaderboardQuery): Promise<Leaderboard> {
    const { testId } = query;
    // Reading somebody else's cohort starts with having sat it yourself.
    const mine = await this.prisma.attempt.findFirst({
      where: { testId, studentId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED },
      select: { id: true, test: { select: { title: true } } },
    });
    if (!mine) throw new AppException(ErrorCodes.NOT_FOUND, NO_BOARD);

    const frame = emptyBoard(testId, mine.test.title);
    const seats = await this.prisma.$queryRaw<TestBoardRow[]>(testBoardSql(testId, mine.id));
    // A sitting the cohort does not count has no seat, and reads a board with nobody on it.
    const seated = seats.find((seat) => seat.is_you);
    if (seated === undefined) return frame;

    const rows: LeaderboardRow[] = seats.map((seat) => ({
      rank: seat.rank,
      name: boardName(seat.name),
      branch: seat.branch,
      score: seat.score,
      percentile: seat.is_you ? seat.percentile : null,
      isYou: seat.is_you,
    }));

    return { ...frame, ...splitBoard(rows), cohortSize: seated.cohort, you: yours(rows) };
  }
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
