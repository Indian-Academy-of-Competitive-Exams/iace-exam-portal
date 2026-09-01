/**
 * Shaping a board out of a ranking. Everything here is pure: which seats a reader's
 * neighbourhood covers, what rank a returned member holds, and how the rows split
 * between the podium and the table under it.
 */
import { LEADERBOARD_NEIGHBOURS, LEADERBOARD_PODIUM, type LeaderboardRow } from '@iace/contracts';

/** Shown where a student has no name on file. Never their mobile number — this board is public to peers. */
const UNNAMED = 'Student';

/** Zero-based seats, the way ZREVRANGE counts them, clamped to a board that may be shorter. */
export interface SeatWindow {
  from: number;
  to: number;
}

export function neighbourhoodWindow(rank: number, cohortSize: number): SeatWindow {
  const seat = rank - 1;
  const last = Math.max(cohortSize - 1, 0);
  return {
    from: Math.max(seat - LEADERBOARD_NEIGHBOURS, 0),
    to: Math.min(seat + LEADERBOARD_NEIGHBOURS, last),
  };
}

/** Rank per member across two reads of one board — the podium wins where the two overlap. */
export function seatsOf(
  podium: readonly string[],
  neighbourhood: readonly string[],
  from: number,
): Map<string, number> {
  const seats = new Map<string, number>();
  podium.forEach((id, index) => seats.set(id, index + 1));
  neighbourhood.forEach((id, index) => {
    if (!seats.has(id)) seats.set(id, from + index + 1);
  });
  return seats;
}

/** Positive is up the board. Null where nothing was ever recorded to move from. */
export const deltaOf = (previousRank: number | null, rank: number): number | null =>
  previousRank === null ? null : previousRank - rank;

export function boardName(fullName: string | null): string {
  const named = fullName?.trim() ?? '';
  return named === '' ? UNNAMED : named;
}

/** The podium and what sits under it, each in rank order and never holding the same seat twice. */
export function splitBoard(rows: readonly LeaderboardRow[]): {
  podium: LeaderboardRow[];
  neighbourhood: LeaderboardRow[];
} {
  const ordered = [...rows].sort((a, b) => a.rank - b.rank);
  return {
    podium: ordered.filter((row) => row.rank <= LEADERBOARD_PODIUM),
    neighbourhood: ordered.filter((row) => row.rank > LEADERBOARD_PODIUM),
  };
}
