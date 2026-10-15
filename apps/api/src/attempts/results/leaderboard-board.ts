/**
 * Shaping a board out of a ranking. Everything here is pure: the name a row may show, and how
 * the rows split between the podium and the table under it.
 */
import { LEADERBOARD_PODIUM, type LeaderboardRow } from '@iace/contracts';

/** Shown where a student has no name on file. Never their mobile number — this board is public to peers. */
const UNNAMED = 'Student';

export function boardName(fullName: string | null): string {
  const named = fullName?.trim() ?? '';
  return named === '' ? UNNAMED : named;
}

/** The ranks one page of the ranking holds: the podium is above page one, on no page. */
export function pageRanks(page: number, pageSize: number): { from: number; to: number } {
  const from = LEADERBOARD_PODIUM + (page - 1) * pageSize + 1;
  return { from, to: from + pageSize - 1 };
}

/** The podium and the page under it, each in rank order; the reader's own seat off the page is in neither. */
export function splitBoard(
  rows: readonly LeaderboardRow[],
  ranks: { from: number; to: number },
): { podium: LeaderboardRow[]; rows: LeaderboardRow[] } {
  const ordered = [...rows].sort((a, b) => a.rank - b.rank);
  return {
    podium: ordered.filter((row) => row.rank <= LEADERBOARD_PODIUM),
    rows: ordered.filter((row) => row.rank >= ranks.from && row.rank <= ranks.to),
  };
}
