/**
 * Shaping a board out of a ranking. Everything here is pure: how far a reader moved, the name a
 * row may show, and how the rows split between the podium and the table under it.
 */
import { LEADERBOARD_PODIUM, type LeaderboardRow } from '@iace/contracts';

/** Shown where a student has no name on file. Never their mobile number — this board is public to peers. */
const UNNAMED = 'Student';

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
