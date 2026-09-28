/** What a student's board is called and what it asks for, on both clients. */
import {
  LEADERBOARD_MEASURES,
  LEADERBOARD_SCOPES,
  type LeaderboardMeasure,
  type LeaderboardQueryInput,
  type LeaderboardScope,
} from '@iace/contracts';

export const LEADERBOARD_SCOPE_LABELS: Readonly<Record<LeaderboardScope, string>> = {
  [LEADERBOARD_SCOPES.TEST]: 'This test',
  [LEADERBOARD_SCOPES.SERIES]: 'Series points',
  [LEADERBOARD_SCOPES.ALL_TIME]: 'All time',
};

/** Marks rank one paper; across papers only a percentile does. Both are "the number" on a row. */
export const LEADERBOARD_MEASURE_LABELS: Readonly<Record<LeaderboardMeasure, string>> = {
  [LEADERBOARD_MEASURES.MARKS]: 'Marks',
  [LEADERBOARD_MEASURES.PERCENTILE_POINTS]: 'Points',
};

/** What the three podium seats are called. Nobody says "1st" about a topper. */
export const PODIUM_LABELS: Readonly<Record<number, string>> = { 1: 'Topper', 2: '2nd', 3: '3rd' };

export function scopeIdFor(scope: LeaderboardScope, testId: string, seriesId: string): string {
  if (scope === LEADERBOARD_SCOPES.TEST) return testId;
  if (scope === LEADERBOARD_SCOPES.SERIES) return seriesId;
  return '';
}

export function boardQueryFor(scope: LeaderboardScope, scopeId: string): LeaderboardQueryInput {
  if (scope === LEADERBOARD_SCOPES.TEST) return { scope, testId: scopeId };
  if (scope === LEADERBOARD_SCOPES.SERIES) return { scope, seriesId: scopeId };
  return { scope: LEADERBOARD_SCOPES.ALL_TIME };
}

/** No ranked sitting means no board at ANY scope, all-time included, so nothing is asked for. */
export const isBoardAsked = (scope: LeaderboardScope, scopeId: string, testsSat: number): boolean =>
  testsSat > 0 && (scope === LEADERBOARD_SCOPES.ALL_TIME || scopeId !== '');
