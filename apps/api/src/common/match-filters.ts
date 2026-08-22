import { MATCH_MODES, type MatchMode } from '@iace/contracts';

/** How a list's filters combine, once, so four where-builders cannot answer it differently. */
export function matchFilters<T extends { OR?: T[] }>(
  always: readonly T[],
  chosen: readonly T[],
  match: MatchMode,
): T[] {
  // `OR: []` matches NOTHING, and one condition ORed with itself is just itself.
  if (match === MATCH_MODES.ALL || chosen.length < 2) return [...always, ...chosen];

  // Sound for every Prisma where input: each one takes an optional `OR` of its own type.
  return [...always, { OR: [...chosen] } as T];
}
